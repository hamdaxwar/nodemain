const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('./database');

// Path ke bot_config.json
const BOT_CONFIG_PATH = path.join(__dirname, '../bot_config.json');

/**
 * Helper untuk membaca konfigurasi dari JSON secara langsung (Live)
 */
const getLiveConfig = () => {
    try {
        if (fs.existsSync(BOT_CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(BOT_CONFIG_PATH, 'utf-8'));
        }
    } catch (e) {}
    return {};
};

async function handleRateLimit(e) {
    if (e.response && e.response.status === 429) {
        const retryAfter = (e.response.data.parameters?.retry_after || 10) * 1000;
        console.log(`[!] Telegram Rate Limit. Menunggu ${retryAfter / 1000} detik...`);
        await new Promise(r => setTimeout(r, retryAfter));
        return true;
    }
    return false;
}

async function tgSend(chatId, text, replyMarkup = null) {
    const data = { chat_id: chatId, text: text, parse_mode: "HTML" };
    if (replyMarkup) data.reply_markup = replyMarkup;
    try {
        const res = await axios.post(`${config.API_URL}/sendMessage`, data);
        if (res.data.ok) return res.data.result.message_id;
    } catch (e) {
        if (await handleRateLimit(e)) return tgSend(chatId, text, replyMarkup);
        return null;
    }
    return null;
}

async function tgEdit(chatId, messageId, text, replyMarkup = null) {
    const data = { chat_id: chatId, message_id: messageId, text: text, parse_mode: "HTML" };
    if (replyMarkup) data.reply_markup = replyMarkup;
    try {
        await axios.post(`${config.API_URL}/editMessageText`, data, { timeout: 10000 });
    } catch (e) { await handleRateLimit(e); }
}

async function tgDelete(chatId, messageId) {
    try {
        await axios.post(`${config.API_URL}/deleteMessage`, { chat_id: chatId, message_id: messageId });
    } catch (e) { await handleRateLimit(e); }
}

async function tgSendAction(chatId, action = "typing") {
    try {
        await axios.post(`${config.API_URL}/sendChatAction`, { chat_id: chatId, action: action });
    } catch (e) { await handleRateLimit(e); }
}

async function tgGetUpdates(offset) {
    try {
        const res = await axios.get(`${config.API_URL}/getUpdates`, { 
            params: { offset: offset, timeout: 20 } 
        });
        return res.data;
    } catch (e) {
        if (e.response && e.response.status === 429) {
            const retryAfter = (e.response.data.parameters?.retry_after || 10) * 1000;
            await new Promise(r => setTimeout(r, retryAfter));
        } else {
            await new Promise(r => setTimeout(r, 5000));
        }
        return { ok: false, result: [] };
    }
}

async function isUserInGroup(userId, groupId) {
    if (!groupId) return true; 
    try {
        const res = await axios.get(`${config.API_URL}/getChatMember`, { 
            params: { chat_id: groupId, user_id: userId } 
        });
        if (!res.data.ok) return false;
        const status = res.data.result.status;
        return ["member", "administrator", "creator"].includes(status);
    } catch (e) { return false; }
}

async function isUserInBothGroups(userId) {
    const liveCfg = getLiveConfig();
    
    // Gunakan ID Grup dari JSON jika ada, jika tidak pakai dari config.js
    const groupId1 = liveCfg.ID_GRUP_OTP || config.GROUP_ID_1;
    const groupId2 = config.GROUP_ID_2;

    const [g1, g2] = await Promise.all([
        isUserInGroup(userId, groupId1),
        isUserInGroup(userId, groupId2)
    ]);
    return g1 && g2;
}

async function tgBroadcast(messageText, adminId) {
    const userIds = Array.from(db.loadUsers());
    let success = 0; let fail = 0;
    
    const initialMsg = `🔄 Memulai siaran ke <b>${userIds.length}</b> pengguna.`;
    let adminMsgId = await tgSend(adminId, initialMsg);

    for (let i = 0; i < userIds.length; i++) {
        const uid = userIds[i];
        
        // Update status ke admin setiap 5 pengiriman
        if (i % 5 === 0 && adminMsgId) {
            await tgEdit(adminId, adminMsgId, `🔄 Siaran Sedang Berjalan...\n\n📊 Progress: <b>${i}/${userIds.length}</b>\n✅ Sukses: <b>${success}</b>\n❌ Gagal: <b>${fail}</b>`);
        }
        
        const res = await tgSend(uid, messageText);
        if (res) success++; else fail++;
        
        // Jeda agar tidak kena limit broadcast Telegram
        await new Promise(r => setTimeout(r, 500)); 
    }
    
    const report = `✅ <b>Siaran Selesai!</b>\n\n👥 Total Pengguna: <b>${userIds.length}</b>\n🟢 Berhasil: <b>${success}</b>\n🔴 Gagal: <b>${fail}</b>`;
    if (adminMsgId) await tgEdit(adminId, adminMsgId, report);
    else await tgSend(adminId, report);
}

module.exports = { 
    tgSend, tgEdit, tgDelete, tgSendAction, 
    tgGetUpdates, isUserInGroup, isUserInBothGroups, 
    tgBroadcast 
};
