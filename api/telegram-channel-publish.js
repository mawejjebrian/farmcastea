// Admin-only manual publisher for the official FARMCAST EA Telegram channel.
const env = (name) => (process.env[name] || "").trim();
const base = () => env("SUPABASE_URL").replace(/\/$/, "");
const serverKey = () => env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
const json = (res, status, body) => res.status(status).json(body);

async function authorize(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const apiKey = env("SUPABASE_PUBLISHABLE_KEY") || env("SUPABASE_ANON_KEY") || serverKey();
  if (!token || !env("SUPABASE_URL") || !apiKey || !serverKey()) return false;
  const response = await fetch(base() + "/auth/v1/user", { headers: { apikey: apiKey, Authorization: "Bearer " + token } });
  if (!response.ok) return false;
  const user = await response.json();
  const allowed = env("FARMCAST_ADMIN_EMAILS").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  return !!user.email && allowed.includes(String(user.email).trim().toLowerCase());
}

async function publish(text) {
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Telegram bot token is not configured.");
  const response = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: "@FarmcastEA", text, disable_web_page_preview: true })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error((data && data.description) || "Telegram channel publishing failed.");
  return data.result;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "Method not allowed." }); }
  try {
    if (!await authorize(req)) return json(res, 401, { error: "Administrator sign-in required." });
    const body = req.body || {};
    if (body.action !== "publish") return json(res, 400, { error: "Unknown action." });
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 3500) return json(res, 400, { error: "Write a message of 1–3,500 characters." });
    const result = await publish(message);
    return json(res, 200, { published: true, message_id: result.message_id, chat_id: "@FarmcastEA" });
  } catch (error) {
    console.error("FARMCAST EA channel publisher:", error.message);
    return json(res, 502, { error: error.message || "Could not publish to the channel." });
  }
}
