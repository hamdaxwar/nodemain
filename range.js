const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { state } = require('./helpers/state'); 
const config = require('./config');

let monitorLoop = null;
let monitorPage = null; 

// Inisialisasi Ingatan Sesi
let sessionConfig = {
    token: null,
    chatId: null,
    botLink: null,
    targetUrl: null
};

function syncSession() {
    sessionConfig.token = state.BOT_TOKEN_RANGE || state.BOT_TOKEN;
    sessionConfig.chatId = state.CHAT_ID_RANGE;
    sessionConfig.botLink = state.URL_GETNUM;
    sessionConfig.targetUrl = state.URL_TARGET_RANGE;
    console.log("[RANGE] Sesi Config Sinkron.");
}

let SENT_MESSAGES = new Map();
let CACHE_SET = new Set();
let MESSAGE_QUEUE = []; 
let IS_PROCESSING_QUEUE = false; 

const INLINE_JSON_PATH = path.join(process.cwd(), 'inline.json');

const getCountryEmoji = (countryName) => config.COUNTRY_EMOJI[countryName.toUpperCase()] || "🏴‍☠️";

async function processQueue() {
    if (IS_PROCESSING_QUEUE || MESSAGE_QUEUE.length === 0) return;
    IS_PROCESSING_QUEUE = true;

    const API_URL_RANGE = `https://api.telegram.org/bot${sessionConfig.token}`;

    while (MESSAGE_QUEUE.length > 0) {
        const item = MESSAGE_QUEUE.shift();
        try {
            if (SENT_MESSAGES.has(item.rangeVal)) {
                const oldMid = SENT_MESSAGES.get(item.rangeVal).message_id;
                await axios.post(`${API_URL_RANGE}/deleteMessage`, {
                    chat_id: sessionConfig.chatId, 
                    message_id: oldMid
                }).catch(() => {});
            }

            const res = await axios.post(`${API_URL_RANGE}/sendMessage`, {
                chat_id: sessionConfig.chatId,
                text: item.text,
                parse_mode: 'HTML',
                reply_markup: { 
                    inline_keyboard: [[{ text: "📞 Get Number", url: sessionConfig.botLink }]] 
                }
            });

            if (res.data.ok) {
                SENT_MESSAGES.set(item.rangeVal, {
                    message_id: res.data.result.message_id,
                    count: item.count,
                    timestamp: Date.now()
                });
            }
        } catch (e) { }
        await new Promise(r => setTimeout(r, 1500));
    }
    IS_PROCESSING_QUEUE = false;
}

const formatLiveMessage = (rangeVal, count, countryName, service, fullMessage) => {
    const emoji = getCountryEmoji(countryName);
    const rangeWithCount = count > 1 ? `<code>${rangeVal}</code> (x${count})` : `<code>${rangeVal}</code>`;
    return `🔥 <b>Live Message New Range</b>\n\n` +
           `📱 Range: ${rangeWithCount}\n` +
           `${emoji} Country: ${countryName}\n` +
           `⚙️ Service: ${service}\n\n` +
           `🗯️ <b>Message Available:</b>\n` +
           `<blockquote>${fullMessage.replace(/</g, "&lt;")}</blockquote>`;
};

async function start() {
    if (monitorLoop) return; 
    syncSession();
    console.log("🚀 [RANGE] Module Started.");
    
    monitorLoop = setInterval(async () => {
        if (!state.isBotRunning || !state.browser) return;

        try {
            if (!monitorPage || monitorPage.isClosed()) {
                const contexts = state.browser.contexts();
                const context = contexts.length > 0 ? contexts[0] : await state.browser.newContext();
                monitorPage = await context.newPage();
            }

            if (!monitorPage.url().includes(sessionConfig.targetUrl)) {
                await monitorPage.goto(sessionConfig.targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
            }

            const CONSOLE_SELECTOR = ".group.flex.flex-col.sm\\:flex-row.sm\\:items-start.gap-3.p-3.rounded-lg";
            const elements = await monitorPage.locator(CONSOLE_SELECTOR).all();

            for (const el of elements) {
                try {
                    const rawC = await el.locator(".flex-shrink-0 .text-\\[10px\\].text-slate-600.mt-1.font-mono").innerText();
                    const country = rawC.includes("•") ? rawC.split("•")[1].trim() : "Unknown";
                    const sRaw = await el.locator(".flex-grow.min-w-0 .text-xs.font-bold.text-blue-400").innerText();
                    const phoneRaw = await el.locator(".flex-grow.min-w-0 .text-\\[10px\\].font-mono").last().innerText();
                    const msgRaw = await el.locator(".flex-grow.min-w-0 p").innerText();

                    const phone = phoneRaw.replace(/[^0-9X]/g, '');
                    const cacheKey = `${phone}_${msgRaw.substring(0, 10)}`;

                    if (phone.includes('XXX') && !CACHE_SET.has(cacheKey)) {
                        CACHE_SET.add(cacheKey);
                        const currentData = SENT_MESSAGES.get(phone) || { count: 0 };
                        const newCount = currentData.count + 1;
                        
                        MESSAGE_QUEUE.push({
                            rangeVal: phone,
                            text: formatLiveMessage(phone, newCount, country, sRaw, msgRaw)
                        });
                        processQueue();
                    }
                } catch (e) { }
            }
        } catch (e) { }
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

module.exports = { start, stop, syncSession };
