const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(process.cwd(), 'bot_config.json');

function loadRawConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {
        console.error("[STATE] Error reading JSON:", e.message);
    }
    return {};
}

const state = {
    // --- Status Bot ---
    isBotRunning: false,
    statusText: "Idle",
    browser: null,
    
    // --- State Logic (WAJIB ADA UNTUK COMMANDS.JS) ---
    verifiedUsers: new Set(),
    manualRangeInput: new Set(),
    waitingDanaInput: new Set(),
    pendingMessage: {},
    lastUsedRange: {},

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

        console.log("[STATE] Data sinkron dengan bot_config.json");
    },

    // --- Config Statis ---
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

// Jalankan reload pertama kali
state.reload();

module.exports = { state, playwrightLock: state.playwrightLock };
