/**
 * Attendance Reminder Bot with Web Dashboard
 * Bot WhatsApp otomatis pengingat absensi berbasis Baileys, node-cron, dan Express.
 * Ringan, hemat RAM, tanpa browser/Puppeteer, siap dijalankan di Termux Android.
 */

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const cron = require('node-cron');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// Inisialisasi Logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime
});

// ============================================================================
// 1. MANAJEMEN KONFIGURASI DINAMIS (config.json)
// ============================================================================
const CONFIG_PATH = path.join(__dirname, 'config.json');

const DEFAULT_CONFIG = {
  targetGroupId: process.env.TARGET_GROUP_ID || '',
  schedules: {
    regularTapIn: '08:00',
    regularTapOut: '17:30',
    wednesdayTapIn: '06:00',
    wednesdayTapOut: '16:00'
  },
  templates: {
    tapIn: `⏰ *PENGINGAT TAP IN ABSENSI* ⏰\n\nHalo @all 👋\nWaktu absensi telah dibuka. Jangan lupa untuk segera melakukan *Tap In Absensi* sekarang agar tidak terlambat.\n\nSemangat beraktivitas dan semoga hari ini lancar! ✨`,
    tapInWednesday: `⏰ *PENGINGAT KE POLTEK & TAP IN* ⏰\n\nSelamat pagi teman-teman! Halo @all 👋\nJangan lupa hari ini kita ada jadwal ke *Poltek*, persiapkan diri dan jangan sampai kesiangan ya!\n\nPastikan juga untuk segera melakukan *Tap In Absensi* saat tiba. Semangat kuliahnya dan hati-hati di jalan! 🚀📚✨`,
    tapOut: `⏰ *PENGINGAT TAP OUT ABSENSI* ⏰\n\nHalo @all 🌅\nJam operasional/kegiatan hari ini telah selesai. Pastikan sudah melakukan *Tap Out Absensi* sebelum meninggalkan lokasi/mengakhiri sesi.\n\nTerima kasih atas dedikasi dan kerja kerasnya hari ini, selamat beristirahat! 🏠✨`,
    test: `🧪 *[PESAN UJI COBA - BOT REMINDER]*\n\nHalo @all 👋\nIni adalah pesan uji coba (mode testing).\nBot WhatsApp pengingat absensi berhasil terhubung dan siap menjalankan jadwal otomatis! 🚀`
  },
  holidays: [
    '2026-01-01',
    '2026-01-28',
    '2026-01-29',
    '2026-03-21',
    '2026-03-31',
    '2026-04-01',
    '2026-04-03',
    '2026-05-01',
    '2026-05-14',
    '2026-05-31',
    '2026-06-01',
    '2026-06-16',
    '2026-07-07',
    '2026-08-17',
    '2026-09-15',
    '2026-12-25'
  ]
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    }
  } catch (err) {
    logger.error({ err }, 'Gagal membaca config.json, menggunakan konfigurasi default.');
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(newConfig) {
  const current = loadConfig();
  const merged = {
    ...current,
    ...newConfig,
    schedules: { ...current.schedules, ...(newConfig.schedules || {}) },
    templates: { ...current.templates, ...(newConfig.templates || {}) },
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

// Flag mode CLI argument: node index.js --test
const isTestMode = process.argv.includes('--test');

// Variabel referensi socket aktif dan daftar cron task
let currentSock = null;
let activeCronJobs = [];

// ============================================================================
// 2. HELPER TANGGAL & LIBUR
// ============================================================================
function getTodayDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function isHoliday(date = new Date()) {
  const todayStr = getTodayDateString(date);
  const config = loadConfig();
  return (config.holidays || []).includes(todayStr);
}

// ============================================================================
// 3. FUNGSI PENGIRIMAN PESAN REMINDER DENGAN CLEAN HIDETAG
// ============================================================================
async function sendReminder(type) {
  const todayStr = getTodayDateString();

  if (isHoliday()) {
    logger.info(`[HOLIDAY] Hari ini (${todayStr}) terdaftar sebagai hari libur. Pengingat '${type}' dilewati.`);
    return;
  }

  const config = loadConfig();
  const targetJid = config.targetGroupId || process.env.TARGET_GROUP_ID;
  if (!targetJid || targetJid === '120363028123456789@g.us') {
    logger.error('TARGET_GROUP_ID belum dikonfigurasi! Buka Web Dashboard atau edit file .env.');
    return;
  }

  if (!currentSock) {
    logger.error('Koneksi WhatsApp belum siap. Tidak dapat mengirim pesan reminder.');
    return;
  }

  const messageText = config.templates?.[type] || DEFAULT_CONFIG.templates[type];
  if (!messageText) {
    logger.error(`Template pesan tipe '${type}' tidak ditemukan.`);
    return;
  }

  try {
    logger.info(`Mengirim reminder '${type}' ke ${targetJid}...`);

    let finalMessage = messageText;
    let mentions = [];

    // Ambil daftar seluruh anggota jika target adalah grup WhatsApp (@g.us)
    if (targetJid.endsWith('@g.us')) {
      try {
        const groupMeta = await currentSock.groupMetadata(targetJid);
        mentions = groupMeta.participants.map((p) => p.id);

        // Buat deretan tag nomor anggota
        const mentionTags = mentions
          .map((id) => `@${id.split('@')[0].split(':')[0]}`)
          .join(' ');

        // Sisipkan karakter pemisah WhatsApp (Baca selengkapnya) agar pesan utama tetap rapi
        const readMore = String.fromCharCode(8206).repeat(4001);

        // Gabungkan: Pesan utama bersih di atas, tag resmi tersembunyi di bawah
        finalMessage = `${messageText}\n${readMore}\n\n*Tag All:*\n${mentionTags}`;
      } catch (err) {
        logger.warn('Gagal mengambil metadata grup untuk mention: ' + err.message);
      }
    }

    // Kirim pesan dengan menyertakan array mentions (semua member grup ternotifikasi)
    const sentMsg = await currentSock.sendMessage(targetJid, {
      text: finalMessage,
      mentions: mentions
    });

    logger.info({ messageId: sentMsg?.key?.id, totalMentions: mentions.length }, `[BERHASIL] Pesan pengingat '${type}' telah terkirim.`);
  } catch (err) {
    logger.error({ err }, `[GAGAL] Gagal mengirim pengingat '${type}'`);
  }
}

// ============================================================================
// 4. JADWAL CRON DINAMIS (Timezone: Asia/Jakarta)
// ============================================================================
function setupCronJobs() {
  // Hentikan jadwal cron lama jika ada (agar update jadwal langsung aktif)
  activeCronJobs.forEach(job => job.stop());
  activeCronJobs = [];

  const config = loadConfig();
  logger.info('Menyiapkan penjadwalan reminder otomatis (WIB / Asia/Jakarta)...');

  const timeToCron = (timeStr, dayOfWeek) => {
    const [hour, minute] = (timeStr || '08:00').split(':').map(Number);
    return `${minute} ${hour} * * ${dayOfWeek}`;
  };

  // 1. Senin, Selasa, Kamis, Jumat - Tap In
  const tapInCron = timeToCron(config.schedules?.regularTapIn || '08:00', '1,2,4,5');
  const job1 = cron.schedule(tapInCron, () => {
    logger.info(`[TRIGGER] Jadwal Tap In (Sen/Sel/Kam/Jum - ${config.schedules?.regularTapIn} WIB) tercapai.`);
    sendReminder('tapIn');
  }, { scheduled: true, timezone: 'Asia/Jakarta' });
  activeCronJobs.push(job1);

  // 2. Senin, Selasa, Kamis, Jumat - Tap Out
  const tapOutCron = timeToCron(config.schedules?.regularTapOut || '17:30', '1,2,4,5');
  const job2 = cron.schedule(tapOutCron, () => {
    logger.info(`[TRIGGER] Jadwal Tap Out (Sen/Sel/Kam/Jum - ${config.schedules?.regularTapOut} WIB) tercapai.`);
    sendReminder('tapOut');
  }, { scheduled: true, timezone: 'Asia/Jakarta' });
  activeCronJobs.push(job2);

  // 3. Khusus Hari Rabu - Tap In (Poltek)
  const wedTapInCron = timeToCron(config.schedules?.wednesdayTapIn || '06:00', '3');
  const job3 = cron.schedule(wedTapInCron, () => {
    logger.info(`[TRIGGER] Jadwal Khusus Tap In (Rabu - ${config.schedules?.wednesdayTapIn} WIB) tercapai.`);
    sendReminder('tapInWednesday');
  }, { scheduled: true, timezone: 'Asia/Jakarta' });
  activeCronJobs.push(job3);

  // 4. Khusus Hari Rabu - Tap Out
  const wedTapOutCron = timeToCron(config.schedules?.wednesdayTapOut || '16:00', '3');
  const job4 = cron.schedule(wedTapOutCron, () => {
    logger.info(`[TRIGGER] Jadwal Khusus Tap Out (Rabu - ${config.schedules?.wednesdayTapOut} WIB) tercapai.`);
    sendReminder('tapOut');
  }, { scheduled: true, timezone: 'Asia/Jakarta' });
  activeCronJobs.push(job4);

  logger.info('Semua cron schedule aktif:');
  logger.info(`- Sen, Sel, Kam, Jum : Tap In ${config.schedules?.regularTapIn} WIB | Tap Out ${config.schedules?.regularTapOut} WIB`);
  logger.info(`- Rabu               : Tap In ${config.schedules?.wednesdayTapIn} WIB | Tap Out ${config.schedules?.wednesdayTapOut} WIB`);
}

// ============================================================================
// 5. WEB DASHBOARD SERVER (Express.js)
// ============================================================================
function startWebServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // API Status & Current Config
  app.get('/api/status', async (req, res) => {
    const isConnected = !!(currentSock && currentSock.user);
    let groups = [];
    if (isConnected) {
      try {
        const participating = await currentSock.groupFetchAllParticipating();
        groups = Object.values(participating).map(g => ({ id: g.id, name: g.subject }));
      } catch (err) {
        logger.warn('Gagal memuat daftar grup untuk UI: ' + err.message);
      }
    }
    res.json({
      online: isConnected,
      user: currentSock?.user?.name || currentSock?.user?.id || null,
      config: loadConfig(),
      groups
    });
  });

  // API Simpan Konfigurasi
  app.post('/api/config', (req, res) => {
    try {
      const saved = saveConfig(req.body);
      setupCronJobs();
      logger.info('Konfigurasi diperbarui via Web Dashboard & jadwal diperbarui.');
      res.json({ success: true, config: saved });
    } catch (err) {
      logger.error({ err }, 'Gagal menyimpan konfigurasi dari Web UI');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // API Tes Kirim Pesan
  app.post('/api/test-send', async (req, res) => {
    try {
      await sendReminder('test');
      res.json({ success: true, message: 'Pesan uji coba berhasil dikirim!' });
    } catch (err) {
      logger.error({ err }, 'Gagal kirim pesan test dari Web UI');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`🌐 Web Dashboard aktif di http://localhost:${PORT}`);
  });
}

// ============================================================================
// 6. INISIALISASI KONEKSI BAILEYS & EVENT LISTENERS
// ============================================================================
async function startBot() {
  logger.info('Memulai koneksi ke WhatsApp...');

  // Menggunakan multi-file auth state agar sesi tersimpan di disk
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version, isLatest } = await fetchLatestBaileysVersion();

  logger.info(`Menggunakan Baileys v${version.join('.')}, versi terbaru: ${isLatest}`);

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }), // Heningkan log internal Baileys agar terminal bersih
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
    },
    printQRInTerminal: false, // Ditangani manual lewat qrcode-terminal
    generateHighQualityLinkPreview: false,
    browser: ['Attendance Reminder Bot', 'Desktop', '1.0.0']
  });

  currentSock = sock;

  // Handler update kredensial / auth keys
  sock.ev.on('creds.update', saveCreds);

  // Handler status koneksi
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Tampilkan QR Code di terminal jika pairing dibutuhkan
    if (qr) {
      console.log('\n======================================================');
      console.log('📱 SCAN QR CODE BERIKUT DENGAN WHATSAPP DI PONSEL ANDA');
      console.log('======================================================\n');
      qrcode.generate(qr, { small: true });
      console.log('\nPetunjuk: Buka WhatsApp > Perangkat Tertaut > Tautkan Perangkat.\n');
    }

    // Terputus
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn(`Koneksi terputus! Status Code: ${statusCode || 'Unknown'}. Reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        logger.info('Menyambung ulang secara otomatis dalam 5 detik...');
        setTimeout(() => {
          startBot();
        }, 5000);
      } else {
        logger.error('Sesi telah logout/dikeluarkan dari WhatsApp.');
        logger.error('Silakan hapus folder "auth_info", lalu jalankan ulang bot untuk scan QR baru.');
        process.exit(1);
      }
    }

    // Berhasil Terhubung
    if (connection === 'open') {
      logger.info('✅ Koneksi WhatsApp berhasil terhubung (Connection Open)!');

      // Tampilkan daftar semua grup WhatsApp yang diikuti
      try {
        logger.info('Mengambil daftar grup WhatsApp yang diikuti akun ini...');
        const groups = await sock.groupFetchAllParticipating();
        const groupList = Object.values(groups);

        console.log('\n=================================================================');
        console.log(`📋 DAFTAR GRUP WHATSAPP TERDETEKSI (${groupList.length} Grup):`);
        console.log('=================================================================');

        if (groupList.length === 0) {
          console.log('Akun ini belum bergabung ke grup WhatsApp mana pun.');
        } else {
          groupList.forEach((group, index) => {
            console.log(`${index + 1}. Nama Grup : ${group.subject}`);
            console.log(`   Group JID : ${group.id}`);
            console.log('-----------------------------------------------------------------');
          });
        }

        console.log('💡 TIP: Buka Web Dashboard di http://localhost:3000 untuk mengatur bot.');
        console.log('=================================================================\n');
      } catch (err) {
        logger.error({ err }, 'Gagal mengambil daftar grup WhatsApp');
      }

      // Eksekusi uji coba langsung jika flag --test diberikan
      if (isTestMode) {
        logger.info('🚀 [MODE TESTING AKTIF] Mengirim pesan pengujian segera...');
        setTimeout(async () => {
          await sendReminder('test');
          logger.info('Menunggu 5 detik untuk memastikan paket data tersinkronisasi ke server WhatsApp...');
          setTimeout(() => {
            logger.info('✅ Pesan uji coba selesai dikirim. Menghentikan mode test.');
            process.exit(0);
          }, 5000);
        }, 3000);
        return;
      }

      // Aktifkan jadwal pengingat untuk mode operasional normal
      setupCronJobs();
    }
  });
}

// Tangani graceful shutdown
process.on('SIGINT', () => {
  logger.info('Menerima sinyal SIGINT. Menghentikan bot...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Menerima sinyal SIGTERM. Menghentikan bot...');
  process.exit(0);
});

// Jalankan Web Server jika bukan mode CLI testing
if (!isTestMode) {
  startWebServer();
}

// Jalankan Bot
startBot().catch((err) => {
  logger.fatal({ err }, 'Kesalahan fatal saat startup bot');
  process.exit(1);
});
