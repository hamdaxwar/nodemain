const fs = require('fs');
const path = require('path');

// Lokasi bot_config.json di root folder
const CONFIG_FILE = path.join(process.cwd(), 'bot_config.json');

/**
 * Fungsi internal untuk membaca file JSON dari disk
 */
function loadRawConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("[STATE] Gagal membaca bot_config.json:", e.message);
    }
    return {};
}

// Inisialisasi variabel Set di luar agar tidak ter-reset saat reload() dipanggil
const _verifiedUsers = new Set();
const _manualRangeInput = new Set();
const _waitingDanaInput = new Set();
const _waitingAdminInput = new Set();
const _waitingBroadcastInput = new Set();
const _get10RangeInput = new Set();

const state = {
    // --- Properti Set (Getter agar tetap konsisten di seluruh modul) ---
    get verifiedUsers() { return _verifiedUsers; },
    get manualRangeInput() { return _manualRangeInput; },
    get waitingDanaInput() { return _waitingDanaInput; },
    get waitingAdminInput() { return _waitingAdminInput; },
    get waitingBroadcastInput() { return _waitingBroadcastInput; },
    get get10RangeInput() { return _get10RangeInput; },

    // --- Objek Pendukung Sesi Chat ---
    pendingMessage: {},
    broadcastMessage: {},
    lastUsedRange: {},

    // --- Status Operasional (Memory Sesi) ---
    isBotRunning: false,
    statusText: "Idle",
    browser: null,
    sharedPage: null, 
    
    // --- VARIABEL DINAMIS (INGATAN DARI JSON) ---
    
    // PENGATURAN BROWSER (Tampil/Tidak)
    HEADLESS: true,        // Default true (tidak tampil). Jika di JSON ada "HEADLESS": false, maka akan tampil.

    // Token Bot
    BOT_TOKEN: "",         
    BOT_TOKEN_RANGE: "",   
    BOT_TOKEN_MESSAGE: "", 
    API_URL: "",           

    // Identitas & Link
    ADMIN_ID: "",
    URL_ADMIN: "",
    URL_GETNUM: "",
    URL_GRUP_OTP: "",

    // Akun Stex & Login
    STEX_EMAIL: "",
    STEX_PASSWORD: "",
    LOGIN_URL: "",

    // Target Navigasi (Browser URLs)
    TARGET_URL: "",          
    URL_TARGET_RANGE: "",    
    URL_TARGET_MESSAGE: "",  

    // Chat IDs (Tujuan Pengiriman)
    CHAT_ID_MESSAGE: "",
    CHAT_ID_RANGE: "",
    GROUP_ID_1: "",
    GROUP_ID_2: "",

    /**
     * Sinkronisasi Ulang Ingatan Sesi
     */
    reload: function() {
        const conf = loadRawConfig();
        
        // Browser Config
        // Jika di JSON "HEADLESS" bernilai false, maka browser tampil
        this.HEADLESS = conf.HEADLESS !== undefined ? conf.HEADLESS : true;

        // Token & API
        this.BOT_TOKEN = conf.BOT_TOKEN_GETNUM || "";
        this.BOT_TOKEN_RANGE = conf.BOT_TOKEN_RANGE || "";
        this.BOT_TOKEN_MESSAGE = conf.BOT_TOKEN_MESSAGE || "";
        this.API_URL = this.BOT_TOKEN ? `https://api.telegram.org/bot${this.BOT_TOKEN}` : "";
        
        // Admin & Link
        this.ADMIN_ID = String(conf.ADMIN_ID || "");
        this.URL_ADMIN = conf.URL_ADMIN || "";
        this.URL_GETNUM = conf.URL_GETNUM || "";
        this.URL_GRUP_OTP = conf.URL_GRUP_OTP || "";
        
        // Stex Credentials
        this.STEX_EMAIL = conf.EMAIL || "";
        this.STEX_PASSWORD = conf.PASSWORD || "";
        this.LOGIN_URL = conf.URL_LOGIN || "";
        
        // Target Dashboard URLs
        this.TARGET_URL = conf.URL_TARGET_GETNUM || "";
        this.URL_TARGET_RANGE = conf.URL_TARGET_RANGE || "";
        this.URL_TARGET_MESSAGE = conf.URL_TARGET_MESSAGE || "";
        
        // Grup & Chat IDs
        this.CHAT_ID_MESSAGE = conf.CHAT_ID_MESSAGE || "";
        this.CHAT_ID_RANGE = conf.CHAT_ID_RANGE || "";
        this.GROUP_ID_1 = conf.GROUP_ID_1 || "";
        this.GROUP_ID_2 = conf.GROUP_ID_2 || "";

        console.log(`[STATE] Ingatan Sesi Sinkron. Browser Headless: ${this.HEADLESS}`);
    },

    // Konfigurasi Tambahan
    OTP_PRICE: 0.003500,
    FILES: {
        USER: "user.json",
        PROFILE: "profile.json",
        WAIT: "wait.json",
        SMC: "smc.json"
    },
    
    // --- SISTEM PENGUNCI (LOCK) PLAYWRIGHT ---
    playwrightLock: {
        locked: false,
        isLocked: function() { return this.locked; },
        acquire: async function() {
            while (this.locked) { await new Promise(r => setTimeout(r, 100)); }
            this.locked = true;
            return () => { this.locked = false; };
        }
    }
};

// Panggil reload pertama kali
state.reload();

module.exports = { 
    state: state, 
    playwrightLock: state.playwrightLock 
};
