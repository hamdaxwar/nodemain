const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { state } = require('./helpers/state'); 
const config = require('./config');

let monitorLoop = null;
let monitorPage = null; 

// Path ke file konfigurasi utama
const CONFIG_PATH = path.join(process.cwd(), 'bot_config.json');

// Memory Sesi Internal
let sessionConfig = {
    token: null,
    chatId: null,
    botLink: null,
    targetUrl: null,
    urlAdmin: null
};

/**
 * Mengambil data langsung dari file bot_config.json secara mandiri
 */
function loadConfigFromFile() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const fileData = fs.readFileSync(CONFIG_PATH, 'utf8');
            const json = JSON.parse(fileData);
            
            sessionConfig.token = json.BOT_TOKEN_RANGE || json.BOT_TOKEN_MESSAGE;
            sessionConfig.chatId = String(json.CHAT_ID_RANGE || "").trim();
            sessionConfig.botLink = json.URL_GETNUM;
            sessionConfig.targetUrl = json.URL_TARGET_RANGE;
            sessionConfig.urlAdmin = json.URL_ADMIN;

            return true;
        }
    } catch (err) {
        console.error("[RANGE] Gagal membaca bot_config.json:", err.message);
    }
    return false;
}

let SENT_MESSAGES = new Map();
let CACHE_SET = new Set();
let MESSAGE_QUEUE = []; 
let IS_PROCESSING_QUEUE = false; 

const escapeHTML = (str) => {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

async function processQueue() {
    if (IS_PROCESSING_QUEUE || MESSAGE_QUEUE.length === 0) return;
    IS_PROCESSING_QUEUE = true;

    while (MESSAGE_QUEUE.length > 0) {
        // Refresh config dari file sebelum mengirim pesan
        loadConfigFromFile();
        
        const item = MESSAGE_QUEUE.shift();
        if (!sessionConfig.token || !sessionConfig.chatId) {
            console.error("[RANGE] Skip: Token atau Chat ID tidak ditemukan di config.");
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

            const res = await axios.post(`${API_URL}/sendMessage`, {
                chat_id: sessionConfig.chatId,
                text: item.text,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: { 
                    inline_keyboard: [
                        [{ text: "📞 Get Number", url: sessionConfig.botLink || "https://t.me/" }],
                        [{ text: "👨‍💻 Admin", url: sessionConfig.urlAdmin || "https://t.me/" }]
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
           `🗯️ <b>Message:</b>\n` +
           `<blockquote>${escapeHTML(fullMessage)}</blockquote>`;
};

async function start() {
    if (monitorLoop) return; 
    
    // Load config saat pertama kali jalan
    if (!loadConfigFromFile()) {
        console.log("[RANGE] Menunggu file bot_config.json tersedia...");
    }
    
    console.log("🚀 [RANGE] Module Started (Independent Mode).");
    
    monitorLoop = setInterval(async () => {
        // Cek apakah browser utama di state sudah siap
        if (!state.browser) return;

        // Selalu sinkronkan config setiap interval agar up-to-date
        loadConfigFromFile();

        try {
            if (!monitorPage || monitorPage.isClosed()) {
                const context = state.browser.contexts()[0] || await state.browser.newContext();
                monitorPage = await context.newPage();
            }

            if (!sessionConfig.targetUrl) return;

            if (!monitorPage.url().includes(sessionConfig.targetUrl)) {
                await monitorPage.goto(sessionConfig.targetUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
            }

            // Seleksi elemen card di dashboard console
            const elements = await monitorPage.locator("div.p-3.rounded-lg").all();

            for (const el of elements) {
                try {
                    const rawText = await el.innerText();
                    if (!rawText.includes("•")) continue;

                    const lines = rawText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
                    
                    const country = rawText.includes("•") ? rawText.split("•")[1].split("\n")[0].trim() : "Unknown";
                    const service = lines[0] || "Unknown";
                    const phoneRaw = lines.find(l => l.includes("XXX")) || "";
                    const msgRaw = await el.locator("p").innerText().catch(() => "");

                    const phone = phoneRaw.replace(/[^0-9X]/g, '');
                    if (!phone.includes('XXX')) continue;

                    const cacheKey = `${phone}_${msgRaw.substring(0, 20)}`;

                    if (!CACHE_SET.has(cacheKey)) {
                        CACHE_SET.add(cacheKey);
                        const currentData = SENT_MESSAGES.get(phone) || { count: 0 };
                        const newCount = currentData.count + 1;
                        
                        console.log(`[RANGE] New Hit: ${phone} (${country})`);

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
            // console.error("[RANGE] Loop Error:", e.message);
        }
    }, 12000);
}

function stop() {
    if (monitorLoop) {
        clearInterval(monitorLoop);
        monitorLoop = null;
        if (monitorPage) monitorPage.close().catch(() => {});
        console.log("🛑 [RANGE] Module Stopped.");
    }
}

// syncSession sekarang hanya alias untuk loadConfigFromFile agar kompatibel dengan script luar
const syncSession = loadConfigFromFile;

module.exports = { start, stop, syncSession };
