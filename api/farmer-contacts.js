// Private FARMCAST EA farmer-contact administration API.
// Server-only Vercel environment variables:
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY,
// FARMCAST_ADMIN_EMAILS (comma-separated exact email allowlist).
const json = (res, status, body) => res.status(status).json(body);
const env = (name) => (process.env[name] || "").trim();
const base = () => env("SUPABASE_URL").replace(/\/$/, "");
function backendKey() {
  return env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
}
async function db(path, method = "GET", body, prefer = "") {
  const key = backendKey();
  const headers = {
    apikey: key,
    "Content-Type": "application/json",
    ...(key.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + key }),
    ...(prefer ? { Prefer: prefer } : {})
  };
  const response = await fetch(base() + "/rest/v1/" + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; }
  catch { data = { message: "Database returned an unreadable response." }; }
  if (!response.ok) throw new Error((data && data.message) || "Database request failed.");
  return data;
}
async function requireAdmin(req) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token || !env("SUPABASE_URL") || !env("SUPABASE_ANON_KEY") || !backendKey()) return null;
  const response = await fetch(base() + "/auth/v1/user", {
    headers: { apikey: env("SUPABASE_ANON_KEY"), Authorization: "Bearer " + token }
  });
  if (!response.ok) return null;
  const user = await response.json();
  const allowlist = env("FARMCAST_ADMIN_EMAILS").split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
  if (!user.email || user.email_confirmed_at == null || !allowlist.includes(user.email.toLowerCase())) return null;
  return user;
}
function normalizePhone(value) {
  const phone = String(value || "").replace(/[\s()-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : "";
}
function bool(value) {
  return value === true || ["true", "1", "yes"].includes(String(value).trim().toLowerCase());
}
function eligibleQuery() {
  return new URLSearchParams({
    select: "id,farmer_code,full_name,phone_number,sub_county,crop,preferred_language,registration_consent_at,created_at",
    whatsapp_consent: "eq.true",
    order: "created_at.asc",
    limit: "1000"
  }).toString();
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { error: "Method not allowed." });
  }
  const admin = await requireAdmin(req);
  if (!admin) return json(res, 401, { error: "Sign in with an approved FARMCAST EA administrator account." });
  try {
    if (req.method === "GET") {
      const farmers = await db("farmers?" + eligibleQuery());
      return json(res, 200, { farmers });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (body.action === "import") {
      if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 500) {
        return json(res, 400, { error: "Upload between 1 and 500 farmer rows at a time." });
      }
      const candidates = [], rejected = [], seen = new Set();
      for (let i = 0; i < body.rows.length; i++) {
        const row = body.rows[i] || {};
        const name = String(row.full_name || row.name || "").trim();
        const phone = normalizePhone(row.whatsapp_number || row.phone_number);
        const location = String(row.sub_county || row.location || "").trim();
        const crop = String(row.crop || "").trim();
        const language = String(row.preferred_language || row.language || "English").trim();
        const consentAt = String(row.consent_recorded_at || "").trim();
        const consentDate = Date.parse(consentAt);
        const consentValid = Number.isFinite(consentDate) && consentDate <= Date.now() + 5 * 60 * 1000;
        if (name.length < 2 || name.length > 100 || !phone ||
            location.length < 2 || location.length > 160 ||
            crop.length < 2 || crop.length > 60 ||
            !["English", "Luganda", "Kiswahili"].includes(language) ||
            !bool(row.data_consent) || !bool(row.whatsapp_consent) || !consentValid) {
          rejected.push({ row: i + 2, reason: "Missing or invalid details, both consent choices, or a valid consent date." });
          continue;
        }
        if (seen.has(phone)) {
          rejected.push({ row: i + 2, reason: "Duplicate WhatsApp number in this upload." });
          continue;
        }
        seen.add(phone);
        candidates.push({
          row: i + 2,
          phone,
          farmer: {
            farmer_code: "FEA-IMP-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
            full_name: name,
            sub_county: location,
            crop,
            phone_number: phone,
            preferred_language: language,
            whatsapp_consent: true,
            registration_consent_at: new Date(consentDate).toISOString()
          }
        });
      }
      if (!candidates.length) return json(res, 200, { imported: 0, rejected });
      const query = new URLSearchParams({
        select: "phone_number",
        phone_number: "in.(" + candidates.map(x => x.phone).join(",") + ")"
      });
      const existing = await db("farmers?" + query.toString());
      const existingPhones = new Set(existing.map(x => x.phone_number));
      const fresh = candidates.filter(x => {
        if (!existingPhones.has(x.phone)) return true;
        rejected.push({ row: x.row, reason: "This WhatsApp number is already registered." });
        return false;
      });
      if (fresh.length) {
        await db("farmers", "POST", fresh.map(x => x.farmer), "return=minimal");
      }
      return json(res, 200, { imported: fresh.length, rejected });
    }
    if (body.action === "opt_out") {
      const farmerId = String(body.farmer_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(farmerId)) return json(res, 400, { error: "Invalid farmer record." });
      const rows = await db(
        "farmers?id=eq." + encodeURIComponent(farmerId) + "&select=id",
        "PATCH",
        { whatsapp_consent: false },
        "return=representation"
      );
      if (!rows || !rows.length) return json(res, 404, { error: "Farmer record not found." });
      return json(res, 200, { opted_out: true });
    }
    return json(res, 400, { error: "Unknown action." });
  } catch (error) {
    console.error("FARMCAST EA farmer contacts API error:", error.message);
    return json(res, 500, { error: "The request could not be completed. Check server configuration and logs." });
  }
}