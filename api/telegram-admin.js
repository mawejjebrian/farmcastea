// Private Telegram broadcast and webhook administration API.
const env = (name) => (process.env[name] || "").trim();
const base = () => env("SUPABASE_URL").replace(/\/$/, "");
const secretKey = () => env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
const json = (res, status, body) => res.status(status).json(body);
async function db(path, method = "GET", body, prefer = "", range = "") {
  const secret = secretKey();
  const headers = {
    apikey: secret, "Content-Type": "application/json",
    ...(secret.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + secret }),
    ...(prefer ? { Prefer: prefer } : {}), ...(range ? { Range: range } : {})
  };
  const response = await fetch(base() + "/rest/v1/" + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const raw = await response.text(); let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok) throw new Error((data && data.message) || "Database request failed.");
  return data;
}
async function requireAdmin(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const authApiKey = env("SUPABASE_PUBLISHABLE_KEY") || env("SUPABASE_ANON_KEY") || secretKey();
  const required = {
    SUPABASE_URL: env("SUPABASE_URL"),
    SUPABASE_AUTH_API_KEY: authApiKey,
    SUPABASE_SERVER_SECRET: secretKey(),
    FARMCAST_ADMIN_EMAILS: env("FARMCAST_ADMIN_EMAILS")
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name);
  if (!token || missing.length) {
    console.error("Telegram admin auth configuration missing:", missing.length ? missing.join(", ") : "bearer token");
    return false;
  }

  let response;
  try {
    response = await fetch(base() + "/auth/v1/user", {
      headers: { apikey: authApiKey, Authorization: "Bearer " + token }
    });
  } catch (error) {
    console.error("Telegram admin Supabase Auth request failed:", error.message);
    return false;
  }
  if (!response.ok) {
    console.warn("Telegram admin Supabase Auth rejected the session:", response.status);
    return false;
  }

  let user;
  try {
    user = await response.json();
  } catch {
    console.warn("Telegram admin Supabase Auth returned an unreadable user response.");
    return false;
  }
  const allowed = required.FARMCAST_ADMIN_EMAILS.split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  const email = String(user.email || "").trim().toLowerCase();

  // The allowlist is the administrator authorization boundary. Do not add an
  // email-confirmation gate here: projects may explicitly allow unverified
  // email sign-ins, and Supabase already enforces the project's Auth policy.
  return !!email && allowed.includes(email);
}
function filters(body, snapshotAt, cursor) {
  const q = new URLSearchParams({ select: "id,chat_id,country,crop,preferred_language,created_at", status: "eq.active", order: "created_at.asc,id.asc" });
  if (body.country) q.set("country", "eq." + String(body.country).trim().slice(0, 80));
  if (body.crop) q.set("crop", "eq." + String(body.crop).trim().slice(0, 60));
  q.set("consent_at", "lte." + snapshotAt);
  if (cursor) q.set("or", "(created_at.gt." + cursor.created_at + ",and(created_at.eq." + cursor.created_at + ",id.gt." + cursor.id + "))");
  return q;
}
async function telegram(method, payload) {
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is missing.");
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST", headers: { "Content-Type": "application/json" },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    const error = new Error((data && data.description) || "Telegram API request failed.");
    error.code = data && data.error_code ? String(data.error_code) : "telegram_error";
    throw error;
  }
  return data.result;
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "Method not allowed." }); }
  if (!await requireAdmin(req)) return json(res, 401, { error: "Sign in with an approved FARMCAST EA administrator account." });
  try {
    const body = req.body || {};
    if (body.action === "recent_logs") {
      const rows = await db("telegram_delivery_logs?select=created_at,status,error_code,telegram_message_id&order=created_at.desc&limit=30");
      return json(res, 200, { logs: rows || [] });
    }
    if (body.action === "webhook_info") {
      const info = await telegram("getWebhookInfo");
      return json(res, 200, { url: info.url || "", pending_update_count: info.pending_update_count || 0, last_error_date: info.last_error_date || null, last_error_message: info.last_error_message || null });
    }
    if (body.action === "set_webhook") {
      const webhookSecret = env("TELEGRAM_WEBHOOK_SECRET");
      if (!webhookSecret || webhookSecret.length < 32 || !/^[A-Za-z0-9_-]+$/.test(webhookSecret)) return json(res, 400, { error: "Set a random TELEGRAM_WEBHOOK_SECRET of at least 32 characters in Vercel Production first." });
      const result = await telegram("setWebhook", {
        url: "https://farmcastea.vercel.app/api/telegram-webhook",
        secret_token: webhookSecret,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: false
      });
      return json(res, 200, { connected: result === true, url: "https://farmcastea.vercel.app/api/telegram-webhook" });
    }
    const message = String(body.message || "").trim();
    if (body.action === "preview") {
      const snapshotAt = new Date().toISOString();
      const query = filters(body, snapshotAt, null);
      let count = 0;
      for (let offset = 0; offset < 100000; offset += 1000) {
        const rows = await db("telegram_subscriptions?" + query.toString(), "GET", undefined, "", offset + "-" + (offset + 999));
        count += rows.length;
        if (rows.length < 1000) break;
      }
      return json(res, 200, { eligible: count, snapshot_at: snapshotAt, country: body.country || null, crop: body.crop || null, max_per_click: 10 });
    }
    if (body.action === "send_batch") {
      if (!message || message.length > 3500) return json(res, 400, { error: "Message must contain 1–3500 characters." });
      const snapshotAt = typeof body.snapshot_at === "string" ? body.snapshot_at : "";
      const snapshotMs = Date.parse(snapshotAt);
      if (!Number.isFinite(snapshotMs) || snapshotMs > Date.now() + 60000) return json(res, 400, { error: "Run a fresh subscriber preview before sending." });
      let cursor = null;
      if (body.cursor != null) {
        const c = body.cursor;
        if (!c || typeof c.created_at !== "string" || !Number.isFinite(Date.parse(c.created_at)) ||
            Date.parse(c.created_at) > snapshotMs || typeof c.id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(c.id)) {
          return json(res, 400, { error: "Invalid broadcast cursor. Run a fresh preview." });
        }
        cursor = c;
      }
      const query = filters(body, snapshotAt, cursor);
      const rows = await db("telegram_subscriptions?" + query.toString(), "GET", undefined, "", "0-10");
      const batchRows = rows.slice(0, 10);
      if (!batchRows.length) return json(res, 200, { sent: 0, failed: 0, processed: 0, next_cursor: cursor, done: true });
      const batchId = crypto.randomUUID();
      let sent = 0, failed = 0;
      for (const row of batchRows) {
        let result = null, failure = null;
        try { result = await telegram("sendMessage", { chat_id: row.chat_id, text: message, disable_web_page_preview: true }); }
        catch (error) { failure = error; }
        try {
          await db("telegram_delivery_logs", "POST", {
            batch_id: batchId, subscription_id: row.id, chat_id: row.chat_id,
            message_text: message, status: failure ? "failed" : "sent",
            telegram_message_id: result ? String(result.message_id) : null,
            error_code: failure ? String(failure.code || "send_error").slice(0, 80) : null,
            sent_at: failure ? null : new Date().toISOString()
          }, "return=minimal");
        } catch (logError) { console.error("Telegram delivery log write failed:", logError.message); }
        if (failure) failed++; else sent++;
      }
      const last = batchRows[batchRows.length - 1];
      return json(res, 200, {
        batch_id: batchId, sent, failed, processed: batchRows.length,
        next_cursor: { created_at: last.created_at, id: last.id },
        done: rows.length <= 10
      });
    }
    return json(res, 400, { error: "Unknown action." });
  } catch (error) {
    console.error("FARMCAST EA Telegram admin API:", error.message);
    return json(res, 500, { error: "Telegram administration request failed. Check server logs and configuration." });
  }
}
