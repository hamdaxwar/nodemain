const fs = require('fs');
const path = require('path');

/**
 * 1. LOAD EXTERNAL CONFIGS
 * Mengambil setting browser dan emoji dari folder root
 */
let HEADLESS_CONFIG = { headless: true };
try { 
    // Perhatikan path: keluar dari folder helpers ke root
    HEADLESS_CONFIG = require('../headless.js'); 
} catch (e) { 
    // console.log("[STATE] File headless.js tidak ditemukan."); 
}

let GLOBAL_COUNTRY_EMOJI = {};
try { 
    GLOBAL_COUNTRY_EMOJI = require('../country.json'); 
} catch (e) { 
    // console.log("[STATE] File country.json tidak ditemukan."); 
}

/**
 * 2. DATABASE CONFIG FILE PATH
 * Lokasi file penyimpanan dari dashboard HP (Root folder)
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
    // Sinkronisasi dengan key yang dikirim oleh aplikasi Android
    return {
        BOT_TOKEN: conf.BOT_TOKEN || "",
        BOT_TOKEN_MESSAGE: conf.BOT_TOKEN_MESSAGE || conf.BOT_TOKEN || "",
        BOT_TOKEN_RANGE: conf.BOT_TOKEN_RANGE || conf.BOT_TOKEN || "",
        
        API_URL: conf.BOT_TOKEN ? `https://api.telegram.org/bot${conf.BOT_TOKEN}` : "",
        
        CHAT_ID_MESSAGE: conf.CHAT_ID_MESSAGE || "",
        CHAT_ID_RANGE: conf.CHAT_ID_RANGE || "",
        
        // Konversi ke string agar pengecekan ID Telegram lebih aman
        GROUP_ID_1: conf.ID_GRUP_OTP || "", 
        GROUP_ID_2: "-1002364560126", // Statis jika tidak ada di JSON
        ADMIN_ID: String(conf.ADMIN_ID || "0"),
        
        STEX_EMAIL: conf.STEX_EMAIL || "",
        STEX_PASSWORD: conf.STEX_PASSWORD || "",
        
        LOGIN_URL: conf.URL_LOGIN || "https://stexsms.com/mauth/login",
        TARGET_URL: conf.URL_TARGET || "https://stexsms.com/mdashboard/getnum",
        
        BOT_USERNAME_LINK: conf.URL_GETNUM || "",
        GROUP_LINK_1: conf.URL_GRUP_OTP || "",
        GROUP_LINK_2: "https://t.me/zura14g",
        TELEGRAM_ADMIN_LINK: conf.URL_ADMIN || "https://t.me/Imr1d"
    };
}

/**
 * 4. GLOBAL STATE OBJECT
 */
const currentFileConfig = loadConfigFromFile();

const state = {
    // --- Fitur Status Bot ---
    isBotRunning: false,
    statusText: "Menunggu Konfigurasi",
    browser: null,
    sharedPage: null,
    
    // Antrian User & Input State
    verifiedUsers: new Set(),
    manualRangeInput: new Set(),
    waitingDanaInput: new Set(),
    pendingMessage: {}, // {userId: messageId}
    lastUsedRange: {},  // {userId: prefix}

    // --- Fitur Konfigurasi (Mapped from File) ---
    ...mapConfig(currentFileConfig),

    // --- Fitur Reload (Untuk sinkronisasi instan) ---
    reload: function() {
        const newConf = loadConfigFromFile();
        const mapped = mapConfig(newConf);
        Object.assign(this, mapped);
        console.log("[STATE] Konfigurasi di-reload dari bot_config.json");
    },

    // --- Static Settings ---
    OTP_PRICE: 0.003500,
    MIN_WD_AMOUNT: 1.000000,
    HEADLESS: HEADLESS_CONFIG.headless,
    COUNTRY_EMOJI: GLOBAL_COUNTRY_EMOJI,
    
    // Database Files
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
        2: "Mengisi form range nomor tujuan..",
        3: "Mengirim permintaan nomor baru go.",
        4: "Memulai pencarian di tabel data..",
        5: "Mencari nomor pada siklus satu run",
        8: "Mencoba ulang pada siklus dua wait",
        12: "Nomor ditemukan memproses data fin"
    },

    // --- Playwright Lock ---
    playwrightLock: {
        locked: false,
        isLocked: function() { return this.locked; },
        acquire: async function() {
            while (this.locked) {
                await new Promise(r => setTimeout(r, 100));
            }
            this.locked = true;
            return () => { this.locked = false; };
        }
    }
};

module.exports = {
    state: state,
    playwrightLock: state.playwrightLock
};
