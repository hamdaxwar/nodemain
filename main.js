/**
 * ZURA BOT PANEL - MAIN ENTRY POINT (FINAL OPTIMIZED)
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

// Ambil perintah dan callback handler
const commands = require('./handlers/commands');
const callbacks = require('./handlers/callbacks');

// Modules Internal
const rangeModule = require('./range.js');
const messageModule = require('./message.js');
const smsModule = require('./sms.js');
const aideApp = require('./aideApp.js');

let telegramLoopInterval = null;
let expiryInterval = null;

/**
 * Fungsi Utama untuk Menyalakan Bot
 */
async function startBot() {
    if (!state) return;
    
    // Refresh data dari bot_config.json
    state.reload();
    const currentToken = state.BOT_TOKEN;

    if (!currentToken) {
        console.log("[WARNING] BOT_TOKEN kosong. Bot tidak bisa dimulai.");
        state.statusText = "Token Belum Diatur";
        return;
    }

    if (state.isBotRunning) {
        console.log("[MAIN] Bot sudah dalam status Running.");
        return;
    }

    state.isBotRunning = true;
    state.statusText = "Memulai...";
    console.log(`[MAIN] Menyalakan Bot dengan Token: ${currentToken.substring(0, 10)}...`);

    try {
        // 1. Inisialisasi Database
        db.initializeFiles();
        
        // 2. Jalankan Polling Telegram & Monitor Kadaluarsa (Langsung Aktif)
        startTelegramLoop();
        startExpiryMonitor();
        
        // 3. Jalankan API Server (AideApp)
        if (aideApp && aideApp.startServer) {
            aideApp.startServer();
        }

        // 4. Inisialisasi Browser & Login (Async Background)
        console.log("[BROWSER] Menyiapkan browser dan login...");
        scraper.initBrowser().then(() => {
            state.statusText = "Running (Browser Active)";
            
            // 5. Jalankan Modul Monitoring SETELAH browser siap & login sukses
            // Modul-modul ini akan menggunakan state.sharedPage
            console.log("[MAIN] Menjalankan modul monitoring (Range/Message/SMS)...");
            rangeModule.start();
            messageModule.start();
            smsModule.start();
            
        }).catch(e => {
            console.error("[BROWSER] Gagal inisialisasi browser:", e.message);
            state.statusText = "Running (No Browser)";
        });

        console.log("[MAIN] Sistem Telegram Online.");
    } catch (err) {
        console.error("[MAIN ERROR]", err);
        state.isBotRunning = false;
        state.statusText = "Critical Error";
    }
}

/**
 * Fungsi untuk Mematikan Bot secara Bersih
 */
async function stopBot() {
    if (!state || !state.isBotRunning) return;
    state.isBotRunning = false;
    state.statusText = "Stopping...";
    
    // Hentikan semua interval modul
    if (rangeModule.stop) rangeModule.stop();
    if (messageModule.stop) messageModule.stop();
    if (smsModule.stop) smsModule.stop();
    if (expiryInterval) clearInterval(expiryInterval);

    // Tutup Browser jika ada
    if (state.browser) {
        try { 
            await state.browser.close(); 
            console.log("[BROWSER] Browser closed.");
        } catch(e){}
        state.browser = null;
        state.sharedPage = null;
    }
    
    console.log("[MAIN] Bot Berhasil Dimatikan.");
    state.statusText = "Stopped";
}

/**
 * Fungsi Restart
 */
async function restartBot() {
    console.log("[MAIN] Restarting Bot...");
    await stopBot();
    await new Promise(r => setTimeout(r, 2000));
    await startBot();
}

/**
 * Monitor Durasi Nomor di WaitList
 */
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
                // Jika sudah lebih dari 20 menit (1200 detik)
                if (now - item.timestamp > 1200) { 
                    await tg.tgSend(item.user_id, `⚠️ Nomor <code>${item.number}</code> telah kadaluarsa.`);
                } else {
                    updatedList.push(item);
                }
            }
            db.saveWaitList(updatedList);
        } catch (e) {}
    }, 30000);
}

/**
 * Loop Polling Telegram
 */
function startTelegramLoop() {
    if (telegramLoopInterval) return;
    let offset = 0;
    
    const loop = async () => {
        telegramLoopInterval = true; 
        console.log("[TG] Polling started.");
        
        while (state.isBotRunning) {
            try {
                const data = await tg.tgGetUpdates(offset);
                if (data && data.ok && data.result) {
                    for (const upd of data.result) {
                        offset = upd.update_id + 1;
                        if (upd.message) {
                            commands.processCommand(upd.message).catch(e => console.error("[CMD ERR]", e.message));
                        }
                        if (upd.callback_query) {
                            callbacks.processCallback(upd.callback_query).catch(e => console.error("[CB ERR]", e.message));
                        }
                    }
                }
            } catch (e) {
                // Delay panjang jika terjadi error koneksi berat
                await new Promise(r => setTimeout(r, 5000));
            }
            // Delay pendek antar polling
            await new Promise(r => setTimeout(r, 700));
        }
        telegramLoopInterval = null;
    };
    loop();
}

/**
 * Penjadwalan Tugas (Cron)
 */
// Refresh browser setiap jam 7 pagi untuk membersihkan cache/leak
cron.schedule('0 7 * * *', async () => {
    if (state && state.isBotRunning) {
        console.log("[CRON] Refreshing browser session...");
        const release = await playwrightLock.acquire();
        try { 
            await scraper.initBrowser(); 
        } finally { 
            release(); 
        }
    }
});

/**
 * Prosedur Auto-Start
 */
(() => {
    state.reload();
    if (state.BOT_TOKEN) {
        startBot();
    } else {
        state.statusText = "Menunggu Token";
        console.log("[MAIN] Menunggu BOT_TOKEN di bot_config.json...");
        
        const checkConfig = setInterval(() => {
            state.reload();
            if (state.BOT_TOKEN) {
                console.log("[MAIN] Token terdeteksi! Menjalankan bot...");
                startBot();
                clearInterval(checkConfig);
            }
        }, 5000);
    }
})();

module.exports = { startBot, stopBot, restartBot };
