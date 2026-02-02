const fs = require('fs');
const path = require('path');

// PERBAIKAN: Gunakan ../ karena state.js ada di dalam folder helpers
const CONFIG_FILE = path.join(__dirname, '../bot_config.json');

function loadRawConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            return JSON.parse(data);
        } else {
            // Log ini akan muncul jika path masih salah
            console.error(`[STATE] File TIDAK ditemukan di: ${CONFIG_FILE}`);
        }
    } catch (e) {
        console.error("[STATE] Gagal parsing JSON:", e.message);
    }
    return {};
}

const state = {
    // Properti Set harus diinisialisasi agar .has() tidak undefined
    verifiedUsers: new Set(),
    manualRangeInput: new Set(),
    waitingDanaInput: new Set(),
    pendingMessage: {},
    lastUsedRange: {},

    isBotRunning: false,
    statusText: "Idle",
    browser: null,
    
    // Properti Dinamis
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

    reload: function() {
        const conf = loadRawConfig();
        
        // Update manual agar properti Set di atas tidak tertimpa/hilang
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

        console.log("[STATE] Sinkronisasi bot_config.json selesai.");
    },

    OTP_PRICE: 0.003500,
    FILES: {
        USER: "user.json",
        PROFILE: "profile.json",
        WAIT: "wait.json",
        SMC: "smc.json"
    },
    
    playwrightLock: {
        locked: false,
        acquire: async function() {
            while (this.locked) await new Promise(r => setTimeout(r, 100));
            this.locked = true;
            return () => { this.locked = false; };
        }
    }
};

// Eksekusi reload pertama kali
state.reload();

module.exports = { state, playwrightLock: state.playwrightLock };
