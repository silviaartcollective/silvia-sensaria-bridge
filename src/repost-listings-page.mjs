import {renderPhotoOrganizer} from './mockup-generator-ui.mjs';
import {pageHead,renderMockupPresetsSection,renderChatGptSection} from './daily-listings-page.mjs';
// Listing Reposter: the oldest unsold listings are posted again with new SEO
// from ChatGPT, new mockups from the chosen preset and the current template,
// and the old ones are deactivated (repost-listings-client.js; the run is
// listing-renewer.mjs on the server). Laid out like Daily Listings.
export function renderRepostListingsPage(){
  return `${pageHead('Listing Reposter')}<body><div class="shell"><aside><nav><a class="nav active" href="/listing-reposter">Listing Reposter</a></nav></aside>
<main><h1>Listing Reposter</h1><p class="sub">Repost your oldest unsold listings as new ones, with fresh SEO and mockups, and deactivate the old ones.</p>

<section class="card" id="repost"><div class="flex"><h2>Repost listings</h2><span class="muted" id="rp-updated"></span></div>
<p class="muted">The oldest active listings that never sold are posted again as new listings, each like a new Daily Listings draft: a new title, tags and description from ChatGPT (with the instructions below), new mockups from the chosen preset (made on the PC worker) in its arranged photo order with the preset photos and video, and the sizes, prices, shipping and processing of the current template. Each old listing is deactivated once its new one is live, and kept if it sells meanwhile. A listing whose artwork is not in the app keeps its own photos. Each new listing costs Etsy's $0.20 listing fee; the page can be closed while it runs.</p>
<div class="checks" id="rp-checks"></div>
<div class="pair"><label class="pair" style="margin:0">Listings to repost <input type="number" id="rp-count" class="count" min="1" max="50" value="20"></label>
<button class="primary" id="rp-start" type="button">Repost 20 listings</button><button id="rp-stop" type="button" class="hidden">Stop</button>
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
