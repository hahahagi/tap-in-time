# 🤖 Attendance Reminder Bot (WhatsApp)

Bot WhatsApp otomatis untuk pengingat (*reminder*) Tap In dan Tap Out absensi harian ke grup WhatsApp kelas atau tim kerja.

Dibangun dengan **Node.js** dan **[@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)**:
* ⚡ **100% Gratis**: Menggunakan multi-device WebSocket resmi WhatsApp Web tanpa biaya API per pesan.
* 🪶 **Sangat Ringan**: Tanpa browser (tanpa Puppeteer/Playwright/Chromium), penggunaan RAM hanya sekitar **30MB - 60MB**, sangat hemat dan cocok untuk VPS spek minimal (1 vCPU, 512MB/1GB RAM) maupun komputer lokal.
* ⏰ **Jadwal Akurat**: Menggunakan `node-cron` berbasis zona waktu **Asia/Jakarta (WIB)**.
* 🗓️ **Filter Hari Libur**: Otomatis melewati pengiriman pesan saat tanggal merah/libur nasional.
* 🔄 **Auto Reconnect**: Otomatis menyambung kembali jika koneksi terputus sesaat.

---

## 📁 Struktur File

```text
attendance-reminder-bot/
├── auth_info/            # Kredensial sesi WhatsApp (dibuat otomatis setelah scan QR)
├── .env                  # Konfigurasi variabel lingkungan lokal (jangan di-commit)
├── .env.example          # Template konfigurasi variabel lingkungan
├── .gitignore            # Mengabaikan node_modules, .env, dan auth_info
├── index.js              # Script utama bot, handler koneksi, dan jadwal cron
├── package.json          # Dependensi dan script NPM
└── README.md             # Panduan lengkap penggunaan
```

---

## 📅 Jadwal Pengingat Otomatis (WIB / Asia/Jakarta)

| Hari | Jam (WIB) | Jenis Reminder | Deskripsi |
| :--- | :--- | :--- | :--- |
| **Senin, Selasa, Kamis, Jumat** | `08:00` | **Tap In** | Pengingat absensi masuk kerja/kelas |
| **Senin, Selasa, Kamis, Jumat** | `17:30` | **Tap Out** | Pengingat absensi selesai jam kegiatan |
| **Rabu** *(Khusus)* | `06:00` | **Tap In** | Pengingat absensi masuk jadwal khusus (Ke Poltek) |
| **Rabu** *(Khusus)* | `16:00` | **Tap Out** | Pengingat absensi keluar jadwal khusus |
| **Sabtu & Minggu** | - | - | *Nonaktif (Weekend)* |
| **Tanggal Merah (Holiday)** | - | - | *Otomatis dilewati* |

---

## 🚀 Panduan Instalasi & Penggunaan

### 1. Prasyarat Sistem
* **Node.js**: Versi `18.x`, `20.x`, atau `22.x+`
* **NPM**: Bawaan instalasi Node.js

### 2. Clone atau Buka Folder Proyek
Masuk ke direktori proyek di terminal:
```bash
cd "C:\Users\hagis\Fun Project\attendance-reminder-bot"
```

### 3. Install Dependensi
Jalankan perintah berikut untuk mengunduh semua library yang diperlukan:
```bash
npm install
```

### 4. Salin & Atur File `.env`
Salin template konfigurasi `.env.example` menjadi `.env`:
* **Windows (PowerShell)**:
  ```powershell
  Copy-Item .env.example .env
  ```
* **Linux / macOS**:
  ```bash
  cp .env.example .env
  ```

---

## 🌐 Web Dashboard (Pengaturan Tanpa Edit Kodingan)

Bot ini dilengkapi **Web Dashboard lokal** yang sangat ringan (hanya menambah RAM ~10 MB) untuk mengatur bot langsung dari browser HP Anda:

1. Buka browser (Google Chrome) di HP Anda:
   👉 **`http://localhost:3000`**
2. **Fitur Dashboard:**
   * 👥 **Pilih Target Grup**: Otomatis mendeteksi nama-nama grup WhatsApp Anda dalam bentuk dropdown.
   * 🕒 **Atur Jam Pengingat**: Ubah jam Tap In dan Tap Out (Senin-Jumat & Rabu) via time-picker.
   * 💬 **Ubah Template Pesan**: Edit kata-kata pengingat langsung dari form teks.
   * 📅 **Kelola Hari Libur**: Tambah atau hapus tanggal merah hanya dengan beberapa klik.
   * 🧪 **Tes Kirim Seketika**: Tombol untuk mengirimkan pesan uji coba langsung ke grup target.
3. **Tips PWA / Shortcut Layar Utama:**
   * Di browser Chrome HP, klik ikon **titik tiga** di pojok kanan atas > pilih **"Tambahkan ke Layar Utama (Add to Home screen)"**.
   * Dashboard akan muncul seperti icon aplikasi biasa di layar utama HP Anda!

---

## 📱 Menghubungkan WhatsApp & Mendapatkan ID Grup

1. Jalankan bot untuk pertama kali:
   ```bash
   npm start
   ```
2. Terminal akan menampilkan **QR Code**:
   * Buka aplikasi WhatsApp di HP Anda.
   * Masuk ke menu **Pengaturan (Settings)** > **Perangkat Tertaut (Linked Devices)**.
   * Tekan tombol **Tautkan Perangkat (Link a Device)** dan arahkan kamera HP ke QR Code di terminal.
3. Setelah berhasil terhubung (`Connection Open`), bot akan **otomatis menampilkan daftar semua grup WhatsApp** yang diikuti oleh akun Anda beserta ID-nya:
   ```text
   =================================================================
   📋 DAFTAR GRUP WHATSAPP TERDETEKSI (3 Grup):
   =================================================================
   1. Nama Grup : Kelas Fullstack Web
      Group JID : 120363028123456789@g.us
   -----------------------------------------------------------------
   2. Nama Grup : Pengumuman Kantor
      Group JID : 120363198765432100@g.us
   =================================================================
   ```
4. Salin **Group JID** grup yang ingin Anda targetkan (contoh: `120363028123456789@g.us`), lalu buka file `.env` dan masukkan ke variabel `TARGET_GROUP_ID`:
   ```env
   TARGET_GROUP_ID=120363028123456789@g.us
   LOG_LEVEL=info
   ```
5. Simpan file `.env`. Anda tidak perlu scan QR lagi untuk seterusnya karena kredensial sudah tersimpan di folder `auth_info/`.

---

## 🧪 Menguji Pengiriman Pesan (Testing Mode)

Untuk memastikan bot dapat mengirim pesan ke grup target tanpa harus menunggu jam jadwal cron tiba, gunakan flag `--test`:

```bash
npm run test-send
```
*(Atau: `node index.js --test`)*

Begitu koneksi terbuka, bot akan langsung mengirim pesan uji coba ke grup yang terdaftar pada `TARGET_GROUP_ID` di file `.env`.

---

## 🛠️ Kustomisasi Pesan & Hari Libur

### 1. Mengubah Teks Pesan Pengingat
Buka file [`index.js`](./index.js) dan ubah isi objek `MESSAGE_TEMPLATES` di baris atas:
```javascript
const MESSAGE_TEMPLATES = {
  tapIn: `⏰ *PENGINGAT TAP IN ABSENSI* ⏰\n\nSelamat pagi!...`,
  tapOut: `⏰ *PENGINGAT TAP OUT ABSENSI* ⏰\n\nSelamat sore!...`,
  test: `🧪 *[PESAN UJI COBA]*\n\nBot berhasil terhubung!...`
};
```

### 2. Mengatur Tanggal Libur Nasional
Tambahkan tanggal merah baru (format `YYYY-MM-DD`) pada array `HOLIDAY_DATES` di file [`index.js`](./index.js):
```javascript
const HOLIDAY_DATES = [
  '2026-01-01',
  '2026-08-17',
  '2026-12-25',
  // Tambahkan tanggal cuti bersama / libur baru di sini
];
```

---

## 🔄 Menjalankan 24/7 di Background Menggunakan PM2 (Lokal & VPS)

Agar bot tetap berjalan di latar belakang meskipun jendela terminal atau koneksi SSH ditutup, gunakan **PM2** (Process Manager).

### 1. Install PM2 Secara Global
```bash
npm install -g pm2
```

### 2. Jalankan Bot Menggunakan PM2
```bash
pm2 start index.js --name attendance-bot
```

### 3. Perintah Berguna PM2
* **Melihat log aktivitas bot (real-time)**:
  ```bash
  pm2 logs attendance-bot
  ```
* **Melihat status bot**:
  ```bash
  pm2 status
  ```
* **Restart bot (misal setelah mengedit teks di `index.js`)**:
  ```bash
  pm2 restart attendance-bot
  ```
* **Menghentikan bot**:
  ```bash
  pm2 stop attendance-bot
  ```

### 4. Menjadikan Bot Otomatis Menyala Saat Komputer/VPS Dihidupkan Ulang (Auto Startup)
```bash
# Simpan daftar proses PM2 saat ini
pm2 save

# Buat script auto-start saat reboot
pm2 startup
```
*(Ikuti instruksi command yang dimunculkan PM2 jika diminta).*

---

## ❓ FAQ & Troubleshooting

* **Apakah nomor WhatsApp berisiko diblokir?**
  * Bot ini hanya mengirim pesan reminder terjadwal dalam frekuensi rendah (2 kali per hari) ke grup yang Anda ikuti, sehingga aman dari indikasi spam.
* **Bagaimana jika ingin ganti nomor atau scan ulang?**
  * Cukup hapus folder `auth_info/`, lalu jalankan kembali `npm start` untuk men-generate QR Code baru.
* **Koneksi internet sempat putus?**
  * Bot sudah dilengkapi *auto-reconnect* otomatis. Begitu jaringan kembali normal, bot akan menyambung kembali tanpa perlu di-restart manual.
