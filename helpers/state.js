const fs = require('fs');
const path = require('path');
const HEADLESS_CONFIG = require('../headless.js'); 
const GLOBAL_COUNTRY_EMOJI = require('../country.json');

const CONFIG_FILE = path.join(__dirname, 'bot_config.json');

function loadConfig() {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        } catch (e) {
            console.error("Gagal membaca bot_config.json");
            return {};
        }
    }
    return {};
}

const currentConfig = loadConfig();

module.exports = {
    // Fungsi untuk reload config saat tombol Restart ditekan
    reload: () => {
        const newConf = loadConfig();
        Object.assign(module.exports, mapConfig(newConf));
    },

    // Default Values & Mappings
    ...mapConfig(currentConfig),
    
    // Static Settings
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
    }
};

function mapConfig(conf) {
    return {
        BOT_TOKEN: conf.BOT_TOKEN || "",
        BOT_TOKEN_MESSAGE: conf.BOT_TOKEN_MESSAGE || conf.BOT_TOKEN,
        BOT_TOKEN_RANGE: conf.BOT_TOKEN_RANGE || conf.BOT_TOKEN,
        
        API_URL: `https://api.telegram.org/bot${conf.BOT_TOKEN}`,
        
        CHAT_ID_MESSAGE: conf.CHAT_ID_MESSAGE,
        CHAT_ID_RANGE: conf.CHAT_ID_RANGE,
        
        GROUP_ID_1: parseInt(conf.GROUP_ID_1 || 0),
        GROUP_ID_2: parseInt(conf.GROUP_ID_2 || 0),
        ADMIN_ID: parseInt(conf.ADMIN_ID || 0),
        
        STEX_EMAIL: conf.EMAIL,
        STEX_PASSWORD: conf.PASSWORD,
        
        LOGIN_URL: conf.URL_LOGIN,
        TARGET_URL: conf.URL_TARGET_GETNUM,
        URL_TARGET_RANGE: conf.URL_TARGET_RANGE,
        URL_TARGET_MESSAGE: conf.URL_TARGET_MESSAGE,
        
        BOT_USERNAME_LINK: conf.URL_GETNUM,
        GROUP_LINK_1: conf.URL_GRUP_OTP,
        GROUP_LINK_2: "https://t.me/zura14g", // Bisa ditambah di config jika mau dinamis
        TELEGRAM_ADMIN_LINK: conf.URL_ADMIN
    };
}

