export function renderMockupGeneratorSection(){
return `
<section class="uploadbox" id="mockup-generator-panel" aria-label="Generate mockups">
 <div class="mg-workspace"><div class="mg-main"><div><strong>Generate listing mockups</strong>
 <div class="uploadmeta">Optional: choose only the PSD templates you need, then queue them on your PC. You can create the Etsy draft immediately without waiting for rendering. Keep the draft unpublished until its final mockups are ready.</div></div>
 <div class="uploadmeta"><label style="display:flex;flex-direction:row;align-items:flex-start;gap:8px"><input id="mg-auto-queue" type="checkbox" checked style="width:auto;margin-top:2px;flex:none"><span>Automatically generate every selected mockup after each master artwork uploads (about a second each). Then tick up to 16 for Etsy (the master artwork and 3 preset photos fill the other 4 of its 20 photo slots).</span></label></div>
 <div class="uploadrow">
  <label>Vertical PSD / PSB templates <span class="hint">portrait artwork</span>
   <input id="mg-psds" type="file" accept=".psd,.psb" multiple>
  </label>
  <label>Horizontal PSD / PSB templates <span class="hint">landscape artwork</span>
   <input id="mg-psds-horizontal" type="file" accept=".psd,.psb" multiple>
  </label>
 </div>
 <label>Template collection
  <input id="mg-collection" type="text" value="Default Collection" maxlength="100">
 </label>
 <div class="mg-actions">
  <button class="btn secondary" type="button" id="mg-save-templates">Save selected PSD templates to permanent library</button>
 </div>
 <div id="mg-library-upload-status" class="status" role="status" aria-live="polite">Select vertical or horizontal PSDs to save them to Cloudflare R2. They remain available for future products; saving does not start the PC generator.</div>
 <div id="mg-orientation-status" class="status" aria-live="polite">Select a master artwork to detect its aspect ratio. Previously saved templates can be categorized below. Square artworks require square-compatible templates.</div>
 <details id="mg-saved-details"><summary>Permanent saved PSD templates <span id="mg-saved-count"></span> · choose compatible templates</summary>
  <div class="uploadmeta">Assign an orientation to older templates. Mark square-compatible only when the artwork Smart Object fits a square image without stretching.</div>
  <div class="mg-actions"><button class="btn secondary" type="button" id="mg-select-seven">Select first 7</button><button class="btn secondary" type="button" id="mg-select-seventeen">Select all compatible</button><button class="btn secondary" type="button" id="mg-clear-templates">Clear selection</button></div>
  <div id="mg-templates" class="mg-template-list"></div>
 </details>
 <div class="mg-actions">
  <button class="btn secondary" type="button" id="mg-generate">Queue selected mockups on PC</button>
  <button class="btn secondary" type="button" id="mg-pause" disabled>Pause after current PSD</button>
 </div>
 <div id="mg-progress" class="status" role="status" aria-live="polite">Select a master artwork; after it uploads, your selected PSD templates will generate in the background.</div>
 <div class="progress" aria-label="Mockup generation progress"><span id="mg-progress-bar"></span></div>
 <details class="mg-advanced">
  <summary>View individual results and downloads</summary>
  <div id="mg-results" class="mg-results"></div>
 </details>
 <details class="mg-advanced">
  <summary>Saved batches & troubleshooting</summary>
  <div class="mg-actions">
   <button class="btn secondary" type="button" id="mg-refresh-jobs">Refresh jobs</button>
   <button class="btn secondary" type="button" id="mg-retry">Retry failed mockups</button>
   <button class="btn secondary" type="button" id="mg-regenerate">Regenerate all</button>
  </div>
  <div id="mg-jobs" class="mg-job-list"></div>
  <a id="mg-download-all" href="#" download hidden>Download completed JPGs (ZIP)</a>
 </details>
 <div id="mg-mapping" class="mg-map" hidden>
  <strong>Select the artwork Smart Object</strong>
  <p id="mg-map-file" class="uploadmeta"></p>
  <div class="mg-actions"><select id="mg-map-select" aria-label="Artwork Smart Object"></select>
   <button id="mg-save-map" class="btn secondary" type="button">Save mapping & retry</button></div>
 </div>
 </div>
</div>
 <div id="mg-worker-status" class="uploadmeta" role="status">Checking shared PC Crop + Mockup Worker…</div>
</section>
<style>
#mockup-generator-panel{position:relative;overflow:visible}

/* Large independent, selectable three-by-three generated mockup gallery. */
#mockup-generator-panel .mg-workspace{display:block;min-width:0}
#mockup-generator-panel .mg-main{display:grid;gap:12px;min-width:0}
.mg-preview{background:#fffdfa;border:1px solid #e2ded6;border-radius:13px;padding:16px;display:grid;grid-template-rows:auto auto minmax(0,1fr) auto auto;gap:12px;min-width:0}
.mg-preview-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:19px}
.mg-preview-head .hint{font-size:12px;white-space:nowrap}
.mg-preview-actions{display:flex;gap:8px;flex-wrap:wrap}
.mg-preview-actions button{font-size:12px;padding:9px 11px}
.mg-preview-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));--preview-row-height:clamp(300px,40dvh,460px);grid-auto-rows:var(--preview-row-height);gap:12px;min-height:455px;height:calc(2 * var(--preview-row-height) + 24px);max-height:82dvh;overflow-y:auto;overscroll-behavior:contain;align-content:start;scrollbar-gutter:stable;padding:3px 7px 7px 3px}
.mg-preview-empty{grid-column:1/-1;font-size:13px;color:#74776f;line-height:1.6;padding:26px 14px;text-align:center;align-self:start}
.mg-preview-item{display:flex;flex-direction:column;position:relative;gap:8px;border:2px solid #e4e0d7;border-radius:11px;padding:8px;background:white;cursor:pointer;min-width:0;transition:border-color .15s,background .15s}
.mg-preview-item:hover{border-color:#adb9aa}
.mg-preview-item:has(input:checked){border-color:#546f59;background:#eff5ed;box-shadow:0 0 0 1px #546f59}
.mg-preview-item:focus-within{outline:2px solid #6c866f;outline-offset:2px}
.mg-preview-item input{position:absolute;top:12px;right:12px;z-index:2;width:21px;height:21px;margin:0;accent-color:#425d47;cursor:pointer;box-shadow:0 1px 7px #fff;border-radius:4px}
.mg-preview-item img{display:block;width:100%;height:calc(var(--preview-row-height) - 72px);object-fit:contain;background:#f0efeb;border-radius:7px}
.mg-preview-item span{display:block;width:100%;font-size:12px;line-height:1.35;font-weight:600;overflow-wrap:anywhere}
.mg-preview-item small{display:block;font-size:10px;font-weight:400;color:#74776f;margin-top:3px}
.mg-preview #mg-selection-status{font-size:12px}
.mg-org-modal{position:fixed;inset:0;z-index:1000;contain:layout style;background:rgba(34,34,34,.55);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;overscroll-behavior:contain;padding:4vh 16px}
.mg-org-modal[hidden]{display:none}
body.mg-org-open{overflow:hidden}
body.mg-org-dragging,body.mg-org-dragging .mg-org-tile{cursor:grabbing}
body.mg-org-dragging .mg-org-caption{opacity:0;transition:none}
/* Laid out like Etsy's "Photo and video" listing editor. */
.mg-org-dialog{width:min(920px,100%);background:#f8f7f4;color:#222;border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,.3);padding:26px 30px 22px}
.mg-org-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.mg-org-top h2{font-size:21px;font-weight:600;margin:0 0 4px}
.mg-org-top p{margin:0;font-size:13px;color:#595959;line-height:1.45}
.mg-org-close{flex:none;width:40px;height:40px;border:0;border-radius:50%;background:transparent;color:#222;font-size:26px;line-height:1;cursor:pointer}
.mg-org-close:hover{background:rgba(0,0,0,.06)}
.mg-org-head{display:grid;gap:4px;margin:22px 0 12px}
.mg-org-head strong{font-size:15px}
.mg-org-head span{font-size:13px;color:#595959}
.mg-org-list{position:relative;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;user-select:none;-webkit-user-select:none}
.mg-org-tile{position:relative;aspect-ratio:1/1;border:1px solid #d6d4cf;border-radius:12px;overflow:hidden;background:#fff;cursor:grab;touch-action:none;outline:none;will-change:transform}
.mg-org-tile:focus-visible{box-shadow:0 0 0 3px #222}
.mg-org-tile img,.mg-org-tile video{display:block;width:100%;height:100%;object-fit:cover;pointer-events:none}
.mg-org-blank{display:flex;align-items:center;justify-content:center;height:100%;padding:8px;text-align:center;font-size:11px;color:#74776f;background:#f0efeb}
.mg-org-badge{position:absolute;top:7px;right:7px;background:#fff;color:#222;font-size:11px;font-weight:600;line-height:1;padding:5px 8px;border-radius:999px;box-shadow:0 1px 4px rgba(0,0,0,.28)}
/* Kept in the layout so moving the Featured badge never re-lays out the grid. */
.mg-org-badge[hidden]{display:block;visibility:hidden}
.mg-org-caption{position:absolute;left:0;right:0;bottom:0;padding:18px 8px 6px;font-size:11px;line-height:1.25;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.62));opacity:0;transition:opacity .15s;overflow-wrap:anywhere}
.mg-org-tile:hover .mg-org-caption,.mg-org-tile:focus-visible .mg-org-caption{opacity:1}
.mg-org-video{cursor:default;background:#3a3631}
.mg-org-play{position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.35)}
.mg-org-play::after{content:'';position:absolute;left:13px;top:10px;border-style:solid;border-width:7px 0 7px 11px;border-color:transparent transparent transparent #222}
.mg-org-list.sorting .mg-org-tile{transition:transform .12s cubic-bezier(.2,0,0,1)}
.mg-org-list.sorting .mg-org-tile.dragging{z-index:5;transition:none;box-shadow:0 10px 28px rgba(0,0,0,.3)}
.mg-org-tile.over{opacity:.4}
.mg-org-limit{grid-column:1/-1;display:flex;align-items:center;gap:10px;font-size:12px;font-weight:600;color:#8a4b2a}
.mg-org-limit::before,.mg-org-limit::after{content:'';flex:1;border-top:2px dashed #d9a07f}
.mg-org-slot{display:flex;align-items:center;justify-content:center;aspect-ratio:1/1;border:1px dashed #b9b6ae;border-radius:12px;padding:8px;text-align:center;font-size:12px;color:#595959}
.mg-org-help{margin:14px 0 0;font-size:12px;color:#595959;line-height:1.45}
.mg-org-foot{display:flex;align-items:center;gap:10px;margin-top:18px;padding-top:16px;border-top:1px solid #e1ded7}
.mg-org-status{flex:1;font-size:12px;color:#595959;line-height:1.45}
.mg-org-btn{border:2px solid #222;border-radius:999px;background:#222;color:#fff;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer}
.mg-org-btn.secondary{background:transparent;color:#222}
.mg-org-btn:disabled{opacity:.5;cursor:progress}
.mg-org-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media(max-width:760px){.mg-org-dialog{padding:20px 16px}.mg-org-list{grid-template-columns:repeat(3,minmax(0,1fr))}.mg-org-foot{flex-wrap:wrap}.mg-org-status{flex-basis:100%}}
.mg-preview #mg-apply-selected{font-size:13px;padding:13px;width:100%;position:sticky;bottom:0}
@media(max-width:760px){.mg-preview-list{--preview-row-height:clamp(220px,34dvh,320px);gap:7px;max-height:620px;min-height:260px}.mg-preview-item{padding:5px}.mg-preview-item span{font-size:11px}.mg-preview-item input{width:19px;height:19px;top:7px;right:7px}}
#mockup-generator-panel .mg-actions{display:flex;flex-wrap:wrap;gap:10px}
#mockup-generator-panel #mg-library-upload-status{font-size:13px;line-height:1.5;min-height:36px;padding:12px;border-radius:9px;background:#f4f6f1;color:#344d38}
#mockup-generator-panel #mg-library-upload-status.warn{background:#fff0df;color:#945026}
#mockup-generator-panel #mg-save-templates:disabled{opacity:.6;cursor:progress}
#mockup-generator-panel details{padding:10px;border:1px solid #e2ded6;border-radius:9px;background:#fffdfa}
#mockup-generator-panel summary{cursor:pointer;font-size:13px;font-weight:600}
#mockup-generator-panel .mg-template-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:6px;margin-top:12px;max-height:210px;overflow:auto}
#mockup-generator-panel .mg-template-list label{display:flex;flex-direction:row;align-items:center;gap:9px;font-weight:400;font-size:12px}
#mockup-generator-panel .mg-template-list input{width:auto}
#mockup-generator-panel .mg-item{border:1px solid #e2ded6;padding:9px;border-radius:8px;background:#fffdfa;font-size:12px}
#mockup-generator-panel .mg-results{display:grid;gap:7px}
#mockup-generator-panel .mg-item a{color:#32523b;text-decoration:underline}
#mockup-generator-panel .mg-map{padding:12px;background:#faf0df;border-radius:8px}
#mockup-generator-panel .mg-map select{width:auto;min-width:180px}
#mockup-generator-panel .mg-engine{position:fixed!important;left:-20000px!important;top:0!important;width:1100px!important;height:760px!important;opacity:0!important;pointer-events:none!important;border:0!important}
</style>`;
}

// Render generated results in Product Creator's independent right-side preview pane.
export function renderMockupPreviewPanel(){
return `
 <aside class="mg-preview" id="mg-preview-panel" aria-label="Generated mockup previews">
  <div class="mg-preview-head"><strong>Generated mockups</strong><span id="mg-preview-count" class="hint">0 ready</span></div>
  <div class="mg-preview-actions">
   <button class="btn secondary" type="button" id="mg-select-all">Select first 20</button>
   <button class="btn secondary" type="button" id="mg-deselect-all">Deselect all</button>
  </div>
  <div id="mg-preview-list" class="mg-preview-list" aria-live="polite">
   <p class="mg-preview-empty">Finished mockups will appear here while they generate.</p>
  </div>
  <div id="mg-selection-status" class="uploadmeta">Pick up to 20 mockups. Etsy shows 20 photos: with the 3 preset photos, the organizer shows which ones make it (photos below its line are not added). The master artwork is never an Etsy photo. Older batches remain in troubleshooting.</div>
  <button class="btn" type="button" id="mg-apply-selected" disabled>Apply selected to listing</button>
 </aside>
 <div class="mg-org-modal" id="mg-org-modal" hidden>
  <div class="mg-org-dialog" role="dialog" aria-modal="true" aria-labelledby="mg-org-title">
   <div class="mg-org-top">
    <div><h2 id="mg-org-title">Photo and video</h2><p>The order shoppers will see on Etsy. The first photo is the listing's Featured photo.</p></div>
    <button class="mg-org-close" type="button" id="mg-org-close" aria-label="Back to selection">&times;</button>
   </div>
   <div class="mg-org-head"><strong id="mg-org-count">Etsy photos</strong><span>Drag to reorder.</span></div>
   <div id="mg-org-list" class="mg-org-list" role="list" aria-describedby="mg-org-help"></div>
   <p id="mg-org-help" class="mg-org-help">Drag a photo to move it, or select it and use the arrow keys. Your preset video stays in the second spot, where Etsy shows it.</p>
   <div id="mg-org-live" class="mg-org-sr" aria-live="assertive"></div>
   <div class="mg-org-foot">
    <div id="mg-org-status" class="mg-org-status"></div>
    <button class="mg-org-btn secondary" type="button" id="mg-org-back">Back to selection</button>
    <button class="mg-org-btn" type="button" id="mg-org-save">Save order</button>
   </div>
  </div>
 </div>
`;
}

