const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load Env
dotenv.config();

// Load Configs Eksternal
// Gunakan try-catch agar tidak crash jika file belum ada
let HEADLESS_CONFIG = { headless: true };
try { HEADLESS_CONFIG = require('./headless.js'); } catch(e){}

let GLOBAL_COUNTRY_EMOJI = {};
try { GLOBAL_COUNTRY_EMOJI = require('./country.json'); } catch(e){}

// Validasi Env
const requiredEnv = ['BOT_TOKEN', 'GROUP_ID_1', 'GROUP_ID_2', 'ADMIN_ID', 'STEX_EMAIL', 'STEX_PASSWORD'];
const missingEnv = requiredEnv.filter(key => !process.env[key]);

if (missingEnv.length > 0) {
    // Kita ganti console.error ke log biasa dan HAPUS process.exit(1)
    console.log(`[WARNING] Konfigurasi belum lengkap: ${missingEnv.join(', ')}`);
    console.log(`[AIDE] Server Dashboard tetap berjalan. Silakan lengkapi melalui App.`);
}

module.exports = {
    // Fungsi untuk reload ENV jika diupdate dari App tanpa restart manual
    reload: function() {
        const envConfig = dotenv.parse(fs.readFileSync('.env'));
        for (const k in envConfig) {
            process.env[k] = envConfig[k];
        }
        console.log("[CONFIG] Environment variables reloaded.");
    },

    // API & IDs (Gunakan fallback string kosong agar tidak error undefined)
    BOT_TOKEN: process.env.BOT_TOKEN || "",
    API_URL: `https://api.telegram.org/bot${process.env.BOT_TOKEN || ""}`,
    GROUP_ID_1: parseInt(process.env.GROUP_ID_1) || 0,
    GROUP_ID_2: parseInt(process.env.GROUP_ID_2) || 0,
    ADMIN_ID: parseInt(process.env.ADMIN_ID) || 0,
    
    // STEX Credentials
    STEX_EMAIL: process.env.STEX_EMAIL || "",
    STEX_PASSWORD: process.env.STEX_PASSWORD || "",

    // URLs
    LOGIN_URL: "https://stexsms.com/mauth/login",
    TARGET_URL: "https://stexsms.com/mdashboard/getnum",
    BOT_USERNAME_LINK: "https://t.me/myzuraisgoodbot", 
    GROUP_LINK_1: "https://t.me/+E5grTSLZvbpiMTI1",
    GROUP_LINK_2: "https://t.me/zura14g",

    // Settings
    OTP_PRICE: 0.003500,
    MIN_WD_AMOUNT: 1.000000,
    HEADLESS: HEADLESS_CONFIG.headless,
    COUNTRY_EMOJI: GLOBAL_COUNTRY_EMOJI,

    // Files Paths
    FILES: {
        USER: "user.json",
        CACHE: "cache.json",
        INLINE_RANGE: "inline.json",
        WAIT: "wait.json",
        AKSES_GET10: "aksesget10.json",
        PROFILE: "profile.json"
    },

    // Progress Bar
    BAR: {
        MAX_LENGTH: 12,
        FILLED: "█",
        EMPTY: "░"
    },

    // Status Map Scraper
    STATUS_MAP: {
        0: "Menunggu di antrian sistem aktif..",
        3: "Mengirim permintaan nomor baru go.",
        4: "Memulai pencarian di tabel data..",
        5: "Mencari nomor pada siklus satu run",
        8: "Mencoba ulang pada siklus dua wait",
        12: "Nomor ditemukan memproses data fin"
    }
};
