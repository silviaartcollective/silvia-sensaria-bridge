// Redo listing (/listings/redo?listing=…): the Product Creator's page for a
// listing that is already on Etsy. The same layout, styles and fields (the
// artwork, mockups, pasted or ChatGPT SEO, Etsy settings) — but it starts from
// the listing's artwork and settings, and its last button updates that same
// listing (listing-redo-client.js) instead of creating a draft.
import { renderProductCreator, SEO_PASTE_SCRIPT } from './product-creator.mjs';

// The Product Creator's own styles, so both pages always look the same.
const CREATOR_STYLES = [...renderProductCreator().matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const STYLES = ['Art deco', 'Bohemian & eclectic', 'Coastal & tropical', 'Contemporary', 'Country & farmhouse', 'Gothic', 'Lodge',
  'Mid-century', 'Minimalist', 'Rustic & primitive', 'Victorian'];

export function renderListingRedoPage({ shopName = 'Silvia', idExample = 'SAC0018' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${shopName} Redo Listing</title>
<style>
${CREATOR_STYLES}
.back-btn{display:inline-flex;align-items:center;gap:6px;margin:0 0 14px;font-size:13px;padding:9px 13px}
.redo-art{display:flex;gap:14px;align-items:flex-start}.redo-art img{width:120px;max-height:150px;object-fit:contain;border-radius:9px;border:1px solid var(--line);background:#f0efeb}
.redo-check{display:flex;gap:9px;align-items:center;font-size:13px;font-weight:600}.redo-check input{width:18px;height:18px;margin:0}
.redo-photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:6px}.redo-photos img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:7px;background:#f0efeb}
.mg-preview #redo-update{font-size:13px;padding:13px;width:100%;position:sticky;bottom:0;z-index:5;box-shadow:0 -10px 18px #fffdfa}
.mg-preview #redo-update:disabled{opacity:1;background:#a3a69f}
.mg-preview-item.kept{cursor:default}
</style>
</head>
<body>
<div class="shell">
<aside>
  <div class="brand">${shopName}<br>Fulfillment <small>Etsy → Sensaria</small></div>
  <nav><a class="nav" href="/">Dashboard</a><a class="nav active" href="/listings">Listings</a><a class="nav" href="/product-creator">Product Creator</a></nav>
</aside>
<main>
  <div class="top">
    <div><button class="btn secondary back-btn" type="button" id="redo-back">← Back</button>
    <h1>Redo listing</h1><p class="sub" id="redo-sub">Set this Etsy listing up again from scratch. It keeps its URL, reviews, favourites and sales.</p></div>
    <div class="badge" id="scope-badge">Loading the listing…</div>
  </div>

<div class="grid">
    <section class="card creator-editor-scroll" aria-label="Scrollable listing editor">
      <h2>Listing details</h2>
      <p class="section-sub">Filled from the listing and its orientation's template. Nothing changes on Etsy until you click Update Etsy listing.</p>
      <form class="form" id="creator-form">
        <div class="status" id="redo-summary-status">Loading Etsy listing…</div>

        <div class="uploadbox">
          <div><strong>Artwork</strong>
            <div class="uploadmeta">The master artwork stored in the app. To use a new file, replace it under Production artwork in the listing editor first.</div></div>
          <div class="redo-art"><img id="redo-picture" alt="Artwork" hidden><div class="twocol" style="flex:1">
            <label>Artwork ID<input id="artwork_id" class="mono" readonly placeholder="${idExample}"></label>
            <label>Orientation<input id="orientation_name" readonly></label></div></div>
        </div>

        <div class="uploadbox">
          <div><strong>Mockups</strong>
            <div class="uploadmeta">New PSD mockups from a preset, made on the PC as for a new listing. Pick the ones to use on the right; the preset photos and video are added as for a new listing.</div></div>
          <label class="redo-check"><input type="checkbox" id="redo-keep-photos"> Keep the listing's current photos</label>
          <div id="redo-mockup-tools" class="stack">
            <div class="uploadrow"><label>Mockup preset<select id="redo-preset"></select></label>
              <button class="btn secondary" type="button" id="redo-make" style="align-self:end">Make mockups</button></div>
            <div class="progress" id="redo-progress" hidden><span></span></div>
            <div class="status" id="redo-mockup-status" style="display:none"></div>
            <div class="status warn" id="redo-worker" style="display:none">The PC crop worker is offline: mockups are made when it starts. <a href="pod-crop-worker://start"><strong>Launch PC crop worker</strong></a></div>
          </div>
        </div>

        <div class="uploadbox">
          <label>Paste SEO Generator Output <span class="hint">optional — fills the SEO fields below</span>
            <textarea id="seo_generator_output" placeholder="Paste the complete SEO output here..."></textarea>
          </label>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn secondary" id="apply-seo-btn" type="button">Apply SEO Output</button><button class="btn secondary" id="ai-seo-btn" type="button">Write SEO with ChatGPT</button></div>
          <div class="status" id="seo-paste-status" role="status" style="display:none"></div>
          <div class="uploadmeta">Write SEO with ChatGPT looks at the master artwork and writes new SEO, as for a new listing.</div>
        </div>
        <label>Etsy title <span class="hint" id="title-count"></span><input id="title" maxlength="140" required></label>
        <label>Short SEO Description <span class="hint">placed below ABOUT THIS ARTWORK in the template's description</span><textarea id="seo_description" required placeholder="Paste or write the Short SEO Description..."></textarea></label>
        <label>Etsy Style
          <select id="listing_style"><option value="">Keep the listing's style</option>${STYLES.map(s => `<option value="${s.replace(/&/g, '&amp;')}">${s.replace(/&/g, '&amp;')}</option>`).join('')}</select>
        </label>
        <label>SEO tags <span class="hint" id="tags-count">13 comma-separated Etsy tags</span><input id="tags"></label>
        <label class="redo-check"><input type="checkbox" id="redo-template" checked> Rebuild sizes, prices and SKUs from the app (as for a new listing)</label>
        <div class="status" id="template-status" style="display:none"></div>
        <div class="twocol">
          <label>Etsy category <span class="hint">preset</span><input value="Wall Decor" readonly></label>
          <label>Shipping profile<select id="shipping_profile_id"><option value="">Loading…</option></select></label>
        </div>
        <div class="twocol">
          <label>Processing profile <span class="hint">set with the sizes</span><select id="readiness_state_id"><option value="">Loading…</option></select></label>
          <label>Shop section<select id="shop_section_id"><option value="">Loading…</option></select></label>
        </div>
        <div class="twocol">
          <label>Return policy<select id="return_policy_id"><option value="">Loading…</option></select></label>
          <label>Production partner<select id="production_partner_id"><option value="">Loading…</option></select></label>
        </div>
        <div class="twocol">
          <label>Who made it<select id="who_made"><option value="i_did">I did</option><option value="collective">A member of my shop</option><option value="someone_else">Another company or person</option></select></label>
          <label>When made<select id="when_made"><option value="made_to_order">Made to order</option><option value="2020_2026">2020–2026</option></select></label>
        </div>
        <div class="twocol">
          <label>Finished product<select id="is_supply"><option value="false">Yes — finished product</option><option value="true">No — supply</option></select></label>
          <label>Auto renew<select id="should_auto_renew"><option value="true">On</option><option value="false">Off</option></select></label>
        </div>
      </form>
    </section>

    <aside-card class="card creator-preview-scroll" aria-label="Scrollable mockup preview panel">
      <aside class="mg-preview" aria-label="Generated mockup previews">
        <div class="mg-preview-head"><strong id="redo-preview-title">Generated mockups</strong><span id="mg-preview-count" class="hint">0 ready</span></div>
        <div class="mg-preview-actions">
          <button class="btn secondary" type="button" id="mg-select-all">Select first 20</button>
          <button class="btn secondary" type="button" id="mg-deselect-all">Deselect all</button>
        </div>
        <div id="mg-preview-list" class="mg-preview-list" aria-live="polite"><p class="mg-preview-empty">Choose a preset and click Make mockups. Finished mockups appear here while they generate.</p></div>
        <div id="mg-selection-status" class="uploadmeta">Pick up to 20 mockups. With the preset photos, Etsy shows the first 20.</div>
        <div class="result" id="result" role="status"></div>
        <button class="btn" type="button" id="redo-update" disabled>Update Etsy listing</button>
      </aside>
    </aside-card>
  </div>
</main>
</div>
<script>${SEO_PASTE_SCRIPT}</script>
<script src="/listing-redo-client.js" defer></script>
</body>
</html>`;
}
