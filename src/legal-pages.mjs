// Public privacy policy and terms (no sign-in), for Google's OAuth consent
// screen, which needs links to them on the app's own domain to publish the
// Gmail connection. The app is a private tool used only by the shop owner.
const SHOP = 'Silvia Art Collective';
const page = (title, body) => '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + ' · ' + SHOP + '</title>' +
  '<style>body{margin:0;background:#f4f1eb;color:#20221e;font:16px/1.6 system-ui,sans-serif}' +
  'main{max-width:720px;margin:0 auto;padding:40px 20px 60px}h1{font:32px/1.2 Georgia,serif;margin:0 0 6px}' +
  'h2{font:20px/1.3 Georgia,serif;margin:28px 0 6px}p,li{color:#3b3e37}.muted{color:#74776f;font-size:14px}</style>' +
  '</head><body><main>' + body + '</main></body></html>';

export function renderPrivacyPage() {
  return page('Privacy policy', '<h1>Privacy policy</h1><p class="muted">' + SHOP + ' fulfillment app · updated 6 November 2026</p>' +
    '<p>This app is a private tool used only by the owner of ' + SHOP + ' to fulfil its Etsy orders. It is not offered to the public.</p>' +
    '<h2>Gmail</h2><p>When the owner connects Gmail, the app has read-only access. It searches only for shipping emails from the shop\'s print suppliers, reads the order reference and tracking number in them, and adds that tracking to the matching Etsy order. It does not send, change or delete email, and it does not read other email.</p>' +
    '<h2>What is stored</h2><p>The tracking numbers and order references found, and the Google connection token, are stored privately in the app\'s own storage (Render and Cloudflare R2). Email content is not stored.</p>' +
    '<h2>Sharing</h2><p>Nothing is sold or shared with anyone, and nothing is used for advertising. Tracking numbers are sent only to Etsy, on the order they belong to. The app\'s use of information received from Google APIs follows the Google API Services User Data Policy, including the Limited Use requirements.</p>' +
    '<h2>Disconnecting</h2><p>The owner can disconnect Gmail in the app at any time, or remove the app\'s access at myaccount.google.com/permissions; the stored token is then no longer used.</p>' +
    '<p><a href="/terms">Terms of service</a></p>');
}

export function renderTermsPage() {
  return page('Terms of service', '<h1>Terms of service</h1><p class="muted">' + SHOP + ' fulfillment app · updated 6 November 2026</p>' +
    '<p>This app is a private tool for the owner of ' + SHOP + ' to manage the shop\'s listings and fulfil its orders. Only the owner may sign in and use it.</p>' +
    '<p>It is provided as is, for the shop\'s own use. See the <a href="/privacy">privacy policy</a> for how it handles Gmail and order data.</p>');
}
