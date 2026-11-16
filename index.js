/**
 * Attendance Reminder Bot
 * Bot WhatsApp otomatis pengingat absensi berbasis Baileys dan node-cron.
 * Ringan, hemat RAM, tanpa browser/Puppeteer.
 */

require('dotenv').config();
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

// ============================================================================
// 1. TEMPLATE PESAN PENGINGAT
// ============================================================================
const MESSAGE_TEMPLATES = {
  tapIn: `⏰ *PENGINGAT TAP IN ABSENSI* ⏰\n\nHalo @all 👋\nWaktu absensi telah dibuka. Jangan lupa untuk segera melakukan *Tap In Absensi* sekarang agar tidak terlambat.\n\nSemangat beraktivitas dan semoga hari ini lancar! ✨`,
  tapOut: `⏰ *PENGINGAT TAP OUT ABSENSI* ⏰\n\nHalo @all 🌅\nJam operasional/kegiatan hari ini telah selesai. Pastikan sudah melakukan *Tap Out Absensi* sebelum meninggalkan lokasi/mengakhiri sesi.\n\nTerima kasih atas dedikasi dan kerja kerasnya hari ini, selamat beristirahat! 🏠✨`,
  test: `🧪 *[PESAN UJI COBA - BOT REMINDER]*\n\nHalo @all 👋\nIni adalah pesan uji coba (mode testing).\nBot WhatsApp pengingat absensi berhasil terhubung dan siap menjalankan jadwal otomatis! 🚀`
};

// ============================================================================
// 2. DAFTAR TANGGAL LIBUR NASIONAL / CUTI BERSAMA (Format: YYYY-MM-DD)
// Tambahkan tanggal merah di sini agar bot tidak mengirim reminder di hari libur.
// ============================================================================
const HOLIDAY_DATES = [
  // Contoh daftar hari libur (silakan disesuaikan setiap tahun/kebutuhan):
  '2026-01-01', // Tahun Baru Masehi
  '2026-01-28', // Isra Miraj
  '2026-01-29', // Tahun Baru Imlek
  '2026-03-21', // Hari Suci Nyepi
  '2026-03-31', // Hari Raya Idul Fitri
  '2026-04-01', // Hari Raya Idul Fitri
  '2026-04-03', // Wafat Isa Al Masih
  '2026-05-01', // Hari Buruh Internasional
  '2026-05-14', // Kenaikan Isa Al Masih
  '2026-05-31', // Hari Raya Waisak
  '2026-06-01', // Hari Lahir Pancasila
  '2026-06-16', // Hari Raya Idul Adha
  '2026-07-07', // Tahun Baru Islam
  '2026-08-17', // Hari Kemerdekaan RI
  '2026-09-15', // Maulid Nabi Muhammad SAW
  '2026-12-25', // Hari Raya Natal
];

// Inisialisasi Logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime
});

// Flag mode CLI argument: node index.js --test
const isTestMode = process.argv.includes('--test');

// Variabel referensi socket aktif
let currentSock = null;
let isCronInitialized = false;

// ============================================================================
// 3. HELPER TANGGAL & LIBUR
// ============================================================================
function getTodayDateString(date = new Date()) {
  // Menghasilkan string YYYY-MM-DD sesuai Timezone Asia/Jakarta (WIB)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function isHoliday(date = new Date()) {
  const todayStr = getTodayDateString(date);
  return HOLIDAY_DATES.includes(todayStr);
}

// ============================================================================
// 4. FUNGSI PENGIRIMAN PESAN REMINDER
// ============================================================================
async function sendReminder(type) {
  const todayStr = getTodayDateString();

  if (isHoliday()) {
    logger.info(`[HOLIDAY] Hari ini (${todayStr}) terdaftar sebagai hari libur. Pengingat '${type}' dilewati.`);
    return;
  }

  const targetJid = process.env.TARGET_GROUP_ID;
  if (!targetJid || targetJid === '120363028123456789@g.us') {
    logger.error('TARGET_GROUP_ID belum dikonfigurasi di file .env! Pesan tidak dapat dikirim.');
    return;
  }

  if (!currentSock) {
    logger.error('Koneksi WhatsApp belum siap. Tidak dapat mengirim pesan reminder.');
    return;
  }

  const messageText = MESSAGE_TEMPLATES[type];
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
// 5. JADWAL CRON (Timezone: Asia/Jakarta)
// ============================================================================
function setupCronJobs() {
  if (isCronInitialized) {
    return;
  }
  isCronInitialized = true;

  logger.info('Menyiapkan penjadwalan reminder otomatis (WIB / Asia/Jakarta)...');

  // 1. Senin, Selasa, Kamis, Jumat (1,2,4,5) - Jam 08:00 WIB (Tap In)
  cron.schedule('0 8 * * 1,2,4,5', () => {
    logger.info('[TRIGGER] Jadwal Tap In (Senin/Selasa/Kamis/Jumat - 08:00 WIB) tercapai.');
    sendReminder('tapIn');
  }, {
    scheduled: true,
    timezone: 'Asia/Jakarta'
  });

  // 2. Senin, Selasa, Kamis, Jumat (1,2,4,5) - Jam 17:30 WIB (Tap Out)
  cron.schedule('30 17 * * 1,2,4,5', () => {
    logger.info('[TRIGGER] Jadwal Tap Out (Senin/Selasa/Kamis/Jumat - 17:30 WIB) tercapai.');
    sendReminder('tapOut');
  }, {
    scheduled: true,
    timezone: 'Asia/Jakarta'
  });

  // 3. Khusus Hari Rabu (3) - Jam 06:30 WIB (Tap In)
  cron.schedule('30 6 * * 3', () => {
    logger.info('[TRIGGER] Jadwal Khusus Tap In (Rabu - 06:30 WIB) tercapai.');
    sendReminder('tapIn');
  }, {
    scheduled: true,
    timezone: 'Asia/Jakarta'
  });

  // 4. Khusus Hari Rabu (3) - Jam 16:00 WIB (Tap Out)
  cron.schedule('0 16 * * 3', () => {
    logger.info('[TRIGGER] Jadwal Khusus Tap Out (Rabu - 16:00 WIB) tercapai.');
    sendReminder('tapOut');
  }, {
    scheduled: true,
    timezone: 'Asia/Jakarta'
  });

  logger.info('Semua cron schedule aktif:');
  logger.info('- Sen, Sel, Kam, Jum : Tap In 08:00 WIB | Tap Out 17:30 WIB');
  logger.info('- Rabu               : Tap In 06:30 WIB | Tap Out 16:00 WIB');
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

        console.log('💡 TIP: Salin "Group JID" grup kelas Anda ke TARGET_GROUP_ID di file .env');
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

// Jalankan bot
startBot().catch((err) => {
  logger.fatal({ err }, 'Kesalahan fatal saat startup bot');
  process.exit(1);
});
