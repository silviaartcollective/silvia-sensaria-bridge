export function renderMockupGeneratorSection(){
return `
<section class="uploadbox" id="mockup-generator-panel" aria-label="Generate mockups">
 <div><strong>Generate listing mockups</strong>
 <div class="uploadmeta">Use the master artwork above with PSD/PSB mockups. The JPGs generate in the background and attach automatically to the Etsy listing.</div></div>
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
  <button class="btn secondary" type="button" id="mg-generate">Generate & attach mockups</button>
  <button class="btn secondary" type="button" id="mg-pause" disabled>Stop after current PSD</button>
 </div>
 <div id="mg-progress" class="status" role="status" aria-live="polite">Choose artwork and PSD mockups, then click Generate. Existing JPG mockups can also be uploaded directly.</div>
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
 <div id="mg-engine-status" class="uploadmeta" hidden>Photopea automation engine not started.</div>
 <iframe id="mg-editor" title="Background Photoshop mockup processing" tabindex="-1" aria-hidden="true" referrerpolicy="no-referrer" class="mg-engine"></iframe>
</section>
<style>
#mockup-generator-panel{position:relative;overflow:visible}
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
