// Vercel serverless function: POST /api/subscribe
// Adds a contact to the Brevo "Website Quote Leads" list.
// BREVO_API_KEY is stored as a Vercel environment variable (never in the repo).

export default async function handler(req, res) {
    // CORS — allow the site's own origin
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const apiKey = process.env.BREVO_API_KEY;
    const listId = parseInt(process.env.BREVO_LIST_ID || '5', 10);

    if (!apiKey) return res.status(500).json({ error: 'Server not configured' });

    try {
        const { firstName, lastName, phone, consent } = req.body || {};

        if (!firstName || !phone || consent !== true) {
            return res.status(400).json({ error: 'First name, phone, and consent are required' });
        }

        // E.164 normalize (US default)
        let digits = String(phone).replace(/\D/g, '');
        if (digits.length === 10) digits = '1' + digits;
        if (digits.length < 11 || digits.length > 15) {
            return res.status(400).json({ error: 'Invalid phone number' });
        }
        const sms = '+' + digits;

        const payload = {
            attributes: {
                FIRSTNAME: String(firstName).slice(0, 100),
                LASTNAME: String(lastName || '').slice(0, 100),
                SMS: sms,
                OPT_IN_SOURCE: 'website_form',
                OPT_IN_DATE: new Date().toISOString()
            },
            listIds: [listId],
            updateEnabled: true,
            email: `sms_${digits}@sms.nexusgpartners.com`
        };

        const resp = await fetch('https://api.brevo.com/v3/contacts', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json',
                'api-key': apiKey
            },
            body: JSON.stringify(payload)
        });

        if (resp.ok || resp.status === 201 || resp.status === 204) {
            return res.status(200).json({ success: true });
        }

        const err = await resp.json().catch(() => ({}));
        if (err.code === 'duplicate_parameter') {
            return res.status(200).json({ success: true, updated: true });
        }

        console.error('Brevo error:', err);
        return res.status(502).json({ error: 'Brevo rejected the signup' });
    } catch (e) {
        console.error('Subscribe error:', e);
        return res.status(500).json({ error: 'Internal error' });
    }
}
