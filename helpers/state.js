const fs = require('fs');
const path = require('path');

/**
 * 1. LOAD EXTERNAL CONFIGS
 * Mengambil setting browser dan emoji dari folder root
 */
let HEADLESS_CONFIG = { headless: true };
try { 
    HEADLESS_CONFIG = require('../headless.js'); 
} catch (e) { 
    console.log("[STATE] File headless.js tidak ditemukan."); 
}

let GLOBAL_COUNTRY_EMOJI = {};
try { 
    GLOBAL_COUNTRY_EMOJI = require('../country.json'); 
} catch (e) { 
    console.log("[STATE] File country.json tidak ditemukan."); 
}

/**
 * 2. DATABASE CONFIG FILE PATH
 * Lokasi file penyimpanan dari dashboard HP
 */
const CONFIG_FILE = path.join(__dirname, '../bot_config.json');

/**
 * 3. INTERNAL HELPER: LOAD & MAP CONFIG
 */
function loadConfigFromFile() {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        } catch (e) {
            console.error("[STATE] Gagal membaca bot_config.json");
            return {};
        }
    }
    return {};
}

function mapConfig(conf) {
    return {
        BOT_TOKEN: conf.BOT_TOKEN || "",
        BOT_TOKEN_MESSAGE: conf.BOT_TOKEN_MESSAGE || conf.BOT_TOKEN || "",
        BOT_TOKEN_RANGE: conf.BOT_TOKEN_RANGE || conf.BOT_TOKEN || "",
        
        API_URL: conf.BOT_TOKEN ? `https://api.telegram.org/bot${conf.BOT_TOKEN}` : "",
        
        CHAT_ID_MESSAGE: conf.CHAT_ID_MESSAGE || "",
        CHAT_ID_RANGE: conf.CHAT_ID_RANGE || "",
        
        GROUP_ID_1: parseInt(conf.GROUP_ID_1 || 0),
        GROUP_ID_2: parseInt(conf.GROUP_ID_2 || 0),
        ADMIN_ID: parseInt(conf.ADMIN_ID || 0),
        
        STEX_EMAIL: conf.EMAIL || "",
        STEX_PASSWORD: conf.PASSWORD || "",
        
        LOGIN_URL: conf.URL_LOGIN || "https://stexsms.com/mauth/login",
        TARGET_URL: conf.URL_TARGET_GETNUM || "https://stexsms.com/mdashboard/getnum",
        URL_TARGET_RANGE: conf.URL_TARGET_RANGE || "",
        URL_TARGET_MESSAGE: conf.URL_TARGET_MESSAGE || "",
        
        BOT_USERNAME_LINK: conf.URL_GETNUM || "",
        GROUP_LINK_1: conf.URL_GRUP_OTP || "",
        GROUP_LINK_2: "https://t.me/zura14g",
        TELEGRAM_ADMIN_LINK: conf.URL_ADMIN || ""
    };
}

/**
 * 4. GLOBAL STATE OBJECT
 * Menggabungkan semua fitur: Status Running, Data Config, dan Static Settings.
 */
const currentFileConfig = loadConfigFromFile();

const state = {
    // --- Fitur Status Bot ---
    isBotRunning: false,
    statusText: "Menunggu Konfigurasi",
    browser: null,
    
    // --- Fitur Konfigurasi (Mapped from File) ---
    ...mapConfig(currentFileConfig),

    // --- Fitur Reload (Untuk tombol restart di App) ---
    reload: function() {
        const newConf = loadConfigFromFile();
        const mapped = mapConfig(newConf);
        Object.assign(this, mapped);
        console.log("[STATE] Konfigurasi berhasil diperbarui dari file.");
    },

    // --- Static Settings ---
    OTP_PRICE: 0.003500,
    MIN_WD_AMOUNT: 1.000000,
    HEADLESS: HEADLESS_CONFIG.headless,
    COUNTRY_EMOJI: GLOBAL_COUNTRY_EMOJI,
    
    FILES: {
        USER: "user.json",
        CACHE: "cache.json",
        INLINE_RANGE: "inline.json",
        WAIT: "wait.json",
        AKSES_GET10: "aksesget10.json",
        PROFILE: "profile.json",
        SMC: "smc.json"
    },

    BAR: {
        MAX_LENGTH: 12,
        FILLED: "█",
        EMPTY: "░"
    },

    STATUS_MAP: {
        0: "Menunggu di antrian sistem aktif..",
        3: "Mengirim permintaan nomor baru go.",
        4: "Memulai pencarian di tabel data..",
        5: "Mencari nomor pada siklus satu run",
        8: "Mencoba ulang pada siklus dua wait",
        12: "Nomor ditemukan memproses data fin"
    },

    // --- Playwright Lock Feature ---
    playwrightLock: {
        locked: false,
        acquire: async function() {
            while (this.locked) {
                await new Promise(r => setTimeout(r, 100));
            }
            this.locked = true;
            return () => { this.locked = false; };
        }
    }
};

/**
 * 5. EXPORTS
 * Agar bisa dipanggil di main.js dengan: const { state, playwrightLock } = require('./helpers/state');
 */
module.exports = {
    state: state,
    playwrightLock: state.playwrightLock
};

