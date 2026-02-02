const path = require('path');
const fs = require('fs');

const configPath = path.join(__dirname, 'bot_config.json');

// Fungsi untuk membaca file JSON secara dinamis
function getJsonConfig() {
    try {
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.log("[CONFIG] Gagal membaca bot_config.json");
    }
    return {};
}

// Ambil data awal
let json = getJsonConfig();

// Load Configs Eksternal
let HEADLESS_CONFIG = { headless: true };
try { HEADLESS_CONFIG = require('./headless.js'); } catch(e){}

let GLOBAL_COUNTRY_EMOJI = {};
try { GLOBAL_COUNTRY_EMOJI = require('./country.json'); } catch(e){}

const configObject = {
    // Fungsi untuk reload data jika diupdate dari App Android
    reload: function() {
        const newData = getJsonConfig();
        Object.assign(this, {
            BOT_TOKEN: newData.BOT_TOKEN_GETNUM || "",
            STEX_EMAIL: newData.EMAIL || "",
            STEX_PASSWORD: newData.PASSWORD || "",
            GROUP_ID_1: newData.GROUP_ID_1 || 0,
            GROUP_ID_2: newData.GROUP_ID_2 || 0,
            ADMIN_ID: newData.ADMIN_ID || 0,
            LOGIN_URL: newData.URL_LOGIN || "https://stexsms.com/mauth/login",
            TARGET_URL: newData.URL_TARGET_GETNUM || "https://stexsms.com/mdashboard/getnum",
            BOT_USERNAME_LINK: newData.URL_GETNUM || "https://t.me/myzuraisgoodbot",
            GROUP_LINK_1: newData.URL_GRUP_OTP || "https://t.me/+E5grTSLZvbpiMTI1",
            // Simpan semua data mentah juga
            raw: newData 
        });
        this.API_URL = `https://api.telegram.org/bot${this.BOT_TOKEN}`;
        console.log("[CONFIG] bot_config.json reloaded and mapped.");
    },

    // Mapping Data dari JSON ke Variabel yang dibutuhkan main.js
    BOT_TOKEN: json.BOT_TOKEN_GETNUM || "",
    STEX_EMAIL: json.EMAIL || "",
    STEX_PASSWORD: json.PASSWORD || "",
    
    // IDs (Convert string ke number jika perlu)
    GROUP_ID_1: json.GROUP_ID_1 || 0,
    GROUP_ID_2: json.GROUP_ID_2 || 0,
    ADMIN_ID: json.ADMIN_ID || 0,
    
    // URLs (Diambil dari inputan aplikasi Android kamu)
    LOGIN_URL: json.URL_LOGIN || "https://stexsms.com/mauth/login",
    TARGET_URL: json.URL_TARGET_GETNUM || "https://stexsms.com/mdashboard/getnum",
    BOT_USERNAME_LINK: json.URL_GETNUM || "https://t.me/myzuraisgoodbot", 
    GROUP_LINK_1: json.URL_GRUP_OTP || "https://t.me/+E5grTSLZvbpiMTI1",
    GROUP_LINK_2: "https://t.me/zura14g",

    // Settings Tetap
    API_URL: `https://api.telegram.org/bot${json.BOT_TOKEN_GETNUM || ""}`,
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

// Validasi saat startup
if (!configObject.BOT_TOKEN) {
    console.log(`[WARNING] BOT_TOKEN tidak ditemukan di bot_config.json`);
    console.log(`[AIDE] Silakan lengkapi melalui App Android.`);
} else {
    console.log(`[SUCCESS] Bot Token terdeteksi dari JSON.`);
}

module.exports = configObject;
