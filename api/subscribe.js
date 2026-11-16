// POST /api/subscribe
// Saves a Nexus G Partners HVAC ad-audit request to Brevo.
//
// This file is a Vercel serverless function. Railway serves the repo as static
// files (railway-hikari) and does not execute it — /api/subscribe is 404 there.
// The audit form falls back to a mailto draft for dave@nexusgpartners.net.
//
// Env (Vercel): BREVO_API_KEY, BREVO_LIST_ID
// The phone number is written to Brevo's SMS attribute only when the person
// checked the SMS consent box. This function does not call InsureFlow and does
// not place a phone call.

var JOBS = ["AC repair", "System installs", "Maintenance plans"];
var ADS = ["yes", "no", "not sure"];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  var apiKey = process.env.BREVO_API_KEY;
  var listId = parseInt(process.env.BREVO_LIST_ID || "5", 10);
  if (!listId) listId = 5;
  if (!apiKey) return res.status(500).json({ error: "Server not configured" });

  try {
    var body = req.body || {};
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (err) { body = {}; }
    }

    if (body.contact_fax || body.website) {
      return res.status(200).json({ success: true });
    }

    var firstName = clean(body.firstName, 80);
    var lastName = clean(body.lastName, 80);
    var shop = clean(body.shop, 120);
    var city = clean(body.city, 80);
    var email = clean(body.email, 120);
    var state = clean(body.state, 2).toUpperCase();
    var notes = clean(body.notes, 2000);
    var consent = body.consent === true || body.consent === "true" || body.consent === "yes";
    var sms = normalizeSms(body.phone);
    var jobs = []
      .concat(body.jobs || [])
      .map(function (job) { return String(job); })
      .filter(function (job) { return JOBS.indexOf(job) !== -1; });
    var adsNow = ADS.indexOf(body.adsNow) !== -1 ? body.adsNow : "";

    if (!firstName || !lastName || !shop || !city || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Name, shop, city, and a valid email are required." });
    }
    if (!/^[A-Z]{2}$/.test(state)) {
      return res.status(400).json({ error: "Choose a state." });
    }
    if (!sms) {
      return res.status(400).json({ error: "Enter a valid mobile number." });
    }

    var stamp = new Date().toISOString();
    var source = consent ? "website_ad_audit_sms" : "website_ad_audit";
    var detail = [
      "Shop: " + shop,
      "City: " + city,
      "Callback: " + sms,
      "Jobs: " + (jobs.join(", ") || "unspecified"),
      "Ads now: " + (adsNow || "unspecified"),
      "SMS consent: " + (consent ? "yes" : "no"),
      "Notes: " + (notes || "none")
    ].join(" | ").slice(0, 2000);

    var rich = {
      FIRSTNAME: firstName,
      LASTNAME: lastName,
      STATE: state,
      OPT_IN_SOURCE: source,
      OPT_IN_DATE: stamp,
      COMPANY: shop,
      CITY: city,
      PHONE: sms,
      JOBS: jobs.join(", "),
      ADS_NOW: adsNow,
      MESSAGE: detail
    };
    if (consent) rich.SMS = sms;

    var saved = await saveContact(apiKey, listId, email, rich);
    if (!saved.ok) {
      var minimal = {
        FIRSTNAME: firstName,
        LASTNAME: [lastName, shop, city, sms].join(" · ").slice(0, 200),
        STATE: state,
        OPT_IN_SOURCE: source,
        OPT_IN_DATE: stamp
      };
      if (consent) minimal.SMS = sms;
      saved = await saveContact(apiKey, listId, email, minimal);
      if (!saved.ok) {
        console.error("Brevo error:", saved.error);
        return res.status(502).json({ error: "Could not save the request." });
      }
      console.log("Brevo saved with the basic contact fields.");
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Subscribe error:", err && err.message ? err.message : err);
    return res.status(500).json({ error: "Internal error" });
  }
}

function clean(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeSms(phone) {
  var d = String(phone || "").replace(/\D/g, "");
  if (d.length === 10) d = "1" + d;
  if (d.length === 11 && d.charAt(0) === "1") return "+" + d;
  return null;
}

async function saveContact(apiKey, listId, email, attributes) {
  Object.keys(attributes).forEach(function (key) {
    if (attributes[key] === "") delete attributes[key];
  });
  var response = await fetch("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": apiKey
    },
    body: JSON.stringify({
      email: email,
      attributes: attributes,
      listIds: [listId],
      updateEnabled: true
    })
  });
  var payload = await response.json().catch(function () { return {}; });
  var ok = response.ok || response.status === 204 || payload.code === "duplicate_parameter";
  return { ok: ok, error: payload };
}
