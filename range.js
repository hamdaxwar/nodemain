const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { state } = require('./helpers/state'); 
const config = require('./config');

let monitorLoop = null;
let monitorPage = null; 

const CONFIG_PATH = path.join(process.cwd(), 'bot_config.json');

let sessionConfig = {
    token: null,
    chatId: null,
    botLink: null,
    targetUrl: null,
    urlAdmin: null
};

// Helper Validasi URL
function validateUrl(url) {
    if (!url) return null;
    let formatted = url.trim();
    if (formatted.startsWith('t.me')) formatted = 'https://' + formatted;
    else if (formatted.startsWith('https:t.me')) formatted = formatted.replace('https:', 'https://');
    if (!formatted.startsWith('http')) return null;
    return formatted;
}

function loadConfigFromFile() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const fileData = fs.readFileSync(CONFIG_PATH, 'utf8');
            const json = JSON.parse(fileData);
            sessionConfig.token = json.BOT_TOKEN_RANGE || json.BOT_TOKEN_MESSAGE;
            sessionConfig.chatId = String(json.CHAT_ID_RANGE || "").trim();
            sessionConfig.botLink = validateUrl(json.URL_GETNUM);
            sessionConfig.targetUrl = json.URL_TARGET_RANGE;
            sessionConfig.urlAdmin = validateUrl(json.URL_ADMIN);
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
        loadConfigFromFile();
        const item = MESSAGE_QUEUE.shift();
        if (!sessionConfig.token || !sessionConfig.chatId) continue;

        const API_URL = `https://api.telegram.org/bot${sessionConfig.token}`;

        try {
            if (SENT_MESSAGES.has(item.rangeVal)) {
                const oldData = SENT_MESSAGES.get(item.rangeVal);
                await axios.post(`${API_URL}/deleteMessage`, {
                    chat_id: sessionConfig.chatId, 
                    message_id: oldData.message_id
                }).catch(() => {});
            }

            const buttons = [];
            if (sessionConfig.botLink) buttons.push([{ text: "📞 Get Number", url: sessionConfig.botLink }]);
            if (sessionConfig.urlAdmin) buttons.push([{ text: "👨‍💻 Admin", url: sessionConfig.urlAdmin }]);

            const res = await axios.post(`${API_URL}/sendMessage`, {
                chat_id: sessionConfig.chatId,
                text: item.text,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: { inline_keyboard: buttons }
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
        await new Promise(r => setTimeout(r, 1500));
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

// Fungsi untuk menangani data JSON yang didapat dari API
async function handleApiData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData)) return;

    for (const item of jsonData) {
        const appName = (item.app_name || "").toUpperCase();
        
        // Filter: Hanya Facebook atau WhatsApp
        if (appName.includes("FACEBOOK") || appName.includes("WHATSAPP")) {
            const range = item.number || item.range || "Unknown";
            const country = item.country || "Unknown";
            const sms = item.sms || "";
            const service = item.app_name;

            // Pastikan ini adalah range (mengandung XXX)
            if (!range.includes("XXX")) continue;

            const cacheKey = `${range}_${sms.substring(0, 20)}`;

            if (!CACHE_SET.has(cacheKey)) {
                CACHE_SET.add(cacheKey);
                const currentData = SENT_MESSAGES.get(range) || { count: 0 };
                const newCount = currentData.count + 1;

                console.log(`[RANGE][API] New Hit: ${range} - ${service}`);

                MESSAGE_QUEUE.push({
                    rangeVal: range,
                    newCount: newCount,
                    text: formatLiveMessage(range, newCount, country, service, sms)
                });
                processQueue();
            }
        }
    }
}

async function start() {
    if (monitorLoop) return; 
    loadConfigFromFile();
    console.log("🚀 [RANGE] Module Started (API Interceptor Mode).");
    
    monitorLoop = setInterval(async () => {
        if (!state.browser) return;
        loadConfigFromFile();

        try {
            if (!monitorPage || monitorPage.isClosed()) {
                const context = state.browser.contexts()[0] || await state.browser.newContext();
                monitorPage = await context.newPage();

                // MONITOR NETWORK: Tangkap semua response API
                monitorPage.on('response', async (response) => {
                    const url = response.url();
                    // Cek jika URL mengandung kata kunci API info atau console data
                    if (url.includes('/info') || url.includes('/console') || url.includes('/get-data')) {
                        try {
                            const contentType = response.headers()['content-type'];
                            if (contentType && contentType.includes('application/json')) {
                                const data = await response.json();
                                // Jika data berbentuk objek yang punya properti data/logs, ambil dalamnya
                                const actualData = data.data || data.logs || data;
                                await handleApiData(actualData);
                            }
                        } catch (e) {
                            // Gagal parse JSON, abaikan
                        }
                    }
                });
            }

            if (!sessionConfig.targetUrl) return;

            // Navigasi ke target jika belum
            if (!monitorPage.url().includes(sessionConfig.targetUrl)) {
                await monitorPage.goto(sessionConfig.targetUrl, { waitUntil: 'networkidle' }).catch(() => {});
            } else {
                // FORCE REFRESH AJAX: Klik tombol refresh di web atau reload halaman
                // Ini memicu API 'info' dipanggil lagi
                await monitorPage.reload({ waitUntil: 'networkidle' }).catch(() => {});
            }

        } catch (e) {
            // console.error("[RANGE] Loop Error:", e.message);
        }
    }, 20000); // Cek/Refresh setiap 20 detik
}

function stop() {
    if (monitorLoop) {
        clearInterval(monitorLoop);
        monitorLoop = null;
        if (monitorPage) monitorPage.close().catch(() => {});
        console.log("🛑 [RANGE] Module Stopped.");
    }
}

const syncSession = loadConfigFromFile;
module.exports = { start, stop, syncSession };
