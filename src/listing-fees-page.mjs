import {pageHead} from './daily-listings-page.mjs';
// Fees & Expenses: what Etsy charged for listings in a month (from the shop's
// payment account ledger), projected to the month's end, the month's ChatGPT
// costs, and a planner for a daily posting plan (listing-fees-client.js).
export function renderListingFeesPage(){
  return `${pageHead('Fees &amp; Expenses')}<body><div class="shell"><aside><nav><a class="nav active" href="/listing-fees">Fees &amp; Expenses</a></nav></aside>
<main><h1>Fees &amp; Expenses</h1><p class="sub">What the shop spent in a month: Etsy's listing and other fees, from your Etsy payment account, and ChatGPT. And what a posting plan costs.</p>
<style>.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:14px 0}.stat{border:1px solid var(--line);border-radius:12px;padding:14px;background:#fff}
.stat b{display:block;font:500 28px/1.2 Georgia,serif;margin-top:4px}.feetable{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
.feetable td,.feetable th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left}.feetable td.n,.feetable th.n{text-align:right;white-space:nowrap}
.days{display:grid;gap:4px;margin-top:8px}.day{display:grid;grid-template-columns:90px minmax(0,1fr) 120px;gap:10px;align-items:center;font-size:12px}
.day .track{height:10px;background:#efede7;border-radius:6px;overflow:hidden}.day .track span{display:block;height:100%;background:var(--green)}
#lf-month{width:auto}.plan{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:end}.plan input{width:100%}
@media(max-width:800px){.stats,.plan{grid-template-columns:1fr 1fr}}</style>

<section class="card" id="totals"><div class="flex"><h2 id="ex-month">This month</h2><div class="pair"><input type="month" id="lf-month" aria-label="Month"><button type="button" id="lf-refresh">Refresh</button></div></div>
<p class="muted">The month chosen here is used for everything on this page.</p>
<div class="stats"><div class="stat">Etsy fees<b id="ex-etsy">–</b><span class="muted">listing and other fees</span></div>
<div class="stat">ChatGPT<b id="ex-ai">–</b><span class="muted" id="ex-ai-note"></span></div>
<div class="stat">Total<b id="ex-total">–</b><span class="muted" id="ex-total-note">fees and expenses</span></div></div>
</section>

<section class="card" id="fees"><div class="flex"><h2>Listing fees</h2><span class="muted month-name"></span></div>
<p class="muted">Every listing fee and renewal Etsy charged in the month: new listings (including reposts), auto-renewals after a sale and renewed listings, $0.20 each. Read from your Etsy payment account, so a fee shows once Etsy has charged it.</p>
<div id="lf-status" class="notice hidden" role="status"></div>
<div class="stats"><div class="stat">Listing fees<b id="lf-total">–</b><span class="muted" id="lf-count"></span></div>
<div class="stat">Projected for the month<b id="lf-projected">–</b><span class="muted" id="lf-rate"></span></div>
<div class="stat">Other Etsy fees<b id="lf-other-total">–</b><span class="muted">transaction, processing, ads…</span></div></div>
<h3>By kind</h3><table class="feetable"><thead><tr><th>Kind</th><th class="n">Listings</th><th class="n">Fees</th></tr></thead><tbody id="lf-types"></tbody></table>
<h3>By day</h3><div class="days" id="lf-days"></div>
<details style="margin-top:14px"><summary>Other Etsy fees in the month</summary><p class="muted">Fees Etsy gave back on refunded orders are taken off (a negative line).</p><table class="feetable"><thead><tr><th>Kind</th><th class="n">Charges</th><th class="n">Fees</th></tr></thead><tbody id="lf-other"></tbody></table></details>
<details style="margin-top:8px"><summary>Not counted as fees</summary><p class="muted">Everything else in the month's Etsy payment account: sales, refunds to buyers, deposits, reserves, balance recovered by Etsy. Listed so every entry is accounted for.</p><table class="feetable"><thead><tr><th>Kind</th><th class="n">Entries</th><th class="n">Amount</th></tr></thead><tbody id="lf-skipped"></tbody></table></details>
</section>

<section class="card" id="chatgpt"><div class="flex"><h2>ChatGPT</h2><span class="muted"><span class="month-name"></span> <span id="ai-calls"></span></span></div>
<p class="muted">The SEO ChatGPT writes for new and renewed listings. Each request's tokens are recorded as it is made, with its cost estimated from the model's price; with an OpenAI admin key (OPENAI_ADMIN_KEY in Render) the amount OpenAI billed for the month is shown too.</p>
<div id="ai-status" class="notice hidden" role="status"></div>
<div class="stats"><div class="stat">Estimated cost<b id="ai-estimated">–</b><span class="muted" id="ai-tokens"></span></div>
<div class="stat">Billed by OpenAI<b id="ai-billed">–</b><span class="muted" id="ai-billed-note"></span></div>
<div class="stat">Per listing<b id="ai-per">–</b><span class="muted">estimated, per request</span></div></div>
<table class="feetable"><thead><tr><th>Model</th><th class="n">Requests</th><th class="n">Tokens in / out</th><th class="n">Estimated</th></tr></thead><tbody id="ai-models"></tbody></table>
</section>

<section class="card" id="plan"><div class="flex"><h2>Plan a month</h2><span class="muted" id="pl-result"></span></div>
<p class="muted">What a daily posting plan costs in listing fees (auto-renewals after sales come on top).</p>
<div class="plan"><label>New listings a day<input type="number" id="pl-new" min="0" value="20"></label>
<label>Reposts a day<input type="number" id="pl-repost" min="0" value="20"></label>
<label>Days<input type="number" id="pl-days" min="1" max="31" value="30"></label>
<label>Fee per listing ($)<input type="number" id="pl-fee" min="0" step="0.01" value="0.20"></label></div>
</section>
</main></div>
<script src="/listing-fees-client.js" defer></script></body></html>`;
}
