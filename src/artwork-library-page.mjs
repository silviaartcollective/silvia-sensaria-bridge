import {pageHead} from './daily-listings-page.mjs';
// Artwork Library: every artwork as a picture with its SKU below, lowest SKU
// first; clicking one downloads its original, then its master
// (artwork-library-client.js).
export function renderArtworkLibraryPage(){
  return `${pageHead('Artwork Library')}<body><div class="shell"><aside><nav><a class="nav active" href="/artwork-library">Artwork Library</a></nav></aside>
<main><h1>Artwork Library</h1><p class="sub">Every artwork, by SKU. Click one to download its original, then its master.</p>
<style>.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;margin-top:14px}
.art{display:grid;gap:8px;padding:8px;border:1px solid var(--line);border-radius:12px;background:#fff;color:inherit;font:inherit;cursor:pointer;text-align:center}
.art:hover,.art:focus-visible{border-color:var(--green);outline:none;box-shadow:0 0 0 2px #cfdccd}
.art .pic{aspect-ratio:1;display:grid;place-items:center;background:#efede7;border-radius:8px;overflow:hidden;color:var(--muted);font-size:12px}
.art img{width:100%;height:100%;object-fit:contain;display:block}
.art .sku{font-weight:650;font-size:13px;letter-spacing:.02em}
.art.busy{opacity:.55;cursor:progress}
@media(max-width:800px){.gallery{grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px}}</style>
<div class="flex"><span class="muted" id="al-count">Loading the artworks…</span><a class="button" href="/artwork-files">Download all as a zip</a></div>
<div id="al-status" class="notice hidden" role="status"></div>
<div class="gallery" id="al-gallery"></div>
</main></div>
<script src="/artwork-library-client.js" defer></script></body></html>`;
}
