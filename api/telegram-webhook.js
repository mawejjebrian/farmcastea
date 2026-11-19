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
  const chatId = String(chat.id);
  const userId = String(from.id);
  const now = new Date().toISOString();
  const profile = {
    telegram_user_id: userId,
    username: from.username ? String(from.username).slice(0, 64) : null,
    first_name: from.first_name ? String(from.first_name).slice(0, 100) : null,
    updated_at: now
  };

  // Never overwrite an active subscription, even if two /start updates race.
  // Re-open only pending or previously unsubscribed rows.
  const updated = await db(
    "telegram_subscriptions?chat_id=eq." + enc(chatId) +
      "&telegram_user_id=eq." + enc(userId) + "&status=in.(pending,unsubscribed)",
    "PATCH",
    { ...profile, status: "pending", consent_at: null, opted_out_at: null },
    "return=representation"
  );
  if (Array.isArray(updated) && updated.length > 0) return;

  // If no row exists, insert without replacing a row created concurrently.
  // resolution=ignore-duplicates ensures a concurrent active row remains active.
  await db(
    "telegram_subscriptions?on_conflict=chat_id",
    "POST",
    { chat_id: chatId, ...profile, status: "pending", consent_at: null, opted_out_at: null },
    "resolution=ignore-duplicates,return=minimal"
  );
}
async function setStatus(chatId, telegramUserId, status) {
  const now = new Date().toISOString();
  const patch = status === "active"
    ? { status: "active", consent_at: now, opted_out_at: null, updated_at: now }
    : { status: "unsubscribed", opted_out_at: now, updated_at: now };
  const stateFilter = status === "active" ? "&status=eq.pending" : "&status=in.(pending,active)";
  const query = "chat_id=eq." + enc(String(chatId)) +
    "&telegram_user_id=eq." + enc(String(telegramUserId)) + stateFilter;
  const rows = await db("telegram_subscriptions?" + query, "PATCH", patch, "return=representation");
  return Array.isArray(rows) && rows.length > 0;
}
async function isAlreadyActive(chatId, telegramUserId) {
  const query = "chat_id=eq." + enc(String(chatId)) + "&telegram_user_id=eq." + enc(String(telegramUserId));
  const rows = await db("telegram_subscriptions?select=status&" + query);
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

async function getSubscription(chatId, telegramUserId) {
  const query = "chat_id=eq." + enc(String(chatId)) + "&telegram_user_id=eq." + enc(String(telegramUserId));
  const rows = await db("telegram_subscriptions?select=id,status,country,crop,preferred_language&" + query);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}
function weatherDescription(code) {
  if (code === 0) return "Clear sky";
  if ([1, 2, 3].includes(code)) return "Partly cloudy";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain or showers";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Conditions reported";
}
async function sendWeather(chatId, place, country, forecast) {
  if (!place) {
    await telegram("sendMessage", { chat_id: chatId, text: "Please include your town or district. Example: /" + (forecast ? "forecast" : "weather") + " Wakiso" + (country ? ", " + country : ", Uganda") + ". You can set your country with /country Uganda." });
    return;
  }
  const searchName = country && !place.toLowerCase().includes(country.toLowerCase()) ? place + ", " + country : place;
  const geoUrl = "https://geocoding-api.open-meteo.com/v1/search?name=" + enc(searchName) + "&count=8&language=en&format=json";
  const geoResponse = await fetch(geoUrl);
  if (!geoResponse.ok) throw new Error("Weather location search is temporarily unavailable.");
  const geoData = await geoResponse.json();
  const results = Array.isArray(geoData.results) ? geoData.results : [];
  if (!results.length) {
    await telegram("sendMessage", { chat_id: chatId, text: "I couldn't find that place. Try a nearby town or district, for example /weather Wakiso, Uganda." });
    return;
  }
  const match = results.find(item => country && item.country && item.country.toLowerCase() === country.toLowerCase()) || results[0];
  const label = [match.name, match.admin1, match.country].filter(Boolean).join(", ");
  const params = new URLSearchParams({
    latitude: String(match.latitude),
    longitude: String(match.longitude),
    current: "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code",
    timezone: "auto",
    forecast_days: forecast ? "5" : "1"
  });
  const weatherResponse = await fetch("https://api.open-meteo.com/v1/forecast?" + params.toString());
  if (!weatherResponse.ok) throw new Error("The weather service is temporarily unavailable.");
  const data = await weatherResponse.json();
  if (!data.current) throw new Error("No current weather data was returned for that location.");
  const c = data.current;
  if (!forecast) {
    const rainChance = data.daily && data.daily.precipitation_probability_max ? data.daily.precipitation_probability_max[0] : null;
    const lines = [
      "🌦 FARMCAST EA weather: " + label,
      weatherDescription(c.weather_code) + ", " + Math.round(c.temperature_2m) + "°C",
      "Rain now: " + c.precipitation + " mm" + (rainChance == null ? "" : " · Today's rain chance: " + rainChance + "%"),
      "Humidity: " + c.relative_humidity_2m + "%",
      "Wind: " + c.wind_speed_10m + " km/h",
      "Updated: " + c.time + " (" + (data.timezone || "local time") + ")",
      "",
      "Farm note: Check actual field conditions before irrigation, spraying or other weather-sensitive work. Forecasts can change."
    ];
    await telegram("sendMessage", { chat_id: chatId, text: lines.join("\n") });
    return;
  }
  const d = data.daily || {};
  const lines = ["📅 FARMCAST EA 5-day forecast: " + label];
  for (let i = 0; i < (d.time || []).length; i++) {
    lines.push(
      d.time[i] + ": " + weatherDescription(d.weather_code[i]) +
      ", " + Math.round(d.temperature_2m_min[i]) + "–" + Math.round(d.temperature_2m_max[i]) + "°C" +
      ", rain " + d.precipitation_sum[i] + " mm" +
      (d.precipitation_probability_max[i] == null ? "" : " (chance " + d.precipitation_probability_max[i] + "%)")
    );
  }
  lines.push("", "Farm note: Use this as planning guidance, not a guarantee. Confirm conditions locally.");
  await telegram("sendMessage", { chat_id: chatId, text: lines.join("\n") });
}
async function askFarmcast(chatId, question, profile, mode) {
  const language = ({ English: "en", Luganda: "lg", Kiswahili: "sw" })[profile && profile.preferred_language] || "en";
  const prompt = mode === "advice"
    ? (question || ("Give practical, safe crop-management advice for " + (profile && profile.crop ? profile.crop : "smallholder crops") + " in " + (profile && profile.country ? profile.country : "East Africa") + ". Cover field monitoring, soil moisture and when to seek extension support."))
    : question;
  if (!prompt) {
    await telegram("sendMessage", { chat_id: chatId, text: "Please add your question. Example: /ask My maize leaves are yellow after heavy rain. Or use /advice followed by a crop or farming question." });
    return;
  }
  const response = await fetch("https://farmcastea.vercel.app/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: prompt.slice(0, 1500),
      location: profile && profile.country ? profile.country : "East Africa",
      crop: profile && profile.crop ? profile.crop : "unspecified",
      language
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.answer) {
    const message = data && data.error ? data.error : "The AI assistant is unavailable right now. Please try again later.";
    await telegram("sendMessage", { chat_id: chatId, text: message });
    return;
  }
  const answer = String(data.answer).slice(0, 3500);
  await telegram("sendMessage", { chat_id: chatId, text: answer });
}
async function submitFieldReport(chatId, text, profile) {
  const usage = "To submit a field observation, first set your country with /country Uganda, then send:\n/report Crop | District or town | Issue | Severity | Rainfall observed | Details | I AGREE\nExample:\n/report Maize | Wakiso | Yellow leaves | Moderate | Heavy rain | Leaves yellowing after three days of rain | I AGREE\nOnly include information you are comfortable sharing. Do not include phone numbers or sensitive personal details.";
  if (!profile || !profile.country) {
    await telegram("sendMessage", { chat_id: chatId, text: "Please set your country first using /country Uganda. Then use /report with the format below.\n\n" + usage });
    return;
  }
  const raw = text.replace(/^\/report(?:@[A-Za-z0-9_]+)?\s*/i, "");
  const parts = raw.split("|").map(value => value.trim());
  if (parts.length !== 7 || parts[6].toUpperCase() !== "I AGREE") {
    await telegram("sendMessage", { chat_id: chatId, text: usage });
    return;
  }
  const [crop, district, issue, severityInput, rainfall, details] = parts;
  const severityMap = { low: "Low", moderate: "Moderate", high: "High", unspecified: "Unspecified" };
  const severity = severityMap[severityInput.toLowerCase()];
  if (!crop || crop.length > 60 || !district || district.length > 160 || !issue || issue.length > 80 || !severity || !rainfall || rainfall.length > 60 || !details || details.length > 1200) {
    await telegram("sendMessage", { chat_id: chatId, text: "Some report details are missing or too long. Please check the format and severity (Low, Moderate, High or Unspecified), then try /report again." });
    return;
  }
  await db("observations", "POST", {
    country: String(profile.country).slice(0, 80),
    crop,
    sub_county: district,
    issue_type: issue,
    severity,
    rainfall_observed: rainfall,
    comments: details,
    observation_consent_at: new Date().toISOString()
  }, "return=minimal");
  await telegram("sendMessage", { chat_id: chatId, text: "Thank you. Your field observation has been submitted to FARMCAST EA for review. You can send another report whenever needed." });
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
      const chat = cb.message && cb.message.chat;
      const chatId = chat && chat.id;
      const userId = cb.from && cb.from.id;
      if (!chatId || !userId || chat.type !== "private") {
        await telegram("answerCallbackQuery", { callback_query_id: cb.id, text: "Please subscribe in a private chat with FARMCAST EA." });
        return json(res, 200, { ok: true });
      }
      if (cb.data === "farmcast_consent_yes" || cb.data === "farmcast_consent_no") {
        const nextStatus = cb.data === "farmcast_consent_yes" ? "active" : "unsubscribed";
        const changed = await setStatus(chatId, userId, nextStatus);
        if (!changed) {
          await telegram("answerCallbackQuery", { callback_query_id: cb.id, text: "This consent request is no longer active.", show_alert: true });
          return json(res, 200, { ok: true });
        }
        if (nextStatus === "active") {
          await telegram("answerCallbackQuery", { callback_query_id: cb.id, text: "Subscription confirmed." });
          await telegram("sendMessage", { chat_id: chatId, text: "You are subscribed to FARMCAST EA Telegram updates. Use /stop at any time to unsubscribe. Set your preferences with /country Uganda and /crop maize." });
        } else {
          await telegram("answerCallbackQuery", { callback_query_id: cb.id, text: "No subscription was created." });
          await telegram("sendMessage", { chat_id: chatId, text: "No problem. You will not receive FARMCAST EA Telegram broadcasts. You can use /start if you change your mind." });
        }
      }
      return json(res, 200, { ok: true });
    }
    const message = update.message;
    if (!message || !message.chat || !message.from || typeof message.text !== "string") return json(res, 200, { ok: true });
    if (message.chat.type !== "private") return json(res, 200, { ok: true });
    const chatId = message.chat.id, userId = message.from.id, text = message.text.trim();
    const parsed = text.match(/^\/([a-z]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
    if (!parsed) return json(res, 200, { ok: true });
    const command = parsed[1].toLowerCase();
    const args = (parsed[2] || "").trim();
    const profile = await getSubscription(chatId, userId);

    if (command === "start") {
      if (profile && profile.status === "active") {
        await telegram("sendMessage", { chat_id: chatId, text: "You are already subscribed. Use /stop at any time to unsubscribe. Use /help to see farmer tools." });
      } else {
        await upsertPending(message.chat, message.from);
        await sendConsent(chatId);
      }
    } else if (command === "stop") {
      await setStatus(chatId, userId, "unsubscribed");
      await telegram("sendMessage", { chat_id: chatId, text: "You have unsubscribed from FARMCAST EA Telegram updates. Use /start if you want to subscribe again." });
    } else if (command === "country") {
      if (!args || args.length > 80) await telegram("sendMessage", { chat_id: chatId, text: "Send your country like this: /country Uganda" });
      else {
        if (!profile) await upsertPending(message.chat, message.from);
        await db("telegram_subscriptions?chat_id=eq." + enc(String(chatId)) + "&telegram_user_id=eq." + enc(String(userId)), "PATCH", { country: args, updated_at: new Date().toISOString() }, "return=minimal");
        await telegram("sendMessage", { chat_id: chatId, text: "Country preference saved: " + args + ". Use /weather Wakiso or /forecast Wakiso to check local conditions." });
      }
    } else if (command === "crop") {
      if (!args || args.length > 60) await telegram("sendMessage", { chat_id: chatId, text: "Send your main crop like this: /crop maize" });
      else {
        if (!profile) await upsertPending(message.chat, message.from);
        await db("telegram_subscriptions?chat_id=eq." + enc(String(chatId)) + "&telegram_user_id=eq." + enc(String(userId)), "PATCH", { crop: args, updated_at: new Date().toISOString() }, "return=minimal");
        await telegram("sendMessage", { chat_id: chatId, text: "Crop preference saved: " + args + ". Use /advice for crop guidance." });
      }
    } else if (command === "weather" || command === "forecast") {
      await sendWeather(chatId, args, profile && profile.country, command === "forecast");
    } else if (command === "ask" || command === "advice") {
      await askFarmcast(chatId, args, profile, command);
    } else if (command === "report") {
      await submitFieldReport(chatId, text, profile);
    } else if (command === "alerts") {
      if (args.toLowerCase() === "off") {
        await setStatus(chatId, userId, "unsubscribed");
        await telegram("sendMessage", { chat_id: chatId, text: "Telegram alerts are now off. You can turn them on again with /alerts on and confirm consent." });
      } else if (args.toLowerCase() === "on") {
        if (profile && profile.status === "active") {
          await telegram("sendMessage", { chat_id: chatId, text: "Your Telegram alerts are already on. Use /alerts off to stop them." });
        } else {
          await upsertPending(message.chat, message.from);
          await sendConsent(chatId);
        }
      } else {
        const current = profile && profile.status === "active" ? "ON" : "OFF";
        await telegram("sendMessage", { chat_id: chatId, text: "Your Telegram broadcast subscription is " + current + ". Use /alerts on to request consent, or /alerts off to unsubscribe. Weather and AI commands can still be used separately." });
      }
    } else if (command === "about") {
      await telegram("sendMessage", { chat_id: chatId, text: "FARMCAST EA is an AI-enabled climate and agricultural support initiative for East Africa. It helps farmers access weather information, forecasts and practical farming guidance. Weather data is supplied by Open-Meteo; AI responses are informational and should be checked with qualified local extension officers when decisions are urgent." });
    } else if (command === "help") {
      await telegram("sendMessage", { chat_id: chatId, text: "🌱 FARMCAST EA farmer commands:\n/start — request Telegram alert subscription\n/stop — unsubscribe from Telegram broadcasts\n/alerts — check alert subscription status\n/alerts on — request subscription consent\n/alerts off — unsubscribe\n/weather Wakiso — current weather\n/forecast Wakiso — 5-day forecast\n/advice — crop advice based on your saved crop\n/advice [question] — ask for practical advice\n/ask [question] — ask the AI farming assistant\n/report — submit a field observation (format instructions will follow)\n/country Uganda — save your country\n/crop maize — save your main crop\n/about — learn about FARMCAST EA\n/help — show this list" });
    }
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error("FARMCAST EA Telegram webhook:", error.message);
    return json(res, 500, { error: "Webhook processing failed; Telegram may retry this update." });
  }
}
