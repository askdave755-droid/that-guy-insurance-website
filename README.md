# Nexus G Partners

Website for Nexus G Partners, a done-for-you Meta (Facebook and Instagram) ads agency for owner-run HVAC companies, focused on Phoenix and Arizona.

Contact: (220) 208-0593 · dave@nexusgpartners.net

Live Railway app: https://davidhughes.up.railway.app/
Public domain: https://www.nexusgpartners.net/

## What this repo is

Static HTML, CSS, and one JavaScript file. Railway serves the files as a static site (`railway-hikari`). There is no `package.json` on purpose: adding one can make Railway treat the app as a Node service and stop serving the pages.

`api/subscribe.js` is a Vercel serverless function. It still runs on the Vercel project. Railway returns 404 for `/api/subscribe` and does not execute the file. The audit form posts there first and, if that fails, opens an email draft to dave@nexusgpartners.net with the same details.

## Pages

- `/` — agency site
- `/quote` — free HVAC ad audit (same form). The old insurance quote form lived here.
- `/privacy-policy.html` and `/sms-terms.html` — kept at these URLs for SMS / 10DLC
- `BingSiteAuth.xml`, `6f1e034af71e396e709fa7e5d36a2b92.html` — verification files, left unchanged
- `robots.txt`, `sitemap.xml`

The old insurance niche pages under `/niches/` were removed. Those URLs will 404.

## What `api/` and `quote/` used to do

`quote/index.html` was a commercial insurance quote form. It posted leads to InsureFlow, which triggered an automated insurance sales call. The homepage also embedded that chat widget.

`api/subscribe.js` added the person to a Brevo list and fired the same InsureFlow insurance lead.

Both are now the free ad audit. The function saves the contact in Brevo and does not call InsureFlow. The mobile number is stored on Brevo's SMS attribute only when the SMS checkbox is checked. If Brevo rejects extra fields (`COMPANY`, `CITY`, `JOBS`, `ADS_NOW`, `MESSAGE`, `PHONE`), the function retries with the attributes this list already accepted and packs the shop, city, and callback number into the last-name field so the lead is not dropped.

`BREVO_API_KEY` and `BREVO_LIST_ID` (default `5`, previously the "Website Quote Leads" list) are unchanged. Rename that list in Brevo when you can. Confirm no automation on the list sends a text or starts a call merely because a contact was added.

## Preview locally

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080/ . The form will use the email-draft fallback, because this static server does not run `api/subscribe.js`.

## Placeholders Dave still needs to fill in

- Confirm the office address on the site and the legal pages: 3125 N 37th St, Phoenix, AZ 85018.
- Confirm the SMS program still matches 10DLC: web-form checkbox plus verbal phone opt-in, Twilio as the SMS platform, and "message frequency varies" (the old page said 1–2 messages per quote).
- The contact phone on the old legal pages was (760) 858-1333 and the email was askdave755@gmail.com. Both legal pages now use (220) 208-0593 and dave@nexusgpartners.net.
- `[Case study coming soon]` on the homepage. Add a real shop, the offer, and the booked jobs. Do not invent numbers.
- `[Sample ads coming soon]` in the creative section.
- `[Audit checklist coming soon]`, `[Pricing coming soon]`, and `[Timeline coming soon]` in the FAQ.
- Official logo. The header is a type wordmark. `logo-header.svg`, `promo.mp4`, and `promo-poster.jpg` are the previous shield artwork and are not used on any page. They are still reachable if someone knows the file name.
- Social profile URLs, if they should appear in the footer.
- Brevo attributes listed above, if you want shop, city, jobs, and notes as their own fields.
