import {pageHead} from './daily-listings-page.mjs';
// Shop Data: the shop's Etsy listings as a CSV download and a ChatGPT audit
// prompt to paste with it (shop-data.mjs, shop-data-client.js).
export function renderShopDataPage(){
  return `${pageHead('Shop Data')}<body><div class="shell"><aside><nav><a class="nav active" href="/shop-data">Shop Data</a></nav></aside>
<main><h1>Shop Data</h1><p class="sub">Every Etsy listing in the shop as one spreadsheet, with its views, favourites and sales, plus a prompt that asks ChatGPT to audit it. No customer or order details are included; sales are only counted.</p>
<style>a.button.primary{background:var(--green);color:#fff;border-color:var(--green)}a.button[aria-disabled=true]{opacity:.55;pointer-events:none}
.steps{margin:4px 0 14px;padding-left:20px}.steps li{margin:3px 0}.check.bad b{color:#964538}.check.good b{color:#37583b}
#sd-prompt{min-height:340px;background:#fbfaf7}</style>

<section class="card"><div class="flex"><h2>Audit with ChatGPT</h2><span class="muted" id="sd-read-at"></span></div>
<ol class="steps"><li>Download the shop data (.csv).</li><li>Open ChatGPT, start a new chat and attach the file.</li><li>Copy the audit prompt and paste it as your message.</li></ol>
<div id="sd-status" class="notice hidden" role="status"></div>
<div class="bar hidden" id="sd-bar"><div></div></div>
<div class="pair"><a class="button primary" id="sd-download" href="/api/shop-data/export.csv" aria-disabled="true">Download shop data (.csv)</a><button type="button" id="sd-copy" disabled>Copy ChatGPT audit prompt</button><button type="button" id="sd-again">Read the shop again</button></div>
</section>

<section class="card"><h2>What the export found</h2><p class="muted">Counted from the same reading as the download. ChatGPT gets these numbers in the prompt.</p><div class="checks" id="sd-facts"><span class="muted">Waiting for Etsy…</span></div></section>

<section class="card"><h2>Audit prompt</h2><p class="muted">Filled in with the shop's own numbers and sections. You can edit it here before you copy it.</p><textarea id="sd-prompt" spellcheck="false"></textarea></section>
</main></div>
<script src="/shop-data-client.js" defer></script></body></html>`;
}
