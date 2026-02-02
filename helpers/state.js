const fs = require('fs');
const path = require('path');

// Menggunakan process.cwd() agar path selalu merujuk ke folder root aplikasi
const CONFIG_FILE = path.join(process.cwd(), 'bot_config.json');

/**
 * Fungsi internal untuk memuat config dengan pelacakan error
 */
function loadRawConfig() {
    const result = { data: {}, error: null };
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            result.error = `File tidak ditemukan di path: ${CONFIG_FILE}`;
            return result;
        }

        const rawData = fs.readFileSync(CONFIG_FILE, 'utf8');
        if (!rawData || rawData.trim() === "") {
            result.error = "File bot_config.json kosong!";
            return result;
        }

        result.data = JSON.parse(rawData);
    } catch (e) {
        if (e instanceof SyntaxError) {
            result.error = `Format JSON rusak: ${e.message}`;
        } else {
            result.error = `Gagal membaca file: ${e.message}`;
        }
    }
    return result;
}

const state = {
    // --- Status Bot ---
    isBotRunning: false,
    statusText: "Idle",
    lastError: null, // Properti baru untuk menyimpan detail error terakhir
    
    // --- Properti Dinamis ---
    BOT_TOKEN: "",
    API_URL: "",
    ADMIN_ID: "",
    STEX_EMAIL: "",
    STEX_PASSWORD: "",
    LOGIN_URL: "",
    TARGET_URL: "",
    GROUP_ID_1: "",
    GROUP_LINK_1: "",

    /**
     * Fungsi Sinkronisasi Data
     */
    reload: function() {
        console.log("[STATE] Memulai sinkronisasi bot_config.json...");
        const result = loadRawConfig();

        if (result.error) {
            this.lastError = result.error;
            this.statusText = "Error Config";
            console.error(`[STATE] ❌ KESALAHAN: ${result.error}`);
            return false;
        }

        const conf = result.data;

        // Validasi Key Utama
        if (!conf.BOT_TOKEN_GETNUM) {
            this.lastError = "Key 'BOT_TOKEN_GETNUM' tidak ditemukan di dalam JSON";
            console.warn(`[STATE] ⚠️ Peringatan: ${this.lastError}`);
            // Kita tidak return false di sini agar variabel lain tetap terisi jika ada
        }

        // Mapping Data
        this.BOT_TOKEN = conf.BOT_TOKEN_GETNUM || "";
        this.API_URL = this.BOT_TOKEN ? `https://api.telegram.org/bot${this.BOT_TOKEN}` : "";
        this.ADMIN_ID = String(conf.ADMIN_ID || "");
        this.STEX_EMAIL = conf.EMAIL || "";
        this.STEX_PASSWORD = conf.PASSWORD || "";
        this.LOGIN_URL = conf.URL_LOGIN || "";
        this.TARGET_URL = conf.URL_TARGET_GETNUM || "";
        this.GROUP_ID_1 = conf.GROUP_ID_1 || "";
        this.GROUP_LINK_1 = conf.URL_GRUP_OTP || "";

        this.lastError = null; // Reset error jika berhasil
        console.log(`[STATE] ✅ Sinkronisasi Berhasil. Token: ${this.BOT_TOKEN ? this.BOT_TOKEN.substring(0, 10) + "..." : "KOSONG"}`);
        return true;
    },

    // --- Pengaturan Harga & Antrean ---
    OTP_PRICE: 0.003500,
    
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
