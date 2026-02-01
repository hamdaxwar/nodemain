const { fork } = require('child_process');
const cron = require('node-cron');
const config = require('./config');
const db = require('./helpers/database');
const tg = require('./helpers/telegram');
const scraper = require('./helpers/scraper');
const { state, playwrightLock } = require('./helpers/state');
const commands = require('./handlers/commands');
const callbacks = require('./handlers/callbacks');

// Modules
const rangeModule = require('./range.js');
const messageModule = require('./message.js');
const smsModule = require('./sms.js');
const aideApp = require('./aideApp.js');

let telegramLoopInterval = null;
let expiryInterval = null;

// --- Bot Control Functions ---

async function startBot() {
    if (state.isBotRunning) {
        console.log("Bot already running.");
        return;
    }

    // Cek kelengkapan Config
    if (!config.BOT_TOKEN) {
        console.log("BOT_TOKEN missing in config. Please set via App.");
        state.statusText = "Missing Config";
        return;
    }

    state.isBotRunning = true;
    state.statusText = "Starting...";
    console.log("[MAIN] Starting Bot System...");

    db.initializeFiles();

    // 1. Start Browser
    try {
        await scraper.initBrowser();
        state.statusText = "Browser Active";
    } catch (e) {
        state.statusText = "Browser Error";
        console.error("Browser Init Failed:", e);
        // Continue anyway to allow retry
    }

    // 2. Start Modules
    rangeModule.start();
    messageModule.start();
    smsModule.start();

    // 3. Start Telegram Polling
    startTelegramLoop();
    startExpiryMonitor();
    
    state.statusText = "Running";
    console.log("[MAIN] All Systems Online.");
}

async function stopBot() {
    state.isBotRunning = false;
    state.statusText = "Stopping...";
    console.log("[MAIN] Stopping Bot System...");

    // Stop Modules
    rangeModule.stop();
    messageModule.stop();
    smsModule.stop();

    // Stop Loops
    if (telegramLoopInterval) clearInterval(telegramLoopInterval);
    if (expiryInterval) clearInterval(expiryInterval);

    // Close Browser
    if (state.browser) {
        try { await state.browser.close(); } catch(e){}
        state.browser = null;
    }

    state.statusText = "Stopped";
    console.log("[MAIN] Bot Stopped.");
}

async function restartBot() {
    await stopBot();
    config.reload(); // Reload bot_config.json
    console.log("[MAIN] Config Reloaded.");
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
            const now = Date.now() / 1000;
            const updatedList = [];
            for (const item of waitList) {
                if (item.otp_received_time) {
                    updatedList.push(item);
                    continue;
                }
                if (now - item.timestamp > 1200) { // 20 Menit
                    const msgId = await tg.tgSend(item.user_id, `⚠️ Nomor <code>${item.number}</code> telah kadaluarsa.`);
                    if (msgId) setTimeout(() => tg.tgDelete(item.user_id, msgId), 30000);
                } else {
                    updatedList.push(item);
                }
            }
            db.saveWaitList(updatedList);
        } catch (e) {}
    }, 15000);
}

function startTelegramLoop() {
    if (telegramLoopInterval) return; // Prevent double loop inside same process
    
    // Kita gunakan logic async loop di dalam, tapi dikontrol flag isBotRunning
    // agar tidak blocking main thread
    
    let offset = 0;
    // Bersihkan update lama
    tg.tgGetUpdates(-1).catch(()=>{});

    const loop = async () => {
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
            } catch (e) {
                if (e.response && e.response.status === 429) {
                    await new Promise(r => setTimeout(r, 10000));
                }
            }
            await new Promise(r => setTimeout(r, 1000));
        }
        telegramLoopInterval = null; // Reset saat loop mati
    };
    
    // Jalankan loop non-blocking
    telegramLoopInterval = true; // Mark as active
    loop();
}


// --- Main Entry Point ---

// 1. Jalankan API Server untuk Dashboard
aideApp.startServer();

// 2. Cron Job Refresh Browser (07:00 WIB)
cron.schedule('0 7 * * *', async () => {
    if (state.isBotRunning) {
        console.log("[CRON] Refreshing Browser...");
        const release = await playwrightLock.acquire();
        try { await scraper.initBrowser(); } 
        catch (e) { console.error("[CRON ERROR]", e.message); } 
        finally { release(); }
    }
}, { scheduled: true, timezone: "Asia/Jakarta" });

// 3. Auto-Start jika config valid
if (config.BOT_TOKEN) {
    startBot();
} else {
    state.statusText = "Waiting Config";
    console.log("[MAIN] Bot Token belum diset. Silahkan setup via App Dashboard.");
}

// Export untuk diakses oleh aideApp.js
module.exports = { startBot, stopBot, restartBot };

