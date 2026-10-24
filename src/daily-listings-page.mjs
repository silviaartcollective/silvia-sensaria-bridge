// Daily Listings: new listings in a batch, mockup sets, Renew listings and the
// ChatGPT SEO settings (daily-listings-client.js, daily-batch-client.js).
export function renderDailyListingsPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Daily Listings</title>
<style>
:root{--bg:#f5f2ed;--paper:#fffdfa;--ink:#252a23;--muted:#70746a;--line:#dedcd3;--green:#374737}
*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--bg);font:14px/1.5 system-ui,sans-serif}
.shell{display:grid;grid-template-columns:238px minmax(0,1fr);min-height:100vh}aside{padding:24px;background:#252820;color:#fff}.nav{display:block;color:#e5e8df;padding:11px;text-decoration:none}
main{padding:32px;min-width:0;max-width:1200px;width:100%;margin:0 auto}h1,h2{font-family:Georgia,serif;font-weight:400}h1{font-size:36px;margin:0}h2{font-size:23px;margin:0 0 10px}
.sub{color:var(--muted);margin:7px 0 23px}.card{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:20px;margin:15px 0}
.flex{display:flex;align-items:center;justify-content:space-between;gap:13px;flex-wrap:wrap}.pair{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
button,.button{padding:10px 14px;border:1px solid var(--line);background:#fff;color:#30392c;border-radius:8px;font:inherit;cursor:pointer;text-decoration:none;font-weight:600}
button.primary{background:var(--green);color:white;border-color:var(--green)}button:disabled{opacity:.55;cursor:default}
input,textarea{width:100%;border:1px solid #ccc9c0;background:white;border-radius:7px;padding:10px;color:var(--ink);font:inherit}
textarea{min-height:300px;resize:vertical;font-size:13px}label{font-size:12px;font-weight:650;display:grid;gap:6px;margin:12px 0}
.muted{color:var(--muted);font-size:12px;font-weight:400}.notice{white-space:pre-wrap;overflow-wrap:anywhere;padding:11px 13px;background:#e8efe8;color:#35513c;border-radius:8px;margin:12px 0}
.notice.error{background:#ffebe6;color:#953c32}.notice.warn{background:#fff7e8;color:#625235}
.checks{display:grid;gap:6px;margin:10px 0}.check{display:flex;gap:9px;align-items:center}.check b{width:18px;text-align:center}
.bar{height:6px;border-radius:99px;background:#ebe8e1;overflow:hidden;margin:10px 0}.bar>div{height:100%;background:#546f59;width:0;transition:width .4s}
.rows{display:grid;gap:7px;margin-top:10px}.row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:#fff}
.row .t{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.badge{font-size:11px;padding:3px 9px;border-radius:99px;background:#efede7;white-space:nowrap}
.badge.done{background:#e8eee7;color:#37583b}.badge.working{background:#eef1f6;color:#3d4f6a}.badge.failed{background:#fff0e9;color:#964538}
.count{width:80px!important}.hidden{display:none!important}
.row.item{grid-template-columns:64px minmax(0,1fr) auto}.row.item img,.row.item .ph{width:64px;height:64px;object-fit:cover;border-radius:7px;background:#ebe8e1}
.row .tags{font-size:12px;color:var(--muted);overflow-wrap:anywhere}.row .side{display:grid;gap:6px;justify-items:end}
.row .side label{display:flex;gap:6px;align-items:center;margin:0;font-weight:600}.row .side input{width:auto}
.mini{height:4px;border-radius:99px;background:#ebe8e1;overflow:hidden;margin-top:6px;max-width:260px}.mini>div{height:100%;background:#546f59}
.tpl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:12px}
.tpl{display:grid;gap:6px;padding:8px;border:1px solid var(--line);border-radius:10px;background:#fff;margin:0;font-weight:500;cursor:pointer}
.tpl.on{border-color:#546f59;box-shadow:0 0 0 2px #546f59}.tpl img,.tpl .ph{width:100%;aspect-ratio:1;object-fit:cover;border-radius:7px;background:#ebe8e1}
.tpl .top{display:flex;gap:6px;align-items:center}.tpl input{width:auto}.tpl .name{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ms-tabs button.primary{background:var(--green);color:#fff}
@media(max-width:800px){.shell{grid-template-columns:1fr}aside{display:none}main{padding:22px 16px}h1{font-size:30px}.row{grid-template-columns:1fr}.row.item{grid-template-columns:56px minmax(0,1fr)}.row.item .side{grid-column:1/-1;justify-items:start}}
</style></head><body><div class="shell"><aside><nav><a class="nav active" href="/daily-listings">Daily Listings</a></nav></aside>
<main><h1>Daily Listings</h1><p class="sub">Post a batch of new artworks and renew your oldest unsold listings, with SEO written by ChatGPT.</p>

<section class="card" id="batch"><div class="flex"><h2>New listings</h2><span class="muted" id="bt-updated"></span></div>
<p class="muted">Choose up to 20 artworks. Each one gets its artwork ID, the mockups from its orientation's set (made on the PC worker), SEO from ChatGPT and an Etsy draft set up like the Product Creator does it (preset photos, variants and the orientation's template). The drafts wait here until you press Publish all. Keep this page open while the artworks upload; after that it can be closed.</p>
<div class="checks" id="bt-checks"></div>
<div class="pair"><label class="button" for="bt-files" style="margin:0">Choose artworks…</label><input type="file" id="bt-files" multiple accept="image/jpeg,image/png,image/webp,image/tiff,.jpg,.jpeg,.png,.webp,.tif,.tiff" class="hidden">
<span class="muted" id="bt-pick-note">JPG, PNG, WebP or TIFF masters</span></div>
<div class="rows" id="bt-uploads"></div>
<div id="bt-status" class="notice hidden" role="status"></div>
<div class="rows" id="bt-rows"></div>
<div class="flex hidden" id="bt-actions" style="margin-top:12px"><div class="pair"><button type="button" id="bt-stop" class="hidden">Stop</button><button type="button" id="bt-resume" class="hidden">Resume</button><button type="button" id="bt-retry" class="hidden">Try the failed ones again</button><button type="button" id="bt-new" class="hidden">Start a new batch</button></div>
<button class="primary" type="button" id="bt-publish" disabled>Publish 0 listings</button></div>
</section>

<section class="card" id="mockup-sets"><div class="flex"><h2>Mockup sets</h2><span class="muted" id="ms-room"></span></div>
<p class="muted">The mockups each new listing gets, chosen once for each orientation. They are made from your saved PSD templates (Product Creator → PSD mockups) in the order shown.</p>
<div class="pair" role="tablist" aria-label="Orientation" id="ms-tabs"><button type="button" data-layout="portrait" class="primary">Vertical</button><button type="button" data-layout="landscape">Horizontal</button><button type="button" data-layout="square">Square</button><button type="button" data-layout="panoramic">Panoramic</button></div>
<div class="tpl-grid" id="ms-grid"></div>
<div class="flex" style="margin-top:12px"><div class="pair"><button type="button" id="ms-first">Select the first ones that fit</button><button type="button" id="ms-none">Clear</button><span class="muted" id="ms-count"></span></div><button class="primary" type="button" id="ms-save">Save Vertical set</button></div>
<div id="ms-status" class="notice hidden" role="status"></div>
</section>

<section class="card" id="renew"><div class="flex"><h2>Renew listings</h2><span class="muted" id="rn-updated"></span></div>
<p class="muted">The oldest active listings that never sold are posted again as new listings: same photos, video, variations, prices and shop section, with a new title, tags and description from ChatGPT. Each old listing is deleted once its new one is live. A listing that sells while it is being copied is kept. Each new listing costs Etsy's $0.20 listing fee.</p>
<div class="checks" id="rn-checks"></div>
<div class="pair"><label class="pair" style="margin:0">Listings to renew <input type="number" id="rn-count" class="count" min="1" max="50" value="20"></label>
<button class="primary" id="rn-start" type="button">Renew 20 listings</button><button id="rn-stop" type="button" class="hidden">Stop</button></div>
<div id="rn-status" class="notice hidden" role="status"></div>
<div class="bar hidden" id="rn-bar"><div></div></div>
<div class="rows" id="rn-rows"></div>
</section>

<section class="card" id="chatgpt"><div class="flex"><h2>ChatGPT SEO</h2><span class="muted" id="ai-state"></span></div>
<p class="muted">Used by Renew listings and by Write SEO with ChatGPT in the Product Creator. ChatGPT sees the artwork and these instructions, picks the Etsy style and shop section from your lists, and the app checks its answer against Etsy's limits (140-character title, 13 tags of up to 20 characters).</p>
<label>Model <span class="muted">an OpenAI model name; gpt-5-mini costs under 1 cent per listing</span><input id="ai-model" placeholder="gpt-5-mini"></label>
<label>Instructions <span class="muted">paste your own SEO rules here, for example the instructions of your custom GPT</span><textarea id="ai-instructions"></textarea></label>
<div class="flex"><button type="button" id="ai-default">Use the built-in instructions</button><button class="primary" type="button" id="ai-save">Save ChatGPT settings</button></div>
<div id="ai-status" class="notice hidden" role="status"></div>
</section>
</main></div><script src="/daily-listings-client.js" defer></script><script src="/daily-batch-client.js" defer></script></body></html>`;
}
