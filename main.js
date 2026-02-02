/**
 * ZURA BOT PANEL - MAIN ENTRY POINT (FIXED)
 */

const { fork } = require('child_process');
const cron = require('node-cron');
const config = require('./config');
const db = require('./helpers/database');
const tg = require('./helpers/telegram');
const scraper = require('./helpers/scraper');

// Ambil state dan paksa reload di awal
const stateModule = require('./helpers/state');
const state = stateModule.state;
const playwrightLock = stateModule.playwrightLock;

// Reload state agar mengambil data terbaru dari bot_config.json
state.reload(); 

const commands = require('./handlers/commands');
const callbacks = require('./handlers/callbacks');

// Modules Internal
const rangeModule = require('./range.js');
const messageModule = require('./message.js');
const smsModule = require('./sms.js');
const aideApp = require('./aideApp.js');

let telegramLoopInterval = null;
let expiryInterval = null;

// --- Fungsi Kontrol Bot ---

async function startBot() {
    if (!state) return;
    
    // Pastikan kita pakai token terbaru dari state (bukan config statis)
    const currentToken = state.BOT_TOKEN;

    if (!currentToken || currentToken === "") {
        console.log("[WARNING] BOT_TOKEN di JSON masih kosong. Menunggu konfigurasi dari HP...");
        state.statusText = "Konfigurasi Belum Lengkap";
        return;
    }

    if (state.isBotRunning) {
        console.log("[MAIN] Bot sudah berjalan.");
        return;
    }

    state.isBotRunning = true;
    state.statusText = "Memulai...";
    console.log(`[MAIN] Menyalakan Bot dengan Token: ${currentToken.substring(0, 10)}...`);

    try {
        db.initializeFiles();
        
        // Browser bersifat opsional, jangan sampai menghambat polling Telegram
        scraper.initBrowser().then(() => {
            state.statusText = "Browser Aktif";
        }).catch(e => {
            console.log("[BROWSER] Error awal (Abaikan jika RDP lambat):", e.message);
        });

        rangeModule.start();
        messageModule.start();
        smsModule.start();

        startTelegramLoop();
        startExpiryMonitor();
        
        state.statusText = "Running";
        console.log("[MAIN] Semua Sistem Online.");
    } catch (err) {
        console.error("[MAIN ERROR]", err);
        state.isBotRunning = false;
        state.statusText = "Error";
    }
}

async function stopBot() {
    if (!state || !state.isBotRunning) return;
    state.isBotRunning = false;
    state.statusText = "Stopped";
    
    if (rangeModule.stop) rangeModule.stop();
    if (messageModule.stop) messageModule.stop();
    if (smsModule.stop) smsModule.stop();
    if (expiryInterval) clearInterval(expiryInterval);

    if (state.browser) {
        try { await state.browser.close(); } catch(e){}
        state.browser = null;
    }
    console.log("[MAIN] Bot Berhasil Dimatikan.");
}

async function restartBot() {
    console.log("[MAIN] Restarting Bot...");
    await stopBot();
    // Tunggu sebentar lalu reload data dari JSON
    await new Promise(r => setTimeout(r, 1000));
    state.reload(); 
    await startBot();
}

// --- Background Loops ---

function startExpiryMonitor() {
    if (expiryInterval) clearInterval(expiryInterval);
    expiryInterval = setInterval(async () => {
        if (!state.isBotRunning) return;
        try {
            const waitList = db.loadWaitList();
            if (!waitList || !Array.isArray(waitList)) return;
            const now = Date.now() / 1000;
            const updatedList = [];
            for (const item of waitList) {
                if (item.otp_received_time) {
                    updatedList.push(item);
                    continue;
                }
                if (now - item.timestamp > 1200) { 
                    await tg.tgSend(item.user_id, `⚠️ Nomor <code>${item.number}</code> telah kadaluarsa.`);
                } else {
                    updatedList.push(item);
                }
            }
            db.saveWaitList(updatedList);
        } catch (e) {}
    }, 30000); // Cek per 30 detik saja agar tidak berat
}

function startTelegramLoop() {
    if (telegramLoopInterval) return;
    let offset = 0;
    
    const loop = async () => {
        telegramLoopInterval = true; 
        while (state.isBotRunning) {
            try {
                // Gunakan tgGetUpdates yang sudah menggunakan state.API_URL
                const data = await tg.tgGetUpdates(offset);
                if (data && data.ok && data.result) {
                    for (const upd of data.result) {
                        offset = upd.update_id + 1;
                        if (upd.message) {
                            commands.processCommand(upd.message).catch(e => console.error(e));
                        }
                        if (upd.callback_query) {
                            callbacks.processCallback(upd.callback_query).catch(e => console.error(e));
                        }
                    }
                }
            } catch (e) {
                console.error("[TG LOOP ERROR]", e.message);
                await new Promise(r => setTimeout(r, 5000)); // Delay jika error koneksi
            }
            await new Promise(r => setTimeout(r, 500));
        }
        telegramLoopInterval = null;
    };
    loop();
}

// --- Jalankan Server ---

console.log("[AIDE] Menjalankan API Server...");
if (aideApp && aideApp.startServer) {
    aideApp.startServer();
}

// Cron untuk refresh browser tiap pagi jam 7
cron.schedule('0 7 * * *', async () => {
    if (state && state.isBotRunning) {
        const release = await playwrightLock.acquire();
        try { await scraper.initBrowser(); } finally { release(); }
    }
});

// AUTO-START CHECK (MENGGUNAKAN STATE)
if (state.BOT_TOKEN && state.BOT_TOKEN !== "") {
    startBot();
} else {
    state.statusText = "Menunggu Konfigurasi";
    console.log("[MAIN] Server Aktif. Token belum ada di bot_config.json.");
    
    // Opsional: Cek berkala apakah token sudah diisi lewat HP
    const checkConfig = setInterval(() => {
        state.reload();
        if (state.BOT_TOKEN) {
            console.log("[MAIN] Token ditemukan! Menjalankan bot...");
            startBot();
            clearInterval(checkConfig);
        }
    }, 5000);
}

module.exports = { startBot, stopBot, restartBot };
