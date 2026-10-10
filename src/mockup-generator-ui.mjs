export function renderMockupGeneratorSection() {
 return `
<section id="mockup-generator-panel" class="mg-panel" hidden aria-label="Photopea Mockup Generator">
 <div class="card mg-intro">
  <h2>Photopea Mockup Generator</h2>
  <p class="section-sub">One artwork → reusable PSD / PSB mockups → JPG results. Your saved templates and jobs stay in this shop's private R2 storage.</p>
  <div class="status warn">Photopea currently runs inside this Product Creator browser tab. Keep the tab open while processing. Closed-tab unattended generation is not yet verified.</div>
 </div>
 <div class="grid">
 <div>
  <section class="card">
   <h2>1. Saved mockup templates</h2>
   <p class="section-sub">Upload PSD / PSB templates once. Collections and mapped artwork Smart Objects are reused.</p>
   <div class="uploadbox"><div class="twocol">
    <label>Template collection<input type="text" id="mg-collection" value="Default Collection" maxlength="100"></label>
    <label>PSD / PSB templates<input type="file" id="mg-psds" accept=".psd,.psb" multiple></label>
   </div>
   <div class="mg-actions"><button class="btn secondary" id="mg-upload-templates" type="button">Save selected PSD templates</button>
    <button class="btn secondary" id="mg-refresh-templates" type="button">Refresh templates</button></div>
   <p class="uploadmeta">Uploads are saved privately; the original layered templates are never overwritten. Large PSD files can take several minutes.</p></div>
   <div id="mg-templates" class="mg-template-list"></div>
  </section>
  <section class="card">
   <h2>2. Upload artwork & generate</h2>
   <div class="form">
    <label>Artwork to apply to all selected mockups<input id="mg-artwork" type="file" accept=".jpg,.jpeg,.png,.webp,.tif,.tiff"></label>
    <label>Artwork fitting
      <select id="mg-fit"><option value="contain">Fit entire artwork — no cropping</option><option value="cover">Fill frame — centered crop allowed</option></select>
    </label>
    <div class="mg-actions"><button type="button" class="btn" id="mg-new-job">Create batch</button>
    <button type="button" class="btn secondary" id="mg-refresh-jobs">Refresh saved batches</button></div>
   </div>
   <div id="mg-jobs" class="mg-job-list"></div>
  </section>
  <section class="card">
   <h2>3. Generation & downloads</h2>
   <p class="section-sub">Each PSD runs separately. Failed templates are retained for retry; generated results are saved after verification.</p>
   <div class="mg-actions"><button class="btn" type="button" id="mg-start">Start / Resume</button>
    <button class="btn secondary" type="button" id="mg-pause">Pause</button>
    <button class="btn secondary" type="button" id="mg-retry">Retry failed</button>
    <button class="btn secondary" type="button" id="mg-regenerate">Regenerate all JPGs</button></div>
   <div id="mg-progress" class="status" role="status">Choose a saved batch to begin.</div>
   <div id="mg-results" class="mg-results"></div>
   <a class="btn secondary" id="mg-download-all" href="#" download style="display:inline-block">Download all completed JPGs (ZIP)</a>
   <button class="btn secondary" id="mg-use-results" type="button">Use finished JPGs in Etsy Product Creator</button>
  </section>
 </div>
 <div>
  <section class="card">
   <h2>Photopea renderer</h2>
   <p class="section-sub">The embedded editor processes the original PSD and retains its visible/hidden layers. Unmapped artwork Smart Objects require your confirmation.</p>
   <iframe id="mg-editor" title="Photopea PSD mockup rendering" referrerpolicy="no-referrer" style="display:block;width:100%;height:390px;border:1px solid #dad6ca;border-radius:10px" loading="lazy"></iframe>
   <div class="status" id="mg-engine-status">Photopea not started.</div>
   <div class="mg-map" id="mg-mapping" hidden>
     <strong>Artwork Smart Object needs your selection</strong>
     <div id="mg-map-file" class="uploadmeta"></div>
     <select id="mg-map-select"></select>
     <button class="btn secondary" id="mg-save-map" type="button">Save target & retry</button>
   </div>
   <p class="uploadmeta">Artwork Smart Object “5” is mapped for the verified black, light wood, and dark wood vertical close-up templates. Other multi-Smart-Object PSDs require layer confirmation.</p>
  </section>
 </div>
 </div>
</section>
<style>
.creator-tabs{display:flex;gap:10px;margin:0 0 22px;flex-wrap:wrap}
.creator-tabs button{padding:12px 18px;background:#fff;border:1px solid #ddd8ce;border-radius:9px;cursor:pointer;color:#293129;font-weight:600}
.creator-tabs button[aria-selected=true]{background:#30352e;color:#fff}
.mg-panel{display:grid;gap:18px}.mg-panel[hidden],#product-listing-panel[hidden]{display:none!important}.mg-panel .grid{grid-template-columns:minmax(0,1fr) 360px;gap:18px}
.mg-panel .card{margin-bottom:18px}.mg-actions{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}
.mg-template-list,.mg-job-list,.mg-results{display:grid;gap:9px;margin-top:14px}
.mg-item{padding:12px;border:1px solid #dedbd4;border-radius:10px;display:flex;align-items:flex-start;gap:10px;justify-content:space-between;background:#fbfaf8;overflow-wrap:anywhere}
.mg-item label{display:flex;gap:8px;align-items:center;font-size:13px;min-width:0;flex:1}
.mg-item input[type=checkbox]{width:auto}.mg-item img{width:64px;max-height:75px;object-fit:contain;border-radius:4px}
.mg-item button,.mg-item select{padding:7px;font-size:12px}
.mg-item strong{display:block;font-size:13px}.mg-item small{display:block;color:#656c62}
.mg-map{padding:13px;margin-top:12px;background:#faf1e5;border-radius:10px}
.mg-results a{color:#334d35;text-decoration:underline}
@media(max-width:1100px){.mg-panel .grid{grid-template-columns:1fr}}
</style>`;
}
