# Silvia Sensaria tracking from Gmail

The Order Tracking page can read Sensaria's shipment emails from a connected Gmail inbox and use them to complete the Etsy order: Etsy marks it shipped and emails the buyer the tracking. Gmail access is read-only; the app never sends, deletes or changes email.

## How it works
1. Every 15 minutes (and with **Scan Sensaria emails now**) the app reads new emails from Sensaria's mail domains from the last 45 days.
2. An email is used only if it says the order **has shipped** (not "label created"), has **exactly one tracking number** and a **recognised carrier**.
3. It finds the Etsy order:
   - by the **Etsy receipt number** in the email. The Sensaria CSV's *PO Number* is the Etsy receipt number, so Sensaria repeats it in its emails. The number is used only if Etsy confirms it is one of this shop's paid, not-canceled orders, and exactly one such number is in the email. The order is then linked to Sensaria automatically.
   - or by a **Sensaria order number** linked by hand (Order Tracking → Link supplier order).
4. The tracking is staged on that order. With **Complete Etsy orders automatically** on, it is sent to Etsy straight away; otherwise use **Mark shipped on Etsy**.

### How the carrier is recognised
The carrier must be certain; the app never guesses one, because a wrong carrier sends the buyer a tracking link that does not work. In order:
1. The email names it: "Carrier: FedEx", "shipped via USPS", a carrier named right by the tracking number ("FedEx tracking number: …", "UPS Ground"), or a subject naming one carrier. If two carriers are named, none is used. DHL eCommerce is not taken for DHL (its parcels are tracked by the postal service).
2. A link in the email goes to the carrier's own website (ups.com, fedex.com, usps.com, dhl.com, …) with this tracking number in it.
3. The tracking number can only be the carrier's: UPS numbers (1Z… with UPS's check digit) and USPS numbers (22 digits starting 92–95, or international ones ending in US, each with its check digit). FedEx and DHL numbers are plain digits that other carriers' numbers can look like, so they need 1, 2 or 4.
4. The email's **Track package** button redirects to the carrier's website with this tracking number in the address. The app reads only the redirects (never loads a page, never opens the carrier's site, never follows unsubscribe or settings links, and never asks a private network address).

Anything else is listed for review with its tracking number, as is a UPS number in an email that names another carrier.

An order Etsy already shows shipped with different tracking is never changed, and a tracking number already on Etsy is never sent twice. Anything that cannot be verified is listed under the scan results for review.

## One-time setup
### Google Cloud (about 10 minutes)
1. Go to <https://console.cloud.google.com>, create a project (e.g. "Silvia tracking").
2. **APIs & Services → Library**: enable the **Gmail API**.
3. **APIs & Services → OAuth consent screen**: user type **External**, app name "Silvia tracking", your email as support and developer contact. Add the scope `https://www.googleapis.com/auth/gmail.readonly`.
4. Under **Audience** (or *Publishing status*), click **Publish app** so it is **In production**. In *Testing*, Google disconnects Gmail every 7 days. You do not need Google's verification for your own mailbox: when connecting, Google shows "Google hasn't verified this app"; choose **Advanced → Go to Silvia tracking**.
5. **APIs & Services → Credentials → Create credentials → OAuth client ID**: type **Web application**, authorised redirect URI:

   `https://silvia-sensaria-bridge.onrender.com/tracking/gmail/callback`

   Copy the client ID and client secret.

### Render
In the silvia-sensaria-bridge service → **Environment**, add (keep them in Render, never in GitHub):
- `GMAIL_OAUTH_CLIENT_ID`: the client ID
- `GMAIL_OAUTH_CLIENT_SECRET`: the client secret
- `GMAIL_OAUTH_REDIRECT_URI` = `https://silvia-sensaria-bridge.onrender.com/tracking/gmail/callback`
- `GMAIL_TOKEN_ENCRYPTION_KEY`: 32 random bytes in base64. Generate one with
  `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Never reuse another key; losing it only means connecting Gmail again.
- Optional: `GMAIL_SENSARIA_SENDER_DOMAINS`: extra Sensaria mail domains, comma separated, if their emails come from a domain other than `sensaria.com` or `gooten.com`.
- Optional: `ETSY_SHIPMENT_SUBMISSION_ENABLED=false` switches off sending tracking to Etsy entirely.

Save; Render redeploys.

### In the app
1. **Order Tracking → Connect Gmail (read-only)**, and sign in with the mailbox that receives Sensaria's shipment emails.
2. Click **Scan Sensaria emails now** and check the result.
3. Turn on **Complete Etsy orders automatically** when the results look right.

## Notes
- Scans run while the app server is awake. On Render's free plan it sleeps after 15 minutes without visitors; the PC worker keeps it awake while it is running. A scan also runs 2 minutes after each start.
- The Google refresh token is encrypted (AES-256-GCM) in this shop's R2 space. **Disconnect Gmail** revokes and erases it.
- If Sensaria's emails do not contain the Etsy receipt number, link each order's Sensaria order number by hand, or import Sensaria's tracking CSV.
