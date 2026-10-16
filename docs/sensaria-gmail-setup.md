# Silvia Sensaria tracking — read-only Gmail setup

The Order Tracking page includes an optional Gmail connection, strictly to read Sensaria/Gooten shipment messages and stage verified tracking for review. It does not send email, submit supplier orders, or mark Etsy orders shipped automatically.

## Google Cloud
1. Choose a Google Cloud project, enable **Gmail API**, and set up the Google OAuth consent screen.
2. Use a **Web application** OAuth client with an authorized redirect URI:

   `https://silvia-sensaria-bridge.onrender.com/tracking/gmail/callback`

3. Request the minimum scope: `https://www.googleapis.com/auth/gmail.readonly`. If the OAuth app is in Testing, authorize the intended Gmail account as a test user. Google's external-app verification or testing limitations may apply to this restricted Gmail scope.
4. In the Silvia Render service, set these environment variables (keep values in Render, not in GitHub):
   - `GMAIL_OAUTH_CLIENT_ID`
   - `GMAIL_OAUTH_CLIENT_SECRET`
   - `GMAIL_OAUTH_REDIRECT_URI` = `https://silvia-sensaria-bridge.onrender.com/tracking/gmail/callback`
   - `GMAIL_TOKEN_ENCRYPTION_KEY` = **32 random bytes encoded as standard base64**. Generate securely with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` locally; never reuse an Etsy or R2 key.
   - Optional: `GMAIL_SENSARIA_SENDER_DOMAINS` = extra confirmed Sensaria/Gooten mail domain(s) separated by commas. Defaults include `sensaria.com` and `gooten.com`.
5. Restart/deploy the Render service and use **Order Tracking → Connect Gmail** to authorize the mailbox that receives shipment updates.

## Matching and safety

Before scanning, link each **Etsy receipt ID** to the **actual Sensaria order number** using Order Tracking → Link supplier order. For example, receipt `4201324221` links to Sensaria order `4591174`.

The scanner only stages a shipment if the sender domain is trusted, the email explicitly confirms shipment, exactly one linked supplier order number matches, a single valid tracking number is present, and a carrier can be identified. Unmatched, unsigned, premature, ambiguous, or malformed messages remain unstaged for review.

On-demand scans are available on Order Tracking. A scan also runs roughly every 30 minutes **while the Render service is awake**, not a guaranteed background schedule. Gmail is read-only, and no buyer notification occurs until a separate Etsy shipment confirmation.

The Google refresh token is encrypted with AES-256-GCM before storage in the shop's namespaced R2 location. Keep the encryption key private; losing the key requires reconnecting Gmail. Disconnect Gmail from the Order Tracking page to revoke and overwrite the saved token. Each shop has a separate token and scan-state namespace.

If Gmail does not include the Sensaria order number or carrier in the email, the scanner will not make an unsafe guess; use the existing CSV/manual tracking path for that shipment.
