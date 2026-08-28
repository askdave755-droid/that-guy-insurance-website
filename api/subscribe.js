// Vercel serverless function: POST /api/subscribe
// 1) Adds contact to Brevo "Website Quote Leads" list
// 2) Fires a lead into InsureFlowAI (triggers Vapi AI call within ~60s)
// Env vars (Vercel): BREVO_API_KEY, BREVO_LIST_ID, INSUREFLOW_URL,
//                    INSUREFLOW_ADMIN_KEY, WEBSITE_ORIGIN (optional)
// NOTE: never log secret values (API keys, admin key) anywhere in this file.

// --- Best-effort in-memory IP rate limiting ---
// NOTE: This is a per-serverless-instance in-memory limiter only. Vercel may
// run many concurrent instances and cold-start them at any time, so this is
// NOT sufficient for production-scale abuse prevention. It only reduces
// casual/repeated abuse from a single instance's perspective. A shared store
// (e.g. Upstash Redis) or Vercel WAF rate limiting is required for real
// protection.
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX = 5; // max submissions per IP per window
const rateLimitHits = new Map(); // ip -> array of timestamps (ms)

function isRateLimited(ip) {
    const now = Date.now();
    const hits = (rateLimitHits.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (hits.length >= RATE_LIMIT_MAX) {
        rateLimitHits.set(ip, hits);
        return true;
    }
    hits.push(now);
    rateLimitHits.set(ip, hits);
    // Occasional cleanup so the map does not grow unbounded on a warm instance.
    if (rateLimitHits.size > 5000) {
        for (const [k, v] of rateLimitHits) {
            const fresh = v.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
            if (fresh.length === 0) rateLimitHits.delete(k);
            else rateLimitHits.set(k, fresh);
        }
    }
    return false;
}

function getClientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
    return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Insurance types accepted from the frontend. The current form has no
// insurance-type selection field, so absent/invalid values fall back to
// 'commercial_auto' (the site's primary audience). See PR notes for the
// limitation this creates for non-trucking leads.
const ALLOWED_INSURANCE_TYPES = new Set([
    'commercial_auto',
    'general_liability',
    'commercial_property',
    'workers_comp',
    'personal_auto',
    'other'
]);
const DEFAULT_INSURANCE_TYPE = 'commercial_auto';

function sanitizeInsuranceType(value) {
    if (typeof value !== 'string') return DEFAULT_INSURANCE_TYPE;
    const v = value.trim().toLowerCase();
    return ALLOWED_INSURANCE_TYPES.has(v) ? v : DEFAULT_INSURANCE_TYPE;
}

export default async function handler(req, res) {
    // CORS: restrict to the known site origin when WEBSITE_ORIGIN is set.
    // Fallback retains the previous permissive '*' behavior so the site keeps
    // working before WEBSITE_ORIGIN is configured.
    // WARNING: with '*' this endpoint is callable from any browser origin.
    // Set WEBSITE_ORIGIN (e.g. https://nexusgpartners.vercel.app) in Vercel.
    const allowedOrigin = process.env.WEBSITE_ORIGIN;
    if (!allowedOrigin) {
        console.warn('WEBSITE_ORIGIN not set; falling back to permissive CORS (*)');
    }
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin || '*');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const apiKey = process.env.BREVO_API_KEY;
    const listId = parseInt(process.env.BREVO_LIST_ID || '5', 10);
    const insureflowUrl = process.env.INSUREFLOW_URL || 'https://insureflow-ai2-production.up.railway.app';

    if (!apiKey) {
        console.error('BREVO_API_KEY is not configured');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        const { firstName, lastName, phone, state, consentCare, consentMarketing, insuranceType, company } = req.body || {};

        // Honeypot: 'company' is a hidden field that humans never fill.
        // Silently accept (fake success) so bots learn nothing, but do no work.
        if (typeof company === 'string' && company.trim() !== '') {
            console.warn('Honeypot filled; rejecting submission from IP:', getClientIp(req));
            return res.status(200).json({ success: true });
        }

        // Best-effort per-instance IP rate limit (see note above).
        if (isRateLimited(getClientIp(req))) {
            console.warn('Rate limit exceeded for IP:', getClientIp(req));
            return res.status(429).json({ error: 'Too many requests. Please try again later.' });
        }

        // Customer-care/transactional consent is REQUIRED before we create a
        // Brevo contact or trigger an InsureFlowAI lead/call. Marketing consent
        // stays separate and optional; it is only persisted as an attribute.
        if (!firstName || !phone || !state || consentCare !== true) {
            return res.status(400).json({ error: 'Missing or invalid required fields' });
        }
        const marketingConsent = consentMarketing === true;
        const consentAt = new Date().toISOString();
        const consentSource = 'website_form';

        // E.164 normalize (US default)
        let digits = String(phone).replace(/\D/g, '');
        if (digits.length === 10) digits = '1' + digits;
        if (digits.length < 11 || digits.length > 15) {
            return res.status(400).json({ error: 'Invalid phone number' });
        }
        const sms = '+' + digits;
        const fullName = `${firstName} ${lastName || ''}`.trim();
        const stateUp = String(state).toUpperCase().slice(0, 2);
        const leadInsuranceType = sanitizeInsuranceType(insuranceType);

        // --- Step 1: Brevo contact ---
        const brevoPayload = {
            attributes: {
                FIRSTNAME: String(firstName).slice(0, 100),
                LASTNAME: String(lastName || '').slice(0, 100),
                SMS: sms,
                STATE: stateUp,
                OPT_IN_SOURCE: consentSource,
                OPT_IN_DATE: consentAt,
                CONSENT_CARE: true,
                CONSENT_MARKETING: marketingConsent,
                CONSENT_SOURCE: consentSource,
                CONSENT_AT: consentAt
            },
            listIds: [listId],
            updateEnabled: true,
            email: `sms_${digits}@sms.nexusgpartners.com`
        };

        const brevoResp = await fetch('https://api.brevo.com/v3/contacts', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json',
                'api-key': apiKey
            },
            body: JSON.stringify(brevoPayload)
        });

        const brevoErr = await brevoResp.json().catch(() => ({}));
        const brevoOk = brevoResp.ok || brevoResp.status === 201
            || brevoResp.status === 204 || brevoErr.code === 'duplicate_parameter';

        if (!brevoOk) {
            // Detailed error stays server-side; client gets a generic message.
            console.error('Brevo error:', brevoErr);
            return res.status(502).json({ error: 'Unable to process signup' });
        }

        // --- Step 2: Fire lead into InsureFlowAI (triggers Vapi call) ---
        // Fire-and-forget: never block or fail the signup if InsureFlow is down.
        // InsureFlow /api/leads requires: name, phone, state (2-letter).
        // InsureFlow backend PR #9 protects POST /api/leads with X-Admin-Key.
        const insureflowAdminKey = process.env.INSUREFLOW_ADMIN_KEY;
        if (!insureflowAdminKey) {
            // Fail safely: without the admin key the backend call would be
            // rejected (401). Do not attempt it; do not fail the signup.
            // Never log the key value itself.
            console.error('INSUREFLOW_ADMIN_KEY is not configured; skipping InsureFlowAI lead submission');
        } else {
            const leadPayload = {
                name: fullName,
                phone: sms,
                state: stateUp,
                insuranceType: leadInsuranceType,
                source: 'nexusgpartners_website'
            };

            fetch(`${insureflowUrl}/api/leads`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Key': insureflowAdminKey
                },
                body: JSON.stringify(leadPayload)
            })
            .then(r => console.log('InsureFlow lead fired:', r.status))
            .catch(e => console.error('InsureFlow fire failed:', e.message));
        }

        return res.status(200).json({ success: true, updated: brevoErr.code === 'duplicate_parameter' });
    } catch (e) {
        // Detailed error server-side only; generic message to the browser.
        console.error('Subscribe error:', e);
        return res.status(500).json({ error: 'Internal error' });
    }
}
