export function renderMockupGeneratorSection(){
return `
<section class="uploadbox" id="mockup-generator-panel" aria-label="Generate mockups">
 <div class="mg-workspace"><div class="mg-main"><div><strong>Generate listing mockups</strong>
 <div class="uploadmeta">Optional: choose only the PSD templates you need, then queue them on your PC. You can create the Etsy draft immediately without waiting for rendering. Keep the draft unpublished until its final mockups are ready.</div></div>
 <div class="uploadmeta"><label style="display:flex;flex-direction:row;align-items:flex-start;gap:8px"><input id="mg-auto-queue" type="checkbox" checked style="width:auto;margin-top:2px;flex:none"><span>Automatically queue the first 16 selected mockups after each master artwork uploads. The master artwork plus 3 preset photos leave 16 additional Etsy photo slots. Use “Select first 7” for a smaller, faster batch.</span></label></div>
 <div class="uploadrow">
  <label>Add PSD / PSB mockups <span class="hint">optional if templates are saved</span>
   <input id="mg-psds" type="file" accept=".psd,.psb" multiple>
  </label>
  <label>Template collection
   <input id="mg-collection" type="text" value="Default Collection" maxlength="100">
  </label>
 </div>
 <details id="mg-saved-details"><summary>Saved PSD templates <span id="mg-saved-count"></span> · select which to use</summary>
  <div class="mg-actions"><button class="btn secondary" type="button" id="mg-select-seven">Select first 7</button><button class="btn secondary" type="button" id="mg-select-seventeen">Select first 17 (Etsy max)</button><button class="btn secondary" type="button" id="mg-clear-templates">Clear selection</button></div>
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
.mg-preview-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));--preview-row-height:clamp(172px,20dvh,230px);grid-auto-rows:var(--preview-row-height);gap:11px;min-height:455px;height:calc(3 * var(--preview-row-height) + 32px);max-height:74dvh;overflow-y:auto;overscroll-behavior:contain;align-content:start;scrollbar-gutter:stable;padding:3px 7px 7px 3px}
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
.mg-preview #mg-apply-selected{font-size:13px;padding:13px;width:100%;position:sticky;bottom:0}
@media(max-width:760px){.mg-preview-list{gap:7px;max-height:550px;min-height:260px}.mg-preview-item{padding:5px}.mg-preview-item span{font-size:11px}.mg-preview-item input{width:19px;height:19px;top:7px;right:7px}}
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

// Render generated results in Product Creator's independent right-side preview pane.
export function renderMockupPreviewPanel(){
return `
 <aside class="mg-preview" aria-label="Generated mockup previews">
  <div class="mg-preview-head"><strong>Generated mockups</strong><span id="mg-preview-count" class="hint">0 ready</span></div>
  <div class="mg-preview-actions">
   <button class="btn secondary" type="button" id="mg-select-all">Select all</button>
   <button class="btn secondary" type="button" id="mg-deselect-all">Deselect all</button>
  </div>
  <div id="mg-preview-list" class="mg-preview-list" aria-live="polite">
   <p class="mg-preview-empty">Finished mockups will appear here while they generate.</p>
  </div>
  <div id="mg-selection-status" class="uploadmeta">A starter draft contains 1 master photo and 3 preset photos, leaving 16 slots for generated JPGs (20 Etsy photos total). Older batches remain in troubleshooting.</div>
  <button class="btn" type="button" id="mg-apply-selected" disabled>Apply selected to listing</button>
 </aside>
`;
}

