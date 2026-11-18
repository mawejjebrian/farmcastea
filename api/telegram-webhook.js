// FARMCAST EA Telegram webhook. Server-only variables:
// TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, SUPABASE_URL,
// SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY.
import { timingSafeEqual } from "node:crypto";

const env = (name) => (process.env[name] || "").trim();
const json = (res, status, body) => res.status(status).json(body);
const supabaseUrl = () => env("SUPABASE_URL").replace(/\/$/, "");

function validSecret(received, expected) {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function database(path, method = "GET", body, prefer = "") {
  const key = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
  if (!key || !env("SUPABASE_URL")) throw new Error("Telegram database is not configured.");
  const headers = {
    apikey: key,
    "Content-Type": "application/json",
    ...(key.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + key }),
    ...(prefer ? { Prefer: prefer } : {})
  };
  const response = await fetch(supabaseUrl() + "/rest/v1/" + path, {
    method, headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok) {
    const error = new Error("Telegram database request failed.");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function telegram(method, payload) {
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Telegram bot token is not configured.");
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    const error = new Error("Telegram API request failed.");
    error.status = data.error_code || response.status;
    throw error;
  }
  return data.result;
}

async function logDelivery(chatId, type, status, messageId = null, errorCode = null) {
  try {
    await database("telegram_logs", "POST", {
      chat_id: String(chatId || ""),
      message_type: type,
      status,
      telegram_message_id: messageId,
      error_code: errorCode
    }, "return=minimal");
  } catch (error) {
    // Do not expose chat content, tokens, or database details in logs.
    console.error("FARMCAST Telegram delivery log failed:", error.status || "database_error");
  }
}

async function sendText(chatId, text, type, replyMarkup) {
  try {
    const message = await telegram("sendMessage", {
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {})
    });
    await logDelivery(chatId, type, "sent", message.message_id);
    return message;
  } catch (error) {
    await logDelivery(chatId, type, "failed", null, Number(error.status) || null);
    throw error;
  }
}

const consentKeyboard = {
  inline_keyboard: [[
    { text: "Yes, subscribe me", callback_data: "farmcast_telegram_consent_yes_v1" },
    { text: "No, thanks", callback_data: "farmcast_telegram_consent_no_v1" }
  ]]
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed." });
  }

  const expectedSecret = env("TELEGRAM_WEBHOOK_SECRET");
  if (!env("TELEGRAM_BOT_TOKEN") || !expectedSecret) {
    return json(res, 503, { error: "Telegram webhook is not configured." });
  }
  const receivedSecret = req.headers["x-telegram-bot-api-secret-token"] || "";
  if (!validSecret(String(receivedSecret), expectedSecret)) {
    return json(res, 401, { error: "Unauthorized webhook." });
  }

  let receivedUpdateId = null;
  try {
    const update = req.body && typeof req.body === "object" ? req.body : {};
    if (!Number.isSafeInteger(update.update_id)) return json(res, 200, { ok: true });
    receivedUpdateId = update.update_id;

    // Telegram may retry webhooks. Process each update only once.
    const accepted = await database(
      "telegram_updates?on_conflict=update_id",
      "POST",
      { update_id: update.update_id },
      "resolution=ignore-duplicates,return=representation"
    );
    if (!Array.isArray(accepted) || accepted.length === 0) {
      return json(res, 200, { ok: true, duplicate: true });
    }

    const message = update.message;
    if (message && message.chat && message.chat.id != null) {
      const chatId = String(message.chat.id);
      const text = String(message.text || "").trim();
      if (/^\/start(?:\s|$)/i.test(text)) {
        await sendText(
          chatId,
          "Welcome to FARMCAST EA 🌱\n\nWe share practical weather and farming updates. If you choose to subscribe, FARMCAST EA will store your Telegram chat ID and may send you relevant agricultural and climate updates. You can stop messages at any time by sending /stop.\n\nDo you agree to receive FARMCAST EA updates on Telegram?",
          "consent_prompt",
          consentKeyboard
        );
      } else if (/^\/stop(?:\s|$)/i.test(text)) {
        await database(
          "telegram_subscriptions?chat_id=eq." + encodeURIComponent(chatId),
          "PATCH",
          { consent_status: "unsubscribed", opted_out_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          "return=minimal"
        );
        await sendText(chatId, "You have been unsubscribed from FARMCAST EA Telegram updates. You will not receive further broadcasts. You can use /start if you wish to review the consent choice again.", "unsubscribe_confirmation");
      }
      return json(res, 200, { ok: true });
    }

    const callback = update.callback_query;
    if (callback && callback.message && callback.message.chat && callback.from) {
      const chatId = String(callback.message.chat.id);
      const choice = String(callback.data || "");
      await telegram("answerCallbackQuery", { callback_query_id: callback.id });
      if (choice === "farmcast_telegram_consent_yes_v1") {
        const user = callback.from;
        await database(
          "telegram_subscriptions?on_conflict=chat_id",
          "POST",
          {
            chat_id: chatId,
            telegram_user_id: String(user.id),
            username: user.username || null,
            first_name: user.first_name || null,
            preferred_language: "English",
            consent_status: "subscribed",
            consent_version: "telegram-consent-v1",
            consent_at: new Date().toISOString(),
            opted_out_at: null,
            updated_at: new Date().toISOString()
          },
          "resolution=merge-duplicates,return=minimal"
        );
        await sendText(chatId, "Thank you. You are subscribed to FARMCAST EA Telegram updates. Send /stop at any time to unsubscribe.", "consent_confirmation");
      } else if (choice === "farmcast_telegram_consent_no_v1") {
        await sendText(chatId, "No problem. You are not subscribed and will not receive FARMCAST EA Telegram updates.", "consent_declined");
      }
      return json(res, 200, { ok: true });
    }

    return json(res, 200, { ok: true });
  } catch (error) {
    // Release the idempotency claim after a failed operation so Telegram can retry.
    if (receivedUpdateId !== null) {
      try {
        await database("telegram_updates?update_id=eq." + encodeURIComponent(receivedUpdateId), "DELETE");
      } catch {
        console.error("FARMCAST EA Telegram retry marker cleanup failed.");
      }
    }
    console.error("FARMCAST EA Telegram webhook error:", error.status || "processing_error");
    return json(res, 500, { error: "Webhook processing failed." });
  }
}
