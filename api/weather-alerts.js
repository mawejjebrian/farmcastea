// Supabase Cron-triggered endpoint: twice-daily, consent-first, test-only weather alerts.
const env = (name) => (process.env[name] || "").trim();
const base = () => env("SUPABASE_URL").replace(/\/$/, "");
const serviceKey = () => env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
const json = (res, status, body) => res.status(status).json(body);
const enc = encodeURIComponent;

async function db(path, method = "GET", body, prefer = "") {
  const key = serviceKey();
  if (!base() || !key) throw new Error("Supabase server configuration is incomplete.");
  const response = await fetch(base() + "/rest/v1/" + path, {
    method,
    headers: {
      apikey: key,
      ...(key.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + key }),
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok) throw new Error((data && data.message) || "Supabase request failed.");
  return data;
}

async function sendTelegram(chatId, text) {
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Telegram bot token is not configured.");
  const response = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    const error = new Error((result && result.description) || "Telegram delivery failed.");
    error.code = result && result.error_code ? String(result.error_code) : "telegram_error";
    throw error;
  }
  return result.result;
}

function buildAlerts(location, daily) {
  const alerts = [];
  const days = (daily.time || []).map((date, i) => ({
    date,
    rain: Number(daily.precipitation_sum?.[i] ?? 0),
    probability: Number(daily.precipitation_probability_max?.[i] ?? 0),
    maxTemp: Number(daily.temperature_2m_max?.[i] ?? 0)
  }));

  const wet = days.find(day => day.rain >= 30);
  if (wet) {
    alerts.push({
      key: "heavy-rain:" + wet.date,
      type: "heavy_rain",
      text: `🌧️ FARMCAST EA WEATHER ALERT — Heavy rainfall risk\n📍 ${location}\n📅 ${wet.date}\nForecast rainfall: about ${Math.round(wet.rain)} mm (maximum probability ${wet.probability}%).\n\nFarming advice: Clear field drains, protect stored inputs and harvested produce, avoid applying fertiliser or pesticides just before heavy rain, and keep livestock away from flood-prone areas.\n\nSource: Open-Meteo forecast. Conditions can change; check local observations.`
    });
  }

  const hot = days.find(day => day.maxTemp >= 35);
  if (hot) {
    alerts.push({
      key: "high-heat:" + hot.date,
      type: "high_heat",
      text: `☀️ FARMCAST EA WEATHER ALERT — High temperature\n📍 ${location}\n📅 ${hot.date}\nForecast maximum temperature: ${Math.round(hot.maxTemp)}°C.\n\nFarming advice: Water crops early morning or late afternoon, mulch exposed soil, provide shade for young seedlings where possible, and ensure livestock have shade and clean drinking water.\n\nSource: Open-Meteo forecast. Conditions can change; check local observations.`
    });
  }

  if (days.length >= 3 && days.slice(0, 3).every(day => day.rain < 1 && day.probability < 30)) {
    alerts.push({
      key: "dry-spell:" + days[0].date,
      type: "dry_spell",
      text: `🌤️ FARMCAST EA WEATHER ALERT — Possible short dry spell\n📍 ${location}\n📅 Next three days from ${days[0].date}\nThe forecast shows less than 1 mm of rain per day and low rainfall probability.\n\nFarming advice: Prioritise water for young plants, mulch around crops to reduce evaporation, repair leaks in water storage, and avoid planting without checking soil moisture and the next forecast.\n\nSource: Open-Meteo forecast. Conditions can change; check local observations.`
    });
  }
  return alerts;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { error: "Method not allowed." });
  }
  const timestamp = String(req.headers["x-timestamp"] || "");
  const signature = String(req.headers["x-signature"] || "");
  const signingSecret = env("WEATHER_ALERT_HMAC_SECRET");
  const timestampSeconds = Number(timestamp);
  if (!signingSecret || !/^\d{10}$/.test(timestamp) ||
      !Number.isFinite(timestampSeconds) ||
      Math.abs(Date.now() - timestampSeconds * 1000) > 5 * 60 * 1000 ||
      !/^[a-f0-9]{64}$/i.test(signature)) {
    return json(res, 401, { error: "Unauthorized." });
  }
  const payloadText = JSON.stringify(req.body || {});
  const hmacKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const digest = await crypto.subtle.sign(
    "HMAC", hmacKey, new TextEncoder().encode(timestamp + "." + payloadText)
  );
  const expectedSignature = Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  let signatureDifference = expectedSignature.length ^ signature.length;
  for (let i = 0; i < Math.min(expectedSignature.length, signature.length); i++) {
    signatureDifference |= expectedSignature.charCodeAt(i) ^ signature.toLowerCase().charCodeAt(i);
  }
  if (signatureDifference !== 0) return json(res, 401, { error: "Unauthorized." });

  try {
    if (!env("TELEGRAM_BOT_TOKEN") || !serviceKey() || !env("SUPABASE_URL")) {
      return json(res, 503, { error: "Weather alert server configuration is incomplete." });
    }

    // Critical safety boundary: only explicitly enabled TEST targets can ever receive alerts.
    const targets = await db("weather_alert_targets?select=id,subscription_id,location_name,latitude,longitude,country&enabled=eq.true&test_mode=eq.true");
    let checked = 0, sent = 0, failed = 0, skipped = 0;

    for (const target of targets || []) {
      const subscribers = await db(
        "telegram_subscriptions?select=chat_id,status&id=eq." + enc(target.subscription_id) + "&status=eq.active"
      );
      if (!Array.isArray(subscribers) || subscribers.length !== 1) { skipped++; continue; }

      const params = new URLSearchParams({
        latitude: String(target.latitude),
        longitude: String(target.longitude),
        daily: "precipitation_sum,precipitation_probability_max,temperature_2m_max",
        forecast_days: "3",
        timezone: "auto"
      });
      const weatherResponse = await fetch("https://api.open-meteo.com/v1/forecast?" + params.toString());
      if (!weatherResponse.ok) throw new Error("Weather provider returned HTTP " + weatherResponse.status + ".");
      const forecast = await weatherResponse.json();
      if (!forecast.daily || !Array.isArray(forecast.daily.time)) throw new Error("Weather provider returned an incomplete forecast.");
      checked++;

      const alerts = buildAlerts(target.location_name, forecast.daily);
      if (!alerts.length) { skipped++; continue; }

      for (const alert of alerts) {
        const existing = await db(
          "weather_alert_logs?select=id,status&target_id=eq." + enc(target.id) + "&alert_key=eq." + enc(alert.key) + "&limit=1"
        );
        let logId;
        if (Array.isArray(existing) && existing.length) {
          if (existing[0].status === "sent") { skipped++; continue; }
          logId = existing[0].id;
          await db("weather_alert_logs?id=eq." + enc(logId), "PATCH", {
            status: "pending", error_code: null, message_text: alert.text
          }, "return=minimal");
        } else {
          const inserted = await db(
            "weather_alert_logs?on_conflict=target_id,alert_key",
            "POST",
            { target_id: target.id, alert_key: alert.key, alert_type: alert.type, message_text: alert.text, status: "pending" },
            "resolution=ignore-duplicates,return=representation"
          );
          if (!Array.isArray(inserted) || !inserted.length) { skipped++; continue; }
          logId = inserted[0].id;
        }

        try {
          const result = await sendTelegram(subscribers[0].chat_id, alert.text);
          await db("weather_alert_logs?id=eq." + enc(logId), "PATCH", {
            status: "sent", telegram_message_id: String(result.message_id), sent_at: new Date().toISOString(), error_code: null
          }, "return=minimal");
          sent++;
        } catch (error) {
          await db("weather_alert_logs?id=eq." + enc(logId), "PATCH", {
            status: "failed", error_code: String(error.code || "delivery_failed").slice(0, 80)
          }, "return=minimal");
          failed++;
        }
      }
    }
    return json(res, 200, { ok: true, test_mode_only: true, locations_checked: checked, alerts_sent: sent, failed, skipped });
  } catch (error) {
    console.error("FARMCAST EA scheduled weather alerts:", error.message);
    return json(res, 500, { error: "Weather alert check failed. Review Vercel function logs." });
  }
}
