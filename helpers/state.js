const fs = require('fs');
const path = require('path');

// Lokasi bot_config.json di root folder
const CONFIG_FILE = path.join(__dirname, '../bot_config.json');

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
    // Status Internal Bot
    isBotRunning: false,
    statusText: "Idle",
    browser: null,
    
    // Fungsi untuk memperbarui data dari JSON ke State
    reload: function() {
        const conf = loadRawConfig();
        
        // Mapping langsung dari JSON ke Properti State
        this.BOT_TOKEN = conf.BOT_TOKEN_GETNUM || "";
        this.API_URL = this.BOT_TOKEN ? `https://api.telegram.org/bot${this.BOT_TOKEN}` : "";
        
        this.ADMIN_ID = conf.ADMIN_ID || "";
        this.STEX_EMAIL = conf.EMAIL || "";
        this.STEX_PASSWORD = conf.PASSWORD || "";
        
        this.LOGIN_URL = conf.URL_LOGIN || "";
        this.TARGET_URL = conf.URL_TARGET_GETNUM || "";
        
        this.GROUP_ID_1 = conf.GROUP_ID_1 || "";
        this.GROUP_LINK_1 = conf.URL_GRUP_OTP || "";

        console.log("[STATE] Data sinkron dengan bot_config.json");
    },

    // Nilai statis yang jarang berubah
    OTP_PRICE: 0.003500,
    
    // Fitur Lock Playwright
    playwrightLock: {
        locked: false,
        acquire: async function() {
            while (this.locked) await new Promise(r => setTimeout(r, 100));
            this.locked = true;
            return () => { this.locked = false; };
        }
    }
};

// Jalankan reload pertama kali saat script dimuat
state.reload();

module.exports = { state, playwrightLock: state.playwrightLock };
