const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// Path ke file konfigurasi global
const CONFIG_PATH = path.join(process.cwd(), 'bot_config.json');

let monitorLoop = null;
let monitorPage = null; 

// Ingatan internal module (State Mandiri)
let sessionConfig = {
    token: null,
    chatId: null,
    botLink: null,
    targetUrl: null,
    adminLink: null
};

/**
 * Fungsi untuk mengambil data langsung dari bot_config.json
 * Berjalan saat start atau saat dipanggil manual
 */
function syncSession() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const fileContent = fs.readFileSync(CONFIG_PATH, 'utf-8');
            const data = JSON.parse(fileContent);

            sessionConfig.token = data.BOT_TOKEN_RANGE || data.BOT_TOKEN_MESSAGE;
            sessionConfig.chatId = String(data.CHAT_ID_RANGE || "").trim();
            sessionConfig.botLink = data.URL_GETNUM || "https://t.me/";
            sessionConfig.targetUrl = data.URL_TARGET_RANGE;
            sessionConfig.adminLink = data.URL_ADMIN;

            console.log("[RANGE] Konfigurasi berhasil dimuat dari bot_config.json");
        } else {
            console.error("[RANGE] File bot_config.json tidak ditemukan!");
        }
    } catch (e) {
        console.error("[RANGE] Gagal membaca bot_config.json:", e.message);
    }
}

let SENT_MESSAGES = new Map();
let CACHE_SET = new Set();
let MESSAGE_QUEUE = []; 
let IS_PROCESSING_QUEUE = false; 

// Helper untuk keamanan karakter HTML Telegram
const escapeHTML = (str) => {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

/**
 * Pengiriman antrian pesan ke Telegram
 */
async function processQueue() {
    if (IS_PROCESSING_QUEUE || MESSAGE_QUEUE.length === 0) return;
    IS_PROCESSING_QUEUE = true;

    while (MESSAGE_QUEUE.length > 0) {
        const item = MESSAGE_QUEUE.shift();
        
        if (!sessionConfig.token || !sessionConfig.chatId || sessionConfig.chatId === "") {
            console.error("[RANGE] Skip: Token atau Chat ID tidak valid.");
            continue;
        }

        const API_URL = `https://api.telegram.org/bot${sessionConfig.token}`;

        try {
            // Hapus pesan lama untuk range yang sama (Keep chat clean)
            if (SENT_MESSAGES.has(item.rangeVal)) {
                const oldData = SENT_MESSAGES.get(item.rangeVal);
                await axios.post(`${API_URL}/deleteMessage`, {
                    chat_id: sessionConfig.chatId, 
                    message_id: oldData.message_id
                }).catch(() => {});
            }

            // Kirim pesan baru
            const res = await axios.post(`${API_URL}/sendMessage`, {
                chat_id: sessionConfig.chatId,
                text: item.text,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: { 
                    inline_keyboard: [
                        [{ text: "📞 Get Number", url: sessionConfig.botLink }],
                        [{ text: "👨‍💻 Admin", url: sessionConfig.adminLink || "https://t.me/" }]
                    ] 
                }
            });

            if (res.data && res.data.ok) {
                SENT_MESSAGES.set(item.rangeVal, {
                    message_id: res.data.result.message_id,
                    count: item.newCount
                });
            }
        } catch (e) {
            console.error(`[RANGE] Telegram Error:`, e.response?.data?.description || e.message);
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    IS_PROCESSING_QUEUE = false;
}

const formatLiveMessage = (rangeVal, count, countryName, service, fullMessage) => {
    const emoji = config.COUNTRY_EMOJI?.[countryName.toUpperCase()] || "🏴‍☠️";
    const rangeDisplay = count > 1 ? `<code>${rangeVal}</code> <b>(x${count})</b>` : `<code>${rangeVal}</code>`;
    
    return `🔥 <b>Live Message New Range</b>\n\n` +
           `📱 Range: ${rangeDisplay}\n` +
           `${emoji} Country: ${escapeHTML(countryName)}\n` +
           `⚙️ Service: ${escapeHTML(service)}\n\n` +
           `🗯️ <b>Message Available:</b>\n` +
           `<blockquote>${escapeHTML(fullMessage)}</blockquote>`;
};

/**
 * Memulai monitoring browser
 * @param {Object} browserInstance - Instance browser dari playwright (dikirim dari main script)
 */
async function start(browserInstance) {
    if (monitorLoop) return; 
    
    // Ambil data mandiri dari JSON
    syncSession();
    
    if (!sessionConfig.targetUrl) {
        console.error("[RANGE] Module tidak bisa jalan: URL_TARGET_RANGE kosong.");
        return;
    }

    console.log("🚀 [RANGE] Module Started (Independent Mode).");
    
    monitorLoop = setInterval(async () => {
        // Module ini butuh instance browser yang dikirim saat start
        if (!browserInstance) return;

        try {
            if (!monitorPage || monitorPage.isClosed()) {
                const contexts = browserInstance.contexts();
                const context = contexts.length > 0 ? contexts[0] : await browserInstance.newContext();
                monitorPage = await context.newPage();
            }

            if (!monitorPage.url().includes(sessionConfig.targetUrl)) {
                await monitorPage.goto(sessionConfig.targetUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
            }

            // Selector fleksibel untuk menangkap card pesan
            const elements = await monitorPage.locator("div.p-3.rounded-lg").all();

            for (const el of elements) {
                try {
                    const rawText = await el.innerText();
                    if (!rawText.includes("•")) continue;

                    const lines = rawText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
                    
                    // Parsing data dari elemen
                    const country = rawText.includes("•") ? rawText.split("•")[1].split("\n")[0].trim() : "Unknown";
                    const service = lines[0] || "Unknown";
                    const phoneRaw = lines.find(l => l.includes("XXX")) || "";
                    const msgRaw = await el.locator("p").innerText().catch(() => "");

                    const phone = phoneRaw.replace(/[^0-9X]/g, '');
                    if (!phone.includes('XXX')) continue;

                    const cacheKey = `${phone}_${msgRaw.substring(0, 15)}`;

                    if (!CACHE_SET.has(cacheKey)) {
                        CACHE_SET.add(cacheKey);
                        const currentData = SENT_MESSAGES.get(phone) || { count: 0 };
                        const newCount = currentData.count + 1;
                        
                        console.log(`[RANGE] New Hit detected: ${phone}`);

                        MESSAGE_QUEUE.push({
                            rangeVal: phone,
                            newCount: newCount,
                            text: formatLiveMessage(phone, newCount, country, service, msgRaw)
                        });
                        processQueue();
                    }
                } catch (e) {}
            }
        } catch (e) {
            // Jika error karena browser tertutup, module akan mencoba lagi di loop berikutnya
        }
    }, 15000);
}

function stop() {
    if (monitorLoop) {
        clearInterval(monitorLoop);
        monitorLoop = null;
        if (monitorPage) monitorPage.close().catch(() => {});
        console.log("🛑 [RANGE] Module Stopped.");
    }
}

module.exports = { start, stop, syncSession };
