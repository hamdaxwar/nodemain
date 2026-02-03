const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../helpers/database');
const tg = require('../helpers/telegram');
const { state } = require('../helpers/state');
const scraper = require('../helpers/scraper');
const adminHandler = require('./admin');

// Path ke bot_config.json di root
const BOT_CONFIG_PATH = path.join(__dirname, '../../bot_config.json');

/**
 * Helper untuk membaca konfigurasi dari JSON secara langsung (Live)
 */
const getLiveConfig = () => {
    try {
        if (fs.existsSync(BOT_CONFIG_PATH)) {
            const data = fs.readFileSync(BOT_CONFIG_PATH, 'utf-8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("[COMMANDS] Gagal membaca bot_config.json:", e.message);
    }
    return {};
};

async function processCommand(msg) {
    if (!msg || !msg.chat) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const firstName = msg.from.first_name || "User";
    const usernameTg = msg.from.username;
    const mention = usernameTg ? `@${usernameTg}` : `<a href='tg://user?id=${userId}'>${firstName}</a>`;
    const text = (msg.text || "").trim();

    // 1. Ambil Konfigurasi Terbaru
    const liveCfg = getLiveConfig();
    const adminIdFromConfig = String(liveCfg.ADMIN_ID || config.ADMIN_ID);
    const adminUrl = liveCfg.URL_ADMIN || "https://t.me/Imr1d";
    const groupLink1 = liveCfg.URL_GRUP_OTP || config.GROUP_LINK_1;

    // 2. Deteksi Format Range Manual (Regex: Angka diikuti X/x/*/ atau #)
    // Contoh: 225071606XXX atau +62812XXX
    const rangePattern = /^\+?\d{3,15}[Xx*#]+$/;
    const isManualRange = rangePattern.test(text);

    // --- FITUR ADMIN ---
    if (String(userId) === adminIdFromConfig) {
        if (text.startsWith("/add")) {
            state.waitingAdminInput.add(userId);
            const prompt = "Silahkan kirim daftar range dalam format:\n\n<code>range > country > service</code>\n\nContoh:\n<code>23273XXX > SIERRA LEONE > WA</code>";
            const mid = await tg.tgSend(userId, prompt);
            if (mid) state.pendingMessage[userId] = mid;
            return;
        } 
        else if (text === "/info") {
            state.waitingBroadcastInput.add(userId);
            const mid = await tg.tgSend(userId, "<b>Pesan Siaran</b>\n\nKirim pesan yang ingin disiarkan.");
            if (mid) state.broadcastMessage[userId] = mid;
            return;
        } 
        else if (text.startsWith("/get10akses ")) {
            const targetId = text.split(" ")[1];
            db.saveAksesGet10(targetId);
            await tg.tgSend(userId, `✅ User <code>${targetId}</code> berhasil diberi akses /get10.`);
            return;
        } 
        else if (text === "/list") {
            await adminHandler.handleListUsers(userId);
            return;
        }
    }

    // --- PERINTAH /GET10 ---
    if (text === "/get10") {
        if (db.hasGet10Access(userId)) {
            state.get10RangeInput.add(userId);
            const mid = await tg.tgSend(userId, "Kirim range untuk 10 nomor sekaligus\nContoh: <code>225071606XXX</code>");
            if (mid) state.pendingMessage[userId] = mid;
        } else {
            await tg.tgSend(userId, "❌ Anda tidak memiliki akses untuk perintah ini.");
        }
        return;
    }

    // --- PERINTAH /SETDANA ---
    if (text === "/setdana") {
        state.waitingDanaInput.add(userId);
        await tg.tgSend(userId, "Silahkan kirim dana dalam format:\n\n<code>08123456789\nNama Pemilik</code>");
        return;
    }

    // --- LOGIKA INPUT STATE (WAITING INPUT) ---
    
    // 1. State Input Range Admin
    if (state.waitingAdminInput.has(userId)) {
        state.waitingAdminInput.delete(userId);
        const pMsgId = state.pendingMessage[userId];
        delete state.pendingMessage[userId];
        await adminHandler.handleAddRange(userId, text, pMsgId);
        return;
    }

    // 2. State Broadcast Admin
    if (state.waitingBroadcastInput.has(userId)) {
        state.waitingBroadcastInput.delete(userId);
        const pMsgId = state.broadcastMessage[userId];
        delete state.broadcastMessage[userId];
        await adminHandler.handleBroadcast(userId, chatId, text, pMsgId);
        return;
    }

    // 3. State Setup Dana
    if (state.waitingDanaInput.has(userId)) {
        const lines = text.split('\n');
        if (lines.length >= 2) {
            const dNum = lines[0].trim();
            const dName = lines.slice(1).join(' ').trim();
            if (/^[\d+]+$/.test(dNum)) {
                state.waitingDanaInput.delete(userId);
                db.updateUserDana(userId, dNum, dName);
                await tg.tgSend(userId, `✅ <b>Dana Berhasil Disimpan!</b>\n\nNo: ${dNum}\nA/N: ${dName}`);
            } else {
                await tg.tgSend(userId, "❌ Format salah. Baris pertama harus nomor.");
            }
        } else {
            await tg.tgSend(userId, "❌ Kirim nomor dan nama (2 baris).");
        }
        return;
    }

    // 4. State Khusus /get10
    if (state.get10RangeInput.has(userId)) {
        state.get10RangeInput.delete(userId);
        if (isManualRange) {
            let mid = await tg.tgSend(chatId, scraper.getProgressMessage(0, 0, text, 10));
            scraper.processUserInput(userId, text, 10, usernameTg, firstName, mid);
        } else {
            await tg.tgSend(chatId, "❌ Format Range tidak valid untuk /get10.");
        }
        return;
    }

    // --- LOGIKA AUTO-RANGE (DIRECT INPUT) ---
    // Jika user mengetik range secara langsung (misal: 22898204XXX)
    if (isManualRange) {
        // Hapus dari state manual input jika ada (agar tidak bentrok)
        state.manualRangeInput.delete(userId);
        
        // Cek Verifikasi (Opsional: Jika ingin paksa join grup dulu)
        if (!state.verifiedUsers.has(userId)) {
            const isMember = await tg.isUserInBothGroups(userId);
            if (!isMember) {
                return await tg.tgSend(userId, "❌ Silahkan ketik /start dan verifikasi grup terlebih dahulu.");
            }
            state.verifiedUsers.add(userId);
        }

        // Mulai proses scraping (1 nomor untuk input manual biasa)
        let mid = await tg.tgSend(chatId, scraper.getProgressMessage(0, 0, text, 1));
        scraper.processUserInput(userId, text, 1, usernameTg, firstName, mid);
        return;
    }

    // --- MENU /START ---
    if (text === "/start") {
        if (await tg.isUserInBothGroups(userId)) {
            state.verifiedUsers.add(userId);
            db.saveUsers(userId);
            const prof = db.getUserProfile(userId, firstName);
            const fullName = usernameTg ? `${firstName} (@${usernameTg})` : firstName;
            
            const msgProfile = `✅ <b>Verifikasi Berhasil, ${mention}</b>\n\n` +
                `👤 <b>Profil Anda :</b>\n` +
                `🔖 <b>Nama</b> : ${fullName}\n` +
                `🧾 <b>Dana</b> : ${prof.dana}\n` +
                `👤 <b>A/N</b> : ${prof.dana_an}\n` +
                `📊 <b>Total OTP</b> : ${prof.otp_semua}\n` +
                `💰 <b>Balance</b> : $${prof.balance.toFixed(6)}\n\n` +
                `💡 <i>Tips: Langsung kirim range (ex: 228xxx) untuk get number!</i>`;

            const kb = {
                inline_keyboard: [
                    [{ text: "📲 Get Number", callback_data: "getnum" }, { text: "👨‍💼 Admin", url: adminUrl }],
                    [{ text: "💸 Withdraw Money", callback_data: "withdraw_menu" }]
                ]
            };
            await tg.tgSend(userId, msgProfile, kb);
        } else {
            const kb = {
                inline_keyboard: [
                    [{ text: "📌 Gabung Grup 1", url: groupLink1 }],
                    [{ text: "📌 Gabung Grup 2", url: config.GROUP_LINK_2 }],
                    [{ text: "✅ Verifikasi Ulang", callback_data: "verify" }]
                ]
            };
            await tg.tgSend(userId, `Halo ${mention} 👋\nHarap gabung grup untuk menggunakan bot:`, kb);
        }
    }
}

module.exports = { processCommand };
