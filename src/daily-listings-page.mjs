import {PHOTO_ORGANIZER_CSS,renderPhotoOrganizer} from './mockup-generator-ui.mjs';
// Daily Listings: new listings in a batch, the mockup presets and the ChatGPT
// SEO settings (daily-batch-client.js, mockup-presets-client.js,
// ai-seo-client.js). Its styles and the presets and ChatGPT sections are
// shared with the Listing Reposter (repost-listings-page.mjs).
export const DAILY_CSS=`:root{--bg:#f5f2ed;--paper:#fffdfa;--ink:#252a23;--muted:#70746a;--line:#dedcd3;--green:#374737}
*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--bg);font:14px/1.5 system-ui,sans-serif}
.shell{display:grid;grid-template-columns:238px minmax(0,1fr);min-height:100vh}aside{padding:24px;background:#252820;color:#fff}.nav{display:block;color:#e5e8df;padding:11px;text-decoration:none}
main{padding:32px;min-width:0;max-width:1200px;width:100%;margin:0 auto}h1,h2{font-family:Georgia,serif;font-weight:400}h1{font-size:36px;margin:0}h2{font-size:23px;margin:0 0 10px}
.sub{color:var(--muted);margin:7px 0 23px}.card{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:20px;margin:15px 0}
.flex{display:flex;align-items:center;justify-content:space-between;gap:13px;flex-wrap:wrap}.drop{display:flex;gap:9px;align-items:center;flex-wrap:wrap;padding:16px;border:2px dashed var(--line);border-radius:12px;transition:border-color .12s,background .12s}.drop.over{border-color:var(--green);background:#eef3ec}.pair{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
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
.tpl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin:8px 0 16px}
.tpl{display:grid;gap:6px;padding:7px;border:1px solid var(--line);border-radius:10px;background:#fff;min-width:0}
.tpl .pic{aspect-ratio:1;border-radius:7px;background:#ebe8e1;overflow:hidden;display:grid;place-items:center}
.tpl .pic img{width:100%;height:100%;object-fit:contain;display:block}
.tpl .pic .none{font-size:11px;color:var(--muted);padding:10px;text-align:center;line-height:1.35}
.tpl .name{font-size:12px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tpl.unused{opacity:.45}.group-title{font-weight:650;margin:14px 0 2px}.group-title .muted{font-weight:400}
#mp-tabs button.primary{background:var(--green);color:#fff}
.group-title{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.group-title button{padding:5px 10px;font-size:12px}
@media(max-width:800px){.shell{grid-template-columns:1fr}aside{display:none}main{padding:22px 16px}h1{font-size:30px}.row{grid-template-columns:1fr}.row.item{grid-template-columns:56px minmax(0,1fr)}.row.item .side{grid-column:1/-1;justify-items:start}}`;
export function pageHead(title){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title}</title>
<style>
${DAILY_CSS}
${PHOTO_ORGANIZER_CSS}
</style></head>`;
}
// forRepost: the preset chosen here is the Listing Reposter's.
export function renderMockupPresetsSection({forRepost=false}={}){
  return `<section class="card" id="mockup-presets"${forRepost?' data-for="repost"':''}><div class="flex"><h2>Mockup presets</h2><span class="muted" id="mp-room"></span></div>
<p class="muted" id="mp-about">Your presets are the folders named Preset 1, Preset 2… in the PC mockup folder. Each ${forRepost?'reposted':'new'} listing gets the PSDs from the chosen preset that suit its artwork's shape. Add, remove or move PSDs on the PC; the worker picks the change up within a minute.</p>
<div class="flex"><div class="pair" role="tablist" aria-label="Mockup preset" id="mp-tabs"></div><button type="button" id="mp-refresh">Check again</button></div>
<div id="mp-status" class="notice hidden" role="status"></div>
<div id="mp-groups"></div>
</section>`;
}
export function renderChatGptSection(){
  return `<section class="card" id="chatgpt"><div class="flex"><h2>ChatGPT SEO</h2><span class="muted" id="ai-state"></span></div>
<p class="muted">Used by Daily Listings, the Listing Reposter and Write SEO with ChatGPT in the Product Creator. ChatGPT sees the artwork and these instructions, picks the Etsy style and shop section from your lists, and the app checks its answer against Etsy's limits (140-character title, 13 tags of up to 20 characters).</p>
<label>Model <span class="muted">an OpenAI model name; gpt-5-mini costs under 1 cent per listing</span><input id="ai-model" placeholder="gpt-5-mini"></label>
<label>Instructions <span class="muted">paste your own SEO rules here, for example the instructions of your custom GPT</span><textarea id="ai-instructions"></textarea></label>
<div class="flex"><button type="button" id="ai-default">Use the built-in instructions</button><button class="primary" type="button" id="ai-save">Save ChatGPT settings</button></div>
<div id="ai-status" class="notice hidden" role="status"></div>
</section>`;
}
export function renderDailyListingsPage() {
  return `${pageHead('Daily Listings')}<body><div class="shell"><aside><nav><a class="nav active" href="/daily-listings">Daily Listings</a></nav></aside>
<main><h1>Daily Listings</h1><p class="sub">Post a batch of new artworks, with mockups from your presets and SEO written by ChatGPT.</p>

<section class="card" id="batch"><div class="flex"><h2>New listings</h2><span class="muted" id="bt-updated"></span></div>
<p class="muted">Choose up to 20 artworks. Each one gets its artwork ID, the mockups from the chosen preset that suit its shape (made on the PC worker), SEO from ChatGPT and an Etsy draft set up like the Product Creator does it (preset photos, variants and the orientation's template). The drafts wait here until you press Publish all. Keep this page open while the artworks upload; after that it can be closed.</p>
<div class="checks" id="bt-checks"></div>
<div class="drop" id="bt-drop"><label class="button" for="bt-files" style="margin:0">Choose artworks…</label><input type="file" id="bt-files" multiple accept="image/jpeg,image/png,image/webp,image/tiff,.jpg,.jpeg,.png,.webp,.tif,.tiff" class="hidden">
<span class="muted" id="bt-pick-note">or drag them here · JPG, PNG, WebP or TIFF masters</span></div>
<div class="rows" id="bt-uploads"></div>
<div id="bt-status" class="notice hidden" role="status"></div>
<div class="rows" id="bt-rows"></div>
<div class="flex hidden" id="bt-actions" style="margin-top:12px"><div class="pair"><button type="button" id="bt-stop" class="hidden">Stop</button><button type="button" id="bt-resume" class="hidden">Resume</button><button type="button" id="bt-retry" class="hidden">Try the failed ones again</button><button type="button" id="bt-start-over" class="hidden">Start over</button></div>
<button class="primary" type="button" id="bt-publish" disabled>Publish 0 listings</button></div>
</section>

${renderMockupPresetsSection()}

<section class="card" id="renew"><div class="flex"><h2>Renew listings</h2><a class="button" href="/listing-reposter">Open the Listing Reposter</a></div>
<p class="muted">Refreshing unsold listings (new SEO, new mockups from a preset, the current template, on the same listing) and reposting the ones that still don't sell is on the Listing Reposter page.</p>
</section>

${renderChatGptSection()}
</main></div>
${renderPhotoOrganizer({back:'Cancel'})}
<script src="/assets/photo-organizer-client.js" defer></script><script src="/ai-seo-client.js" defer></script><script src="/mockup-presets-client.js" defer></script><script src="/daily-batch-client.js" defer></script></body></html>`;
}
