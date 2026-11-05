import {pageHead} from './daily-listings-page.mjs';
// Artwork Library: every artwork as its whole picture, in its own shape, with
// its SKU below, lowest SKU first. Clicking one opens it larger in a window
// with its original, master or both to download (artwork-library-client.js).
export function renderArtworkLibraryPage(){
  return `${pageHead('Artwork Library')}<body><div class="shell"><aside><nav><a class="nav active" href="/artwork-library">Artwork Library</a></nav></aside>
<main><h1>Artwork Library</h1><p class="sub">Every artwork, by SKU. Click one to see it larger and download its original, its master or both.</p>
<style>.gallery{--row:250px;display:flex;flex-wrap:wrap;gap:18px 14px;margin-top:14px}
.art{flex:0 0 auto;width:calc(var(--a) * var(--row));max-width:100%;display:flex;flex-direction:column;gap:6px;padding:0;border:0;background:none;color:inherit;font:inherit;cursor:zoom-in;text-align:center}
.art .pic{width:100%;aspect-ratio:var(--a);display:grid;place-items:center;background:#efede7;border:1px solid var(--line);border-radius:10px;overflow:hidden;color:var(--muted);font-size:12px;font-weight:400;padding:0 8px}
.art img{width:100%;height:100%;object-fit:contain;display:block}
.art:has(img) .pic{padding:0}
.art:hover .pic,.art:focus-visible .pic{border-color:var(--green);box-shadow:0 0 0 2px #cfdccd}
.art:focus-visible{outline:none}
.art .sku{font-weight:650;font-size:13px;letter-spacing:.02em}
.pic.making{background:linear-gradient(100deg,#efede7 40%,#f8f6f1 50%,#efede7 60%) 0 0/300% 100%;animation:al-wait 1.6s linear infinite}
@keyframes al-wait{to{background-position:-150% 0}}
@media(prefers-reduced-motion:reduce){.pic.making{animation:none}}
dialog.window{width:min(980px,calc(100vw - 32px));max-height:calc(100vh - 32px);padding:0;border:1px solid var(--line);border-radius:14px;background:var(--paper);color:var(--ink);box-shadow:0 18px 50px rgba(0,0,0,.28)}
dialog.window::backdrop{background:rgba(24,22,18,.62)}
.window .inner{display:grid;gap:14px;padding:18px}
.window .head{display:flex;align-items:start;justify-content:space-between;gap:12px}
.window h2{margin:0;font-size:24px}
.window .close{padding:4px 11px;font-size:20px;line-height:1.2;font-weight:400}
.window .big{--a:1;width:min(100%,calc((100vh - 250px) * var(--a)));aspect-ratio:var(--a);margin:0 auto;display:grid;place-items:center;background:#efede7;border-radius:8px;overflow:hidden;color:var(--muted);font-size:13px;text-align:center;padding:0}
.window .big img{width:100%;height:100%;object-fit:contain;display:block}
.window .actions{display:flex;gap:9px;flex-wrap:wrap;justify-content:center}
.window .notice{margin:0}
@media(max-width:800px){.gallery{--row:150px;gap:14px 9px}.window .inner{padding:14px}.window .actions button{flex:1 1 140px}}</style>
<div class="flex"><span class="muted" id="al-count">Loading the artworks…</span><a class="button" href="/artwork-files">Download all as a zip</a></div>
<div id="al-status" class="notice hidden" role="status"></div>
<div class="gallery" id="al-gallery"></div>
<dialog class="window" id="al-window" aria-labelledby="al-title"><div class="inner">
<div class="head"><div><h2 id="al-title"></h2><div class="muted" id="al-name"></div></div><button type="button" class="close" id="al-close" aria-label="Close">×</button></div>
<div class="big" id="al-big"></div>
<div class="actions"><button type="button" class="primary" data-files="original">Download original</button><button type="button" data-files="master">Download master</button><button type="button" data-files="original,master">Download both</button></div>
<div id="al-window-status" class="notice hidden" role="status"></div>
</div></dialog>
</main></div>
<script src="/artwork-library-client.js" defer></script></body></html>`;
}
