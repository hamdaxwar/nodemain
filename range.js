const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { state } = require('./helpers/state'); 
const config = require('./config');

let monitorLoop = null;
let monitorPage = null; 
let SENT_MESSAGES = new Map();
let CACHE_SET = new Set();
let MESSAGE_QUEUE = []; 
let IS_PROCESSING_QUEUE = false; 

const INLINE_JSON_PATH = path.join(process.cwd(), 'inline.json');
const BOT_CONFIG_PATH = path.join(process.cwd(), 'bot_config.json');

/**
 * Helper Baca JSON Dinamis
 */
const getLiveConfig = () => {
    try {
        if (fs.existsSync(BOT_CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(BOT_CONFIG_PATH, 'utf-8'));
        }
    } catch (e) {
        console.error("❌ [RANGE] Gagal baca bot_config.json");
    }
    return {};
};

const getCountryEmoji = (countryName) => config.COUNTRY_EMOJI[countryName.toUpperCase()] || "🏴‍☠️";

const cleanPhoneNumber = (phone) => {
    if (!phone) return "N/A";
    return phone.replace(/[^0-9X]/g, '') || phone;
};

const cleanServiceName = (service) => {
    if (!service) return "Unknown";
    const sLower = service.toLowerCase();
    if (sLower.includes('facebook') || sLower.includes('laz+nxcar')) return 'Facebook';
    if (sLower.includes('whatsapp')) return 'WhatsApp';
    return service.trim();
};

/**
 * Pengiriman Pesan Menggunakan Token Khusus Range
 */
async function processQueue() {
    if (IS_PROCESSING_QUEUE || MESSAGE_QUEUE.length === 0) return;
    IS_PROCESSING_QUEUE = true;

    // AMBIL DATA DINAMIS DARI JSON
    const liveCfg = getLiveConfig();
    const tokenRange = liveCfg.BOT_TOKEN_RANGE || state.BOT_TOKEN; // Fallback ke bot utama jika kosong
    const chatIdRange = liveCfg.CHAT_ID_RANGE || "-1003358198353";
    const botLink = liveCfg.URL_GETNUM || "https://t.me/myzuraisgoodbot";
    
    const API_URL_RANGE = `https://api.telegram.org/bot${tokenRange}`;

    while (MESSAGE_QUEUE.length > 0) {
        const item = MESSAGE_QUEUE.shift();
        try {
            // Hapus pesan lama jika range yang sama muncul lagi
            if (SENT_MESSAGES.has(item.rangeVal)) {
                const oldMid = SENT_MESSAGES.get(item.rangeVal).message_id;
                await axios.post(`${API_URL_RANGE}/deleteMessage`, {
                    chat_id: chatIdRange, 
                    message_id: oldMid
                }).catch(() => {});
                await new Promise(r => setTimeout(r, 500));
            }

            const res = await axios.post(`${API_URL_RANGE}/sendMessage`, {
                chat_id: chatIdRange,
                text: item.text,
                parse_mode: 'HTML',
                reply_markup: { 
                    inline_keyboard: [[{ text: "📞 Get Number", url: botLink }]] 
                }
            });

            if (res.data.ok) {
                SENT_MESSAGES.set(item.rangeVal, {
                    message_id: res.data.result.message_id,
                    count: item.count,
                    timestamp: Date.now()
                });
                saveToInlineJson(item.rangeVal, item.country, item.service);
                console.log(`✅ [RANGE] Bot Terpisah Terkirim: ${item.rangeVal}`);
            }
        } catch (e) {
            if (e.response && e.response.status === 429) {
                const wait = (e.response.data.parameters?.retry_after || 10) * 1000;
                MESSAGE_QUEUE.unshift(item);
                await new Promise(r => setTimeout(r, wait));
            }
        }
        await new Promise(r => setTimeout(r, 1500));
    }
    IS_PROCESSING_QUEUE = false;
}

const saveToInlineJson = (rangeVal, countryName, service) => {
    const serviceMap = { 'whatsapp': 'WA', 'facebook': 'FB' };
    const serviceKey = service.toLowerCase();
    const shortService = serviceMap[serviceKey] || "SVC";

    try {
        let dataList = [];
        if (fs.existsSync(INLINE_JSON_PATH)) {
            try { dataList = JSON.parse(fs.readFileSync(INLINE_JSON_PATH, 'utf-8')); } catch (e) {}
        }
        if (dataList.some(item => item.range === rangeVal)) return;
        dataList.push({
            "range": rangeVal, 
            "country": countryName.toUpperCase(),
            "emoji": getCountryEmoji(countryName), 
            "service": shortService
        });
        if (dataList.length > 15) dataList = dataList.slice(-15);
        fs.writeFileSync(INLINE_JSON_PATH, JSON.stringify(dataList, null, 2), 'utf-8');
    } catch (e) {}
};

const formatLiveMessage = (rangeVal, count, countryName, service, fullMessage) => {
    const emoji = getCountryEmoji(countryName);
    const rangeWithCount = count > 1 ? `<code>${rangeVal}</code> (x${count})` : `<code>${rangeVal}</code>`;
    const msgEscaped = fullMessage.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    
    return `🔥 <b>Live Message New Range</b>\n\n` +
           `📱 Range: ${rangeWithCount}\n` +
           `${emoji} Country: ${countryName}\n` +
           `⚙️ Service: ${service}\n\n` +
           `🗯️ <b>Message Available:</b>\n` +
           `<blockquote>${msgEscaped}</blockquote>`;
};

async function start() {
    if (monitorLoop) return; 
    console.log("🚀 [RANGE] Module Started (Independent Tab).");
    
    monitorLoop = setInterval(async () => {
        if (!state.isBotRunning || !state.browser) return;

        const liveCfg = getLiveConfig();
        // 1. URL TARGET RANGE DINAMIS
        const targetUrl = liveCfg.URL_TARGET_RANGE || "https://x.mnitnetwork.com/mdashboard/console";

        try {
            if (!monitorPage || monitorPage.isClosed()) {
                const contexts = state.browser.contexts();
                const context = contexts.length > 0 ? contexts[0] : await state.browser.newContext();
                monitorPage = await context.newPage();
            }

            if (!monitorPage.url().includes("/console")) {
                console.log(`[RANGE] Navigasi ke Console: ${targetUrl}`);
                await monitorPage.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
            }

            const CONSOLE_SELECTOR = ".group.flex.flex-col.sm\\:flex-row.sm\\:items-start.gap-3.p-3.rounded-lg";
            
            try {
                await monitorPage.waitForSelector(CONSOLE_SELECTOR, { timeout: 5000 });
            } catch(e) { return; }

            const elements = await monitorPage.locator(CONSOLE_SELECTOR).all();

            for (const el of elements) {
                try {
                    const rawC = await el.locator(".flex-shrink-0 .text-\\[10px\\].text-slate-600.mt-1.font-mono").innerText();
                    const country = rawC.includes("•") ? rawC.split("•")[1].trim() : "Unknown";
                    
                    if (['angola'].includes(country.toLowerCase())) continue;

                    const sRaw = await el.locator(".flex-grow.min-w-0 .text-xs.font-bold.text-blue-400").innerText();
                    const service = cleanServiceName(sRaw);
                    
                    if (!['whatsapp', 'facebook'].some(s => service.toLowerCase().includes(s))) continue;

                    const phoneRaw = await el.locator(".flex-grow.min-w-0 .text-\\[10px\\].font-mono").last().innerText();
                    const phone = cleanPhoneNumber(phoneRaw);
                    const msgRaw = await el.locator(".flex-grow.min-w-0 p").innerText();
                    const fullMessage = msgRaw.replace('➜', '').trim();

                    const cacheKey = `${phone}_${fullMessage.substring(0, 10)}`;

                    if (phone.includes('XXX') && !CACHE_SET.has(cacheKey)) {
                        CACHE_SET.add(cacheKey);
                        const currentData = SENT_MESSAGES.get(phone) || { count: 0 };
                        const newCount = currentData.count + 1;
                        
                        MESSAGE_QUEUE.push({
                            rangeVal: phone,
                            country,
                            service,
                            count: newCount,
                            text: formatLiveMessage(phone, newCount, country, service, fullMessage)
                        });
                        processQueue();
                    }
                } catch (e) { continue; }
            }

            // Maintenance Map
            const now = Date.now();
            for (let [range, val] of SENT_MESSAGES.entries()) {
                if (now - val.timestamp > 600000) SENT_MESSAGES.delete(range);
            }

        } catch (e) { 
            console.error(`❌ [RANGE] Loop Error: ${e.message}`);
        }
    }, 12000); 
}

function stop() {
    if (monitorLoop) {
        clearInterval(monitorLoop);
        monitorLoop = null;
        if (monitorPage) {
            monitorPage.close().catch(() => {});
            monitorPage = null;
        }
        console.log("🛑 [RANGE] Module Stopped.");
    }
}

module.exports = { start, stop };
