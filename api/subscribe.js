// Vercel serverless function: POST /api/subscribe
// 1) Adds contact to Brevo "Website Quote Leads" list
// 2) Fires a lead into InsureFlowAI (triggers Vapi AI call within ~60s)
// Env vars (Vercel): BREVO_API_KEY, BREVO_LIST_ID, INSUREFLOW_URL

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const apiKey = process.env.BREVO_API_KEY;
    const listId = parseInt(process.env.BREVO_LIST_ID || '5', 10);
    const insureflowUrl = process.env.INSUREFLOW_URL || 'https://insureflow-ai2-production.up.railway.app';

    if (!apiKey) return res.status(500).json({ error: 'Server not configured' });

    try {
        const { firstName, lastName, phone, state, consent } = req.body || {};

        if (!firstName || !phone || !state || consent !== true) {
            return res.status(400).json({ error: 'First name, phone, state, and consent are required' });
        }

        // E.164 normalize (US default)
        let digits = String(phone).replace(/\D/g, '');
        if (digits.length === 10) digits = '1' + digits;
        if (digits.length < 11 || digits.length > 15) {
            return res.status(400).json({ error: 'Invalid phone number' });
        }
        const sms = '+' + digits;
        const fullName = `${firstName} ${lastName || ''}`.trim();
        const stateUp = String(state).toUpperCase().slice(0, 2);

        // --- Step 1: Brevo contact ---
        const brevoPayload = {
            attributes: {
                FIRSTNAME: String(firstName).slice(0, 100),
                LASTNAME: String(lastName || '').slice(0, 100),
                SMS: sms,
                STATE: stateUp,
                OPT_IN_SOURCE: 'website_form',
                OPT_IN_DATE: new Date().toISOString()
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
            console.error('Brevo error:', brevoErr);
            return res.status(502).json({ error: 'Brevo rejected the signup' });
        }

        // --- Step 2: Fire lead into InsureFlowAI (triggers Vapi call) ---
        // Fire-and-forget: never block or fail the signup if InsureFlow is down.
        // InsureFlow /api/leads requires: name, phone, state (2-letter).
        const leadPayload = {
            name: fullName,
            phone: sms,
            state: stateUp,
            insuranceType: 'commercial_auto',
            source: 'nexusgpartners_website'
        };

        fetch(`${insureflowUrl}/api/leads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(leadPayload)
        })
        .then(r => console.log('InsureFlow lead fired:', r.status))
        .catch(e => console.error('InsureFlow fire failed:', e.message));

        return res.status(200).json({ success: true, updated: brevoErr.code === 'duplicate_parameter' });
    } catch (e) {
        console.error('Subscribe error:', e);
        return res.status(500).json({ error: 'Internal error' });
    }
}
