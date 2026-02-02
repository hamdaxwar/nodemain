const fs = require('fs');
const path = require('path');

// Lokasi bot_config.json di root folder
const CONFIG_FILE = path.join(process.cwd(), 'bot_config.json');

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

// Inisialisasi variabel Set/Object di luar agar tidak terhapus saat reload
const _verifiedUsers = new Set();
const _manualRangeInput = new Set();
const _waitingDanaInput = new Set();
const _waitingAdminInput = new Set();
const _waitingBroadcastInput = new Set();
const _get10RangeInput = new Set();

const state = {
    // Properti Set (Getter agar selalu valid)
    get verifiedUsers() { return _verifiedUsers; },
    get manualRangeInput() { return _manualRangeInput; },
    get waitingDanaInput() { return _waitingDanaInput; },
    get waitingAdminInput() { return _waitingAdminInput; },
    get waitingBroadcastInput() { return _waitingBroadcastInput; },
    get get10RangeInput() { return _get10RangeInput; },

    // Properti Objek Pendukung
    pendingMessage: {},
    broadcastMessage: {},
    lastUsedRange: {},

    // Status Bot
    isBotRunning: false,
    statusText: "Idle",
    browser: null,
    sharedPage: null, // Tambahkan ini jika scraper membutuhkannya
    
    // Properti dari JSON
    BOT_TOKEN: "",
    API_URL: "",
    ADMIN_ID: "",
    STEX_EMAIL: "",
    STEX_PASSWORD: "",
    LOGIN_URL: "",
    TARGET_URL: "",
    URL_TARGET_RANGE: "",
    URL_TARGET_MESSAGE: "",
    GROUP_ID_1: "",
    GROUP_LINK_1: "",

    /**
     * Memperbarui data dari file JSON
     */
    reload: function() {
        const conf = loadRawConfig();
        
        this.BOT_TOKEN = conf.BOT_TOKEN_GETNUM || "";
        this.API_URL = this.BOT_TOKEN ? `https://api.telegram.org/bot${this.BOT_TOKEN}` : "";
        
        this.ADMIN_ID = String(conf.ADMIN_ID || "");
        this.STEX_EMAIL = conf.EMAIL || "";
        this.STEX_PASSWORD = conf.PASSWORD || "";
        
        this.LOGIN_URL = conf.URL_LOGIN || "";
        this.TARGET_URL = conf.URL_TARGET_GETNUM || "";
        this.URL_TARGET_RANGE = conf.URL_TARGET_RANGE || "";
        this.URL_TARGET_MESSAGE = conf.URL_TARGET_MESSAGE || "";
        
        this.GROUP_ID_1 = conf.GROUP_ID_1 || "";
        this.GROUP_LINK_1 = conf.URL_GRUP_OTP || "";

        console.log("[STATE] Sinkronisasi bot_config.json Berhasil.");
    },

    OTP_PRICE: 0.003500,
    FILES: {
        USER: "user.json",
        PROFILE: "profile.json",
        WAIT: "wait.json",
        SMC: "smc.json"
    },
    
    // LOCK SYSTEM UNTUK PLAYWRIGHT (Lengkap dengan isLocked)
    playwrightLock: {
        locked: false,
        isLocked: function() {
            return this.locked;
        },
        acquire: async function() {
            while (this.locked) {
                await new Promise(r => setTimeout(r, 100));
            }
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
