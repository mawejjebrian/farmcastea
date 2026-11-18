// Telegram webhook. Bot token and webhook secret are server-only.
const env = (name) => (process.env[name] || "").trim();
const base = () => env("SUPABASE_URL").replace(/\/$/, "");
const key = () => env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
const json = (res, status, body) => res.status(status).json(body);
async function db(path, method = "GET", body, prefer = "") {
  const secret = key();
  if (!env("SUPABASE_URL") || !secret) throw new Error("Supabase server configuration is missing.");
  const headers = {
    apikey: secret, "Content-Type": "application/json",
    ...(secret.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + secret }),
    ...(prefer ? { Prefer: prefer } : {})
  };
  const response = await fetch(base() + "/rest/v1/" + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const raw = await response.text(); let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok) throw new Error((data && data.message) || "Supabase request failed.");
  return data;
}
async function telegram(method, payload) {
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Telegram bot token is not configured.");
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error((data && data.description) || "Telegram API request failed.");
  return data.result;
}
const enc = encodeURIComponent;
async function upsertPending(chat, from) {
  const row = {
    chat_id: String(chat.id), telegram_user_id: String(from.id),
    username: from.username ? String(from.username).slice(0, 64) : null,
    first_name: from.first_name ? String(from.first_name).slice(0, 100) : null,
    status: "pending", consent_at: null, opted_out_at: null, updated_at: new Date().toISOString()
  };
  await db("telegram_subscriptions?on_conflict=chat_id", "POST", row, "resolution=merge-duplicates,return=minimal");
}
async function setStatus(chatId, status) {
  const now = new Date().toISOString();
  const patch = status === "active"
    ? { status: "active", consent_at: now, opted_out_at: null, updated_at: now }
    : { status: "unsubscribed", opted_out_at: now, updated_at: now };
  await db("telegram_subscriptions?chat_id=eq." + enc(String(chatId)), "PATCH", patch, "return=minimal");
}
async function isAlreadyActive(chatId) {
  const rows = await db("telegram_subscriptions?select=status&chat_id=eq." + enc(String(chatId)));
  return !!(rows && rows[0] && rows[0].status === "active");
}
async function sendConsent(chatId) {
  await telegram("sendMessage", {
    chat_id: chatId,
    text: "Welcome to FARMCAST EA. We share practical weather, climate and farming updates. You will receive messages only if you choose to subscribe here. Your WhatsApp preferences do not subscribe you to Telegram. Do you agree to receive FARMCAST EA Telegram updates?",
    reply_markup: { inline_keyboard: [[
      { text: "Yes, subscribe", callback_data: "farmcast_consent_yes" },
      { text: "No, thanks", callback_data: "farmcast_consent_no" }
    ]] }
  });
}
export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "Method not allowed." }); }
  const expected = env("TELEGRAM_WEBHOOK_SECRET");
  const supplied = req.headers["x-telegram-bot-api-secret-token"];
  if (!expected || !supplied || supplied !== expected) return json(res, 401, { error: "Unauthorized webhook." });
  try {
    const update = req.body || {};
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message && cb.message.chat && cb.message.chat.id;
      if (!chatId) return json(res, 200, { ok: true });
      if (cb.data === "farmcast_consent_yes") {
        await setStatus(chatId, "active");
        await telegram("answerCallbackQuery", { callback_query_id: cb.id, text: "Subscription confirmed." });
        await telegram("sendMessage", { chat_id: chatId, text: "You are subscribed to FARMCAST EA Telegram updates. Use /stop at any time to unsubscribe. Set your preferences with /country Uganda and /crop maize." });
      } else if (cb.data === "farmcast_consent_no") {
        await setStatus(chatId, "unsubscribed");
        await telegram("answerCallbackQuery", { callback_query_id: cb.id, text: "No subscription was created." });
        await telegram("sendMessage", { chat_id: chatId, text: "No problem. You will not receive FARMCAST EA Telegram broadcasts. You can use /start if you change your mind." });
      }
      return json(res, 200, { ok: true });
    }
    const message = update.message;
    if (!message || !message.chat || !message.from || typeof message.text !== "string") return json(res, 200, { ok: true });
    const chatId = message.chat.id, text = message.text.trim();
    if (/^\/start(?:\s|$)/i.test(text)) {
      if (await isAlreadyActive(chatId)) {
        await telegram("sendMessage", { chat_id: chatId, text: "You are already subscribed. Use /stop at any time to unsubscribe." });
      } else {
        await upsertPending(message.chat, message.from);
        await sendConsent(chatId);
      }
    } else if (/^\/stop(?:\s|$)/i.test(text)) {
      await setStatus(chatId, "unsubscribed");
      await telegram("sendMessage", { chat_id: chatId, text: "You have unsubscribed from FARMCAST EA Telegram updates. Use /start if you want to subscribe again." });
    } else if (/^\/country(?:\s|$)/i.test(text)) {
      const value = text.replace(/^\/country\s*/i, "").trim();
      if (!value || value.length > 80) await telegram("sendMessage", { chat_id: chatId, text: "Send your country like this: /country Uganda" });
      else {
        await db("telegram_subscriptions?chat_id=eq." + enc(String(chatId)) + "&status=eq.active", "PATCH", { country: value, updated_at: new Date().toISOString() }, "return=minimal");
        await telegram("sendMessage", { chat_id: chatId, text: "Country preference updated if you are subscribed." });
      }
    } else if (/^\/crop(?:\s|$)/i.test(text)) {
      const value = text.replace(/^\/crop\s*/i, "").trim();
      if (!value || value.length > 60) await telegram("sendMessage", { chat_id: chatId, text: "Send your main crop like this: /crop maize" });
      else {
        await db("telegram_subscriptions?chat_id=eq." + enc(String(chatId)) + "&status=eq.active", "PATCH", { crop: value, updated_at: new Date().toISOString() }, "return=minimal");
        await telegram("sendMessage", { chat_id: chatId, text: "Crop preference updated if you are subscribed." });
      }
    } else if (/^\/help(?:\s|$)/i.test(text)) {
      await telegram("sendMessage", { chat_id: chatId, text: "FARMCAST EA Telegram commands:\n/start — request subscription\n/stop — unsubscribe\n/country Uganda — set country\n/crop maize — set crop\n/help — show this help" });
    }
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error("FARMCAST EA Telegram webhook:", error.message);
    return json(res, 500, { error: "Webhook processing failed; Telegram may retry this update." });
  }
}
