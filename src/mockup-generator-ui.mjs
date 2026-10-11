export function renderMockupGeneratorSection(){
return `
<section class="uploadbox" id="mockup-generator-panel" aria-label="Generate mockups">
 <div class="mg-workspace"><div class="mg-main"><div><strong>Generate listing mockups</strong>
 <div class="uploadmeta">Choose master artwork to queue saved PSD templates on your shared PC worker. Close this tab if needed; rendering continues on the PC. Choose finished JPGs on the right.</div></div>
 <div class="uploadrow">
  <label>Add PSD / PSB mockups <span class="hint">optional if templates are saved</span>
   <input id="mg-psds" type="file" accept=".psd,.psb" multiple>
  </label>
  <label>Template collection
   <input id="mg-collection" type="text" value="Default Collection" maxlength="100">
  </label>
 </div>
 <details id="mg-saved-details"><summary>Saved PSD templates <span id="mg-saved-count"></span> · select which to use</summary>
  <div id="mg-templates" class="mg-template-list"></div>
 </details>
 <div class="mg-actions">
  <button class="btn secondary" type="button" id="mg-generate">Queue mockups on PC</button>
  <button class="btn secondary" type="button" id="mg-pause" disabled>Pause after current PSD</button>
 </div>
 <div id="mg-progress" class="status" role="status" aria-live="polite">Choose master artwork above. The shared PC worker will automatically process saved PSDs.</div>
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
 <aside class="mg-preview" aria-label="Generated mockup previews">
  <div class="mg-preview-head"><strong>Generated mockups</strong><span id="mg-preview-count" class="hint">0 ready</span></div>
  <div class="mg-preview-actions">
   <button class="btn secondary" type="button" id="mg-select-all">Select all</button>
   <button class="btn secondary" type="button" id="mg-deselect-all">Deselect all</button>
  </div>
  <div id="mg-preview-list" class="mg-preview-list" aria-live="polite">
   <p class="mg-preview-empty">Finished mockups will appear here while they generate.</p>
  </div>
  <div id="mg-selection-status" class="uploadmeta">All finished mockups are selected by default. Etsy can use up to 7 alongside your 3 preset images.</div>
  <button class="btn" type="button" id="mg-apply-selected" disabled>Apply selected to listing</button>
 </aside></div>
 <div id="mg-worker-status" class="uploadmeta" role="status">Checking shared PC Crop + Mockup Worker…</div>
</section>
<style>
#mockup-generator-panel{position:relative;overflow:visible;container-type:inline-size}
#mockup-generator-panel .mg-workspace{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:16px;align-items:start}
#mockup-generator-panel .mg-main{display:grid;gap:12px;min-width:0}
#mockup-generator-panel .mg-preview{background:#fffdfa;border:1px solid #e2ded6;border-radius:11px;padding:12px;display:grid;gap:10px;min-width:0}
#mockup-generator-panel .mg-preview-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px}
#mockup-generator-panel .mg-preview-actions{display:flex;gap:6px;flex-wrap:wrap}
#mockup-generator-panel .mg-preview-actions button{font-size:11px;padding:7px 9px}
#mockup-generator-panel .mg-preview-list{max-height:370px;min-height:145px;overflow-y:auto;overscroll-behavior:contain;display:grid;align-content:start;gap:8px;padding-right:4px}
#mockup-generator-panel .mg-preview-empty{font-size:12px;color:#74776f;line-height:1.5}
#mockup-generator-panel .mg-preview-item{display:grid;grid-template-columns:20px 76px minmax(0,1fr);gap:7px;align-items:center;border:1px solid #ebe7df;border-radius:9px;padding:6px;background:white;cursor:pointer}
#mockup-generator-panel .mg-preview-item input{width:17px;height:17px;margin:0}
#mockup-generator-panel .mg-preview-item img{display:block;width:76px;height:76px;object-fit:contain;background:#f3f0ec;border-radius:5px}
#mockup-generator-panel .mg-preview-item span{font-size:11px;line-height:1.35;overflow-wrap:anywhere}
#mockup-generator-panel .mg-preview-item small{display:block;color:#74776f;margin-top:3px}
#mockup-generator-panel .mg-preview #mg-apply-selected{font-size:12px;padding:10px}
@container (max-width:690px){.mg-workspace{grid-template-columns:1fr}.mg-preview-list{max-height:300px}}

#mockup-generator-panel .mg-actions{display:flex;flex-wrap:wrap;gap:10px}
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
