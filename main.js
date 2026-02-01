/**
 * ZURA BOT PANEL - MAIN ENTRY POINT
 */

const { fork } = require('child_process');
const cron = require('node-cron');
const config = require('./config');
const db = require('./helpers/database');
const tg = require('./helpers/telegram');
const scraper = require('./helpers/scraper');

// Pastikan import state aman
const stateModule = require('./helpers/state');
const state = stateModule.state;
const playwrightLock = stateModule.playwrightLock;

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
    if (state.isBotRunning) {
        console.log("[MAIN] Bot sudah berjalan.");
        return;
    }

    if (!config.BOT_TOKEN || config.BOT_TOKEN === "") {
        console.log("[WARNING] BOT_TOKEN kosong.");
        state.statusText = "Konfigurasi Belum Lengkap";
        return;
    }

    state.isBotRunning = true;
    state.statusText = "Memulai...";
    console.log("[MAIN] Menyalakan Sistem Bot...");

    try {
        db.initializeFiles();
        try {
            await scraper.initBrowser();
            state.statusText = "Browser Aktif";
        } catch (e) {
            state.statusText = "Browser Error";
        }

        rangeModule.start();
        messageModule.start();
        smsModule.start();

        startTelegramLoop();
        startExpiryMonitor();
        
        state.statusText = "Running";
        console.log("[MAIN] Semua Sistem Online.");
    } catch (err) {
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
    await stopBot();
    if (config.reload) config.reload(); 
    await new Promise(r => setTimeout(r, 2000));
    await startBot();
}

// --- Background Loops ---

function startExpiryMonitor() {
    if (expiryInterval) clearInterval(expiryInterval);
    expiryInterval = setInterval(async () => {
        if (!state.isBotRunning) return;
        try {
            const waitList = db.loadWaitList();
            if (!waitList) return;
            const now = Date.now() / 1000;
            const updatedList = [];
            for (const item of waitList) {
                if (item.otp_received_time) {
                    updatedList.push(item);
                    continue;
                }
                if (now - item.timestamp > 1200) { 
                    tg.tgSend(item.user_id, `⚠️ Nomor <code>${item.number}</code> telah kadaluarsa.`);
                } else {
                    updatedList.push(item);
                }
            }
            db.saveWaitList(updatedList);
        } catch (e) {}
    }, 15000);
}

function startTelegramLoop() {
    if (telegramLoopInterval) return;
    let offset = 0;
    const loop = async () => {
        telegramLoopInterval = true; 
        while (state.isBotRunning) {
            try {
                const data = await tg.tgGetUpdates(offset);
                if (data && data.result) {
                    for (const upd of data.result) {
                        offset = upd.update_id + 1;
                        if (upd.message) await commands.processCommand(upd.message);
                        if (upd.callback_query) await callbacks.processCallback(upd.callback_query);
                    }
                }
            } catch (e) {}
            await new Promise(r => setTimeout(r, 1000));
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

cron.schedule('0 7 * * *', async () => {
    if (state && state.isBotRunning) {
        const release = await playwrightLock.acquire();
        try { await scraper.initBrowser(); } finally { release(); }
    }
});

// Auto-Start Check
if (config.BOT_TOKEN && config.BOT_TOKEN !== "") {
    startBot();
} else {
    if (state) state.statusText = "Menunggu Konfigurasi";
    console.log("[MAIN] Server Aktif (Port 3000). Silakan atur Token via HP.");
}

module.exports = { startBot, stopBot, restartBot };
