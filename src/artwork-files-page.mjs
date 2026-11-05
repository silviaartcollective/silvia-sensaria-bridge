import {pageHead} from './daily-listings-page.mjs';
import {ORIGINAL_SIZES} from './artwork-originals.mjs';
// Artwork Files: every master artwork, and its small "original" copy, as zip
// downloads (one or the other), and Generate for the originals still to make
// (artwork-files-client.js; artwork-originals.mjs on the server).
const NAMES={portrait:'Vertical',landscape:'Horizontal',panoramic:'Panoramic',square:'Square'};
export function renderArtworkFilesPage(){
  const sizes=Object.entries(ORIGINAL_SIZES).map(([layout,[w,h]])=>'<div class="size"><b>'+NAMES[layout]+'</b>'+w+' × '+h+'</div>').join('');
  return `${pageHead('Artwork Files')}<body><div class="shell"><aside><nav><a class="nav active" href="/artwork-files">Artwork Files</a></nav></aside>
<main><h1>Artwork Files</h1><p class="sub">Download your master artworks, or small "original" copies of them, as a zip file.</p>
<style>.sizes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0}.size{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:#fff;font-size:13px}
.size b{display:block;font-weight:650;margin-bottom:2px}a.button.primary{background:var(--green);color:#fff;border-color:var(--green)}
a.button[aria-disabled=true]{opacity:.55;pointer-events:none}.facts{font-size:14px;margin:6px 0 12px}
@media(max-width:800px){.sizes{grid-template-columns:1fr 1fr}}</style>

<section class="card" id="masters"><div class="flex"><h2>Master artworks</h2><span class="muted" id="af-updated"></span></div>
<p class="muted">The full-size master of every artwork in the app, as uploaded. Named by artwork ID and file name. A large collection takes a while: the zip downloads as it is made, so keep the page open until your browser says it is done.</p>
<div class="facts" id="af-masters-facts">Counting…</div>
<a class="button primary" id="af-masters" href="/api/artwork-files/masters.zip" download aria-disabled="true">Download all masters (.zip)</a>
</section>

<section class="card" id="originals"><div class="flex"><h2>Originals</h2></div>
<p class="muted">A small copy of each master, as light a JPG as still looks right (about 80–150 KB), in one size for each shape. The master is centre-cropped to fill it.</p>
<div class="sizes">${sizes}</div>
<p class="muted">Every new artwork gets its original as soon as its master is uploaded. Generate makes the ones still missing, and makes again any whose master was replaced.</p>
<div class="facts" id="af-originals-facts">Counting…</div>
<div class="pair"><button class="primary" id="af-generate" type="button" disabled>Generate originals</button>
<a class="button" id="af-originals" href="/api/artwork-files/originals.zip" download aria-disabled="true">Download all originals (.zip)</a></div>
<div id="af-status" class="notice hidden" role="status"></div>
<div class="bar hidden" id="af-bar"><div></div></div>
<div class="rows" id="af-failed"></div>
</section>
</main></div>
<script src="/artwork-files-client.js" defer></script></body></html>`;
}
