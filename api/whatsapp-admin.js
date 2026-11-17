// Private FARMCAST EA WhatsApp administration API.
// Required Vercel environment variables:
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY,
// FARMCAST_ADMIN_EMAILS (comma-separated exact email allowlist),
// WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_API_VERSION.
const json = (res, status, body) => res.status(status).json(body);
const env = (name) => (process.env[name] || "").trim();
const base = () => env("SUPABASE_URL").replace(/\/$/, "");
function backendKey() { return env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY"); }
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
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { message: "Database returned an unreadable response." }; }
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
function bool(value) { return value === true || String(value).trim().toLowerCase() === "true" || String(value).trim() === "1" || String(value).trim().toLowerCase() === "yes"; }
function filterQuery(filters = {}) {
  const q = new URLSearchParams();
  q.set("select", "id,farmer_code,full_name,phone_number,sub_county,crop,preferred_language");
  q.set("whatsapp_consent", "eq.true");
  q.set("whatsapp_opted_out_at", "is.null");
  if (filters.sub_county) q.set("sub_county", "eq." + filters.sub_county);
  if (filters.crop) q.set("crop", "eq." + filters.crop);
  if (filters.language) q.set("preferred_language", "eq." + filters.language);
  q.set("order", "created_at.asc");
  q.set("limit", "500");
  return q.toString();
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { error: "Method not allowed." });
  }
  const admin = await requireAdmin(req);
  if (!admin) return json(res, 401, { error: "Sign in with an approved FARMCAST EA administrator account." });
  try {
    if (req.method === "GET") {
      const farmers = await db("farmers?" + filterQuery());
      const broadcasts = await db("whatsapp_broadcasts?select=id,title,template_name,language_code,status,total_recipients,accepted_count,failed_count,created_at,completed_at&order=created_at.desc&limit=30");
      return json(res, 200, { farmers, broadcasts });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (body.action === "import") {
      if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 500) return json(res, 400, { error: "Upload between 1 and 500 farmer rows at a time." });
      const candidates = [], rejected = [], seen = new Set();
      for (let i = 0; i < body.rows.length; i++) {
        const row = body.rows[i] || {};
        const name = String(row.full_name || row.name || "").trim();
        const phone = normalizePhone(row.whatsapp_number || row.phone_number);
        const location = String(row.sub_county || row.location || "").trim();
        const crop = String(row.crop || "").trim();
        const language = String(row.preferred_language || row.language || "English").trim();
        const consentAt = String(row.consent_recorded_at || "").trim();
        if (name.length < 2 || name.length > 100 || !phone || location.length < 2 || location.length > 160 || crop.length < 2 || crop.length > 60 || !["English","Luganda","Kiswahili"].includes(language) || !bool(row.data_consent) || !bool(row.whatsapp_consent) || !consentAt || Number.isNaN(Date.parse(consentAt))) {
          rejected.push({ row: i + 2, reason: "Missing or invalid details, data consent, WhatsApp opt-in, or consent date." }); continue;
        }
        if (seen.has(phone)) { rejected.push({ row: i + 2, reason: "Duplicate WhatsApp number in this upload." }); continue; }
        seen.add(phone);
        candidates.push({ row: i + 2, phone, farmer: {
          farmer_code: "FEA-IMP-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
          full_name: name, sub_county: location, crop, phone_number: phone,
          preferred_language: language, whatsapp_consent: true,
          registration_consent_at: new Date(consentAt).toISOString()
        }});
      }
      if (candidates.length) {
        const query = new URLSearchParams({ select: "phone_number", phone_number: "in.(" + candidates.map(x => '"' + x.phone + '"').join(",") + ")" });
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
      return json(res, 200, { imported: 0, rejected });
    }
    if (body.action === "opt_out") {
      const farmerId = String(body.farmer_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(farmerId)) return json(res, 400, { error: "Invalid farmer record." });
      await db("farmers?id=eq." + farmerId, "PATCH", {
        whatsapp_consent: false, whatsapp_opted_out_at: new Date().toISOString()
      }, "return=minimal");
      return json(res, 200, { opted_out: true });
    }
    if (body.action === "create_broadcast") {
      const title = String(body.title || "").trim();
      const template = String(body.template_name || "").trim();
      const language = String(body.language_code || "").trim();
      const filters = body.filters && typeof body.filters === "object" ? body.filters : {};
      const parameter = String(body.template_parameter || "").trim().slice(0, 900);
      if (!title || title.length > 120 || !/^[a-z0-9_]{2,120}$/.test(template) || !/^[a-z]{2}_[A-Z]{2}$/.test(language)) return json(res, 400, { error: "Enter a title, approved template name and valid template language code (for example en_US)." });
      const recipients = await db("farmers?" + filterQuery(filters));
      if (!recipients.length) return json(res, 400, { error: "No opted-in farmers match these filters." });
      const rows = await db("whatsapp_broadcasts", "POST", {
        created_by: admin.id, title, template_name: template, language_code: language,
        template_parameter: parameter || null, filters,
        status: "draft", total_recipients: recipients.length
      }, "return=representation");
      return json(res, 200, { broadcast: rows[0], recipient_count: recipients.length });
    }
    if (body.action === "send_batch") {
      const id = String(body.broadcast_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json(res, 400, { error: "Invalid broadcast ID." });
      if (!env("WHATSAPP_ACCESS_TOKEN") || !env("WHATSAPP_PHONE_NUMBER_ID") || !/^v\d+\.\d+$/.test(env("WHATSAPP_API_VERSION"))) return json(res, 503, { error: "WhatsApp Cloud API is not configured. Add the required WhatsApp credentials in Vercel first." });
      const records = await db("whatsapp_broadcasts?id=eq." + id + "&select=*&limit=1");
      const broadcast = records[0];
      if (!broadcast) return json(res, 404, { error: "Broadcast not found." });
      if (broadcast.status === "completed" || broadcast.status === "failed") return json(res, 409, { error: "This broadcast is already finished." });
      const eligible = await db("farmers?" + filterQuery(broadcast.filters));
      const done = await db("whatsapp_message_events?broadcast_id=eq." + id + "&select=farmer_id");
      const doneIds = new Set(done.map(item => item.farmer_id));
      const batch = eligible.filter(f => !doneIds.has(f.id)).slice(0, 10);
      if (!batch.length) {
        await db("whatsapp_broadcasts?id=eq." + id, "PATCH", { status: "completed", completed_at: new Date().toISOString() }, "return=minimal");
        return json(res, 200, { completed: true, sent_this_batch: 0 });
      }
      const results = await Promise.all(batch.map(async farmer => {
        let messageId = null, status = "failed", errorCode = null;
        try {
          const template = { name: broadcast.template_name, language: { code: broadcast.language_code } };
          if (broadcast.template_parameter) template.components = [{ type: "body", parameters: [{ type: "text", text: broadcast.template_parameter }] }];
          const response = await fetch("https://graph.facebook.com/" + env("WHATSAPP_API_VERSION") + "/" + env("WHATSAPP_PHONE_NUMBER_ID") + "/messages", {
            method: "POST",
            headers: { Authorization: "Bearer " + env("WHATSAPP_ACCESS_TOKEN"), "Content-Type": "application/json" },
            body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: farmer.phone_number.replace("+", ""), type: "template", template })
          });
          const result = await response.json();
          if (!response.ok) errorCode = String(result.error?.code || response.status);
          else { status = "accepted"; messageId = result.messages?.[0]?.id || null; }
        } catch (_) { errorCode = "NETWORK_ERROR"; }
        return { broadcast_id: id, farmer_id: farmer.id, meta_message_id: messageId, status, error_code: errorCode };
      }));
      await db("whatsapp_message_events", "POST", results, "return=minimal");
      const totals = await db("whatsapp_message_events?broadcast_id=eq." + id + "&select=status");
      const acceptedTotal = totals.filter(x => x.status === "accepted" || x.status === "delivered" || x.status === "read").length;
      const failedTotal = totals.filter(x => x.status === "failed").length;
      const complete = totals.length >= broadcast.total_recipients;
      await db("whatsapp_broadcasts?id=eq." + id, "PATCH", {
        status: complete ? "completed" : "sending", accepted_count: acceptedTotal,
        failed_count: failedTotal, completed_at: complete ? new Date().toISOString() : null
      }, "return=minimal");
      return json(res, 200, { sent_this_batch: results.filter(x => x.status === "accepted").length, failed_this_batch: results.filter(x => x.status === "failed").length, processed: totals.length, total: broadcast.total_recipients, completed: complete });
    }
    return json(res, 400, { error: "Unknown action." });
  } catch (error) {
    console.error("FARMCAST WhatsApp admin API error:", error.message);
    return json(res, 500, { error: "The request could not be completed. Check server configuration and logs." });
  }
}
