const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(process.cwd(), 'bot_config.json');

/**
 * Membaca bot_config.json secara realtime
 */
function loadRawConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {
        console.error("[STATE] Gagal membaca bot_config.json:", e.message);
    }
    return {};
}

// Inisialisasi Set untuk antrean input user
const _verifiedUsers = new Set();
const _manualRangeInput = new Set();
const _waitingDanaInput = new Set();
const _waitingAdminInput = new Set();
const _waitingBroadcastInput = new Set();
const _get10RangeInput = new Set();

const state = {
    // --- Antrean Sesi ---
    get verifiedUsers() { return _verifiedUsers; },
    get manualRangeInput() { return _manualRangeInput; },
    get waitingDanaInput() { return _waitingDanaInput; },
    get waitingAdminInput() { return _waitingAdminInput; },
    get waitingBroadcastInput() { return _waitingBroadcastInput; },
    get get10RangeInput() { return _get10RangeInput; },

    // --- Memory Browser & Bot ---
    isBotRunning: false,
    statusText: "Idle",
    browser: null,
    sharedPage: null,
    pendingMessage: {},
    broadcastMessage: {},
    lastUsedRange: {},

    /**
     * Sinkronisasi data dari JSON ke memory script
     */
    reload: function() {
        const conf = loadRawConfig();
        
        // Browser Settings
        // Jika di bot_config.json "HEADLESS" : false, maka browser muncul
        this.HEADLESS = conf.HEADLESS !== undefined ? conf.HEADLESS : true;

        // API & Tokens
        this.BOT_TOKEN = conf.BOT_TOKEN_GETNUM || "";
        this.BOT_TOKEN_RANGE = conf.BOT_TOKEN_RANGE || "";
        this.BOT_TOKEN_MESSAGE = conf.BOT_TOKEN_MESSAGE || "";
        this.API_URL = this.BOT_TOKEN ? `https://api.telegram.org/bot${this.BOT_TOKEN}` : "";
        
        // IDs
        this.ADMIN_ID = String(conf.ADMIN_ID || "");
        this.GROUP_ID_1 = conf.GROUP_ID_1 || "";
        this.GROUP_ID_2 = conf.GROUP_ID_2 || "";
        
        // URLs
        this.STEX_EMAIL = conf.EMAIL || "";
        this.STEX_PASSWORD = conf.PASSWORD || "";
        this.LOGIN_URL = conf.URL_LOGIN || "https://stexsms.com/mauth/login";
        this.TARGET_URL = conf.URL_TARGET_GETNUM || "https://stexsms.com/mdashboard/getnum";
        this.URL_TARGET_RANGE = conf.URL_TARGET_RANGE || "";
        this.URL_TARGET_MESSAGE = conf.URL_TARGET_MESSAGE || "";
        
        this.URL_ADMIN = conf.URL_ADMIN || "";
        this.URL_GETNUM = conf.URL_GETNUM || "https://t.me/myzuraisgoodbot";
        this.URL_GRUP_OTP = conf.URL_GRUP_OTP || "https://t.me/+E5grTSLZvbpiMTI1";

        console.log(`[STATE] Config Reloaded. Headless: ${this.HEADLESS}`);
    },

    // Pengaturan Tetap
    OTP_PRICE: 0.003500,
    BAR: { MAX_LENGTH: 12, FILLED: "█", EMPTY: "░" },
    FILES: {
        USER: "user.json",
        PROFILE: "profile.json",
        WAIT: "wait.json",
        SMC: "smc.json",
        CACHE: "cache.json"
    },
    
    // Lock Playwright agar tidak tabrakan
    playwrightLock: {
        locked: false,
        async acquire() {
            while (this.locked) { await new Promise(r => setTimeout(r, 100)); }
            this.locked = true;
            return () => { this.locked = false; };
        }
    }
};

// Jalankan reload pertama kali saat script dipanggil
state.reload();

module.exports = { state, playwrightLock: state.playwrightLock };
