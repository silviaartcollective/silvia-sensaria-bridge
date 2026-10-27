import {renderPhotoOrganizer} from './mockup-generator-ui.mjs';
import {pageHead,renderMockupPresetsSection,renderChatGptSection} from './daily-listings-page.mjs';
// Listing Reposter: unsold listings are refreshed in place (new SEO from
// ChatGPT, new mockups from the chosen preset, the current template) and,
// still unsold months later, reposted as new listings with the old ones
// deactivated (repost-listings-client.js; the run is listing-renewer.mjs on
// the server). Laid out like Daily Listings.
export function renderRepostListingsPage(){
  return `${pageHead('Listing Reposter')}<body><div class="shell"><aside><nav><a class="nav active" href="/listing-reposter">Listing Reposter</a></nav></aside>
<main><h1>Listing Reposter</h1><p class="sub">Give unsold listings a second chance: refresh them first, and repost the ones that still don't sell.</p>

<section class="card" id="repost"><div class="flex"><h2>Refresh and repost</h2><span class="muted" id="rp-updated"></span></div>
<p class="muted"><b>Refresh</b>: a listing that hasn't sold by the first age below gets a new title, tags and description from ChatGPT (with the instructions below), new mockups from the chosen preset (made on the PC worker) in its arranged photo order with the preset photos and, if ticked below, the sizes, prices, shipping and processing of the current template (Listings → Templates). It stays the same listing, so it keeps its favourites, views and link. The changes cost nothing; Etsy's usual $0.20 still applies when the listing renews.</p>
<p class="muted"><b>Repost</b>: a refreshed listing that still hasn't sold by the second age is posted again as a new listing in the same way, and the old one is deactivated once the new one is live (kept if it sells meanwhile). Each new listing costs Etsy's $0.20 listing fee; done in the days before the old listing renews, that takes the place of the renewal Etsy would charge. A listing is reposted at most the number of times below, counted across the listings that replaced it (once by default); after that it is left for you to keep or retire.</p>
<p class="muted">Only listings that renew within the days below are picked, so run it about once a week. A listing whose artwork is not in the app gets a new title and tags when refreshed, and its own photos are copied when reposted. The page can be closed while it runs.</p>
<div class="pair" style="margin:4px 0"><label class="pair" style="margin:0">Refresh after <input type="number" id="rp-refresh" class="count" min="1" max="36" value="4"> months</label>
<label class="pair" style="margin:0">Repost after <input type="number" id="rp-repost" class="count" min="2" max="48" value="12"> months</label>
<label class="pair" style="margin:0">Renewing within <input type="number" id="rp-window" class="count" min="1" max="120" value="7"> days</label>
<label class="pair" style="margin:0">Repost each listing at most <input type="number" id="rp-max" class="count" min="0" max="5" value="1"> time(s)</label></div>
<label class="pair" style="margin:4px 0;font-weight:400"><input type="checkbox" id="rp-template" checked style="width:auto"> Refreshing also applies the current template: sizes, prices, shipping and processing</label>
<div class="checks" id="rp-checks"></div>
<div class="pair"><label class="pair" style="margin:0">At most <input type="number" id="rp-count" class="count" min="1" max="50" value="20"> listings</label>
<button class="primary" id="rp-start" type="button">Refresh and repost up to 20 listings</button><button id="rp-stop" type="button" class="hidden">Stop</button>
<button id="rp-resume" type="button" class="hidden">Resume</button><button id="rp-retry" type="button" class="hidden">Try the failed ones again</button></div>
<div id="rp-status" class="notice hidden" role="status"></div>
<div class="bar hidden" id="rp-bar"><div></div></div>
<div class="rows" id="rp-rows"></div>
</section>

${renderMockupPresetsSection({forRepost:true})}

${renderChatGptSection()}

<section class="card" id="one-listing"><div class="flex"><h2>One listing at a time</h2><a class="button" href="/listing-reposter/one">Open the single-listing reposter</a></div>
<p class="muted">Repost one chosen listing by hand: your own SEO and mockups, or a replacement artwork that is cropped again for every size.</p>
</section>
</main></div>
${renderPhotoOrganizer({back:'Cancel'})}
<script src="/assets/photo-organizer-client.js" defer></script><script src="/ai-seo-client.js" defer></script><script src="/mockup-presets-client.js" defer></script><script src="/repost-listings-client.js" defer></script></body></html>`;
}
