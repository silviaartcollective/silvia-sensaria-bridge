# Shared PC Crop Worker — Arté Antica, Silvia and Japandi

**Only run one worker process on the PC.** This same program handles all three Render apps. You may install it from any one app's repository; do not install or launch three separate workers.

## Installation (Windows)

1. In each Render app, check **Environment → CROP_WORKER_TOKEN**. Use a unique secret (24+ characters) for each app, or retain each app's existing secret. Never copy a token into chat or GitHub.
2. Stop any currently running individual shop cropper windows/processes before switching.
3. Download or update **one** repository (Arté Antica, Silvia or Japandi). Open its \`worker\` folder.
4. Run \`setup-worker.cmd\` once. Supply **all three** tokens when asked; press Enter only if it offers to reuse a saved token. Each shop's URL is prefilled.
5. Run \`start-worker.cmd\` once. This starts the background worker; check \`worker.log\` for its current status.
6. Check the PC Crop Worker indicator in each Render dashboard. Within approximately 10–30 seconds all three should display **Connected**.
7. Test one non-production crop job and verify output ratios and tracking from the initiating shop.

The installer registers \`pod-crop-worker://start\` and compatibility aliases \`arteantica-worker://\`, \`silvia-worker://\`, and \`japandi-worker://\`. All four launch the same program. A global lock prevents a second process even if several dashboards request launch.

The shared worker continuously polls the three queues in round-robin order and handles **one job at a time** to protect PC memory. While Arté is cropping, Silvia and Japandi also receive regular worker heartbeats so their indicators stay connected. Results and R2 signed URLs are returned only to the shop which queued that job, using that shop's bearer token.

The default idle timeout is **disabled**: the worker stays running until stopped. Existing historical 600000ms (10-minute) configurations are treated as disabled; setting \`POD_CROP_WORKER_IDLE_EXIT_MS\` to a positive number explicitly enables idle shutdown.

## Troubleshooting

- **Offline on one shop:** Verify its URL and token in \`worker/config.local.json\` match that Render service's \`CROP_WORKER_TOKEN\`; inspect \`worker.log\`.
- **Worker not starting:** Check Node.js 20+, that \`npm install\` succeeded, and Sharp can load. Retry setup if needed.
- **Legacy separate workers:** Close them and rerun the shared installer. Do not leave old individual workers running in parallel.
- **Never post \`config.local.json\`:** It contains confidential tokens and is covered by \`.gitignore\`.

## PSD mockup generation (worker v4.5.0)

The **same running worker** processes two queues: production artwork crops and PSD mockups from the Product Creator. PSDs are rendered **entirely by the worker's own Node process**: no Photoshop, no Photopea, and no Chrome/Edge.

- Product Creator uploads the master image and PSDs to private R2 and creates a mockup batch. The browser never opens a PSD; the batch continues with the tab closed.
- The first time the worker sees a PSD it **prepares** it (a few seconds to a minute for very large files) and caches the result in `%LOCALAPPDATA%\pod-worker-cache\native-psd-v2`:
  - Photoshop's own saved composite is kept as the background, so layers below the artwork are reproduced exactly;
  - the artwork Smart Object's four corners give its placement, including perspective;
  - its layer mask and clipping give the visible area;
  - layers above it (shadows, glare, frames, plants) are kept with their blend mode, opacity, masks and clipping.
- Each preparation is checked against Photoshop's composite using the Smart Object's original pixels. If the template cannot be reproduced exactly, that PSD fails with the reason; a wrong mockup is never produced.
- After that, each mockup is a warp and composite, typically about a second plus the R2 upload.
- **It uses the whole PC.** Several mockups render at once, one per render thread: half the CPU cores, between 2 and 6. Production crops run alongside instead of making mockups wait. Only one first-time template preparation runs at a time, because it reads the whole PSD into memory. Set `POD_MOCKUP_CONCURRENCY` to change the number of parallel renders.
- Close-ups: when the artwork Smart Object reaches past the canvas and its mask or frame shows only part of it, the artwork's own corner or edge goes where the frame opening has one, at the template's zoom (v4.7.4). A corner close-up shows the corner of the painting, not its middle.
- If a PSD has several visible Smart Objects, the top one in the Layers panel is the artwork unless another one is clearly it (a placeholder name, or a frame ring or texture on top) (v4.7.1). To use another one, choose the artwork layer in the Product Creator; the choice is saved with the template.

**Template requirements:**
- RGB or grayscale, 8 or 16 bits/channel.
- The artwork Smart Object has no Warp transform (perspective is fine). Its blend mode (e.g. Multiply, so paper texture shows through) and opacity are kept.

PSDs saved with **Maximize PSD and PSB File Compatibility** turned on are reproduced most faithfully, including effects and adjustment layers. Without it, Photoshop saves no usable preview, so the worker builds the scene from the layers. Layer effects (e.g. drop shadows) and adjustment layers are then left out.


**Instant start:**
- When you pick the master artwork in the Product Creator, the page hands the file straight to the worker on this PC (`127.0.0.1:47823`, reachable only from this computer) and queues the batch at once. The worker renders from the original file instead of downloading it back from R2.
- The R2 upload runs alongside for the Etsy draft and production crops, and the batch is linked to the artwork when it finishes.
- Chrome may ask once to let the shop's site access apps on this device: allow it. If the worker is not reachable, the page uploads the artwork to R2 as before.
- Each handoff carries a code derived from the shop's `CROP_WORKER_TOKEN`, so other websites cannot send files to the worker.
- The worker keeps a request open with each shop, so a new batch starts immediately instead of on the next poll.
- While idle, it prepares every saved template in advance (one at a time, pausing whenever mockups are rendering). A new artwork never waits for a PSD download or a first-time preparation, and prepared templates are not downloaded again.

**Stopping the worker:** it runs hidden in the background, so there is no window to close. Run `stop-worker.cmd` (or end the Node.js process in Task Manager). Dashboards show it offline about 20 seconds later. Opening an admin page while it is offline asks Windows to start it again.

## Mockup folder on the PC (v4.7.0)

PSD templates can stay in a folder on this PC instead of being uploaded:

- **Choosing the folder:** in the Product Creator, set **Mockup folder on the PC** (for example `D:\Mockups\Silvia`). Each shop can have its own folder. A `"mockupFolder"` set for a shop in `config.local.json` takes priority.
- **Scanning:** every 15 seconds the worker scans the folder and its subfolders for `.psd` and `.psb` files and tells the shop. New PSDs appear in the template list, marked **PC**, and deleted ones disappear.
- **Editing:** an edited PSD is picked up on the next scan and prepared again while the worker is idle. Nothing is ever uploaded to or downloaded from R2; mockups render straight from the files.
- **Orientation:** subfolders named **Vertical**, **Horizontal**, **Square** or **Panoramic** set it. Otherwise the worker tells it from the shape of the artwork layer once the PSD is prepared (1.85:1 or wider is panoramic, v4.7.3). Choosing an orientation in the template list overrides both.
- **Panoramic artwork** (1.85:1 or wider, like its Etsy panoramic sizes) gets the panoramic templates only; other horizontal artwork gets the horizontal ones.
- **Settings stay put:** each PSD keeps its settings (artwork layer, orientation) as long as it keeps its name and place in the folder.
- **Removing templates:** delete or move the file; templates from the folder cannot be deleted in the app.

Uploading PSDs through the Product Creator still works, and both kinds can be used together.

## Updates

From **v4.6.0** the worker updates itself. Every heartbeat reply from the Silvia app names the latest worker version, which is the one in the code Render deployed.

- **Download:** when a newer version appears, the worker downloads it in the background and checks every file's SHA-256. Only the worker's own files are replaced; `config.local.json` and the logs are kept, and an older version is never installed.
- **Install:** once no crop or mockup has run for 30 seconds, the worker finishes what it is doing and exits. `update-worker.mjs` then installs the files, runs `npm install` if the dependencies changed, starts the worker again and checks it stays running.
- **Rollback:** if the new worker does not start, the previous files are restored and the old worker is started again. That version is not retried for six hours.
- **Status:** the Product Creator and the dashboard show *outdated · downloading*, *installs as soon as the current work is done* and *updating…*. Progress is written to `update.log`.
- **Update now:** run `update-worker.cmd`. It stops the worker, so a job in progress is retried by its shop.
- **Settings** (`config.local.json`): `"autoUpdate": false` turns automatic updates off; the status then shows *outdated* and `update-worker.cmd` updates on demand. `"updateFrom"` chooses another shop's Render URL as the source.

**Installing v4.6.0 itself** (older workers cannot update themselves):
1. Wait for the current job to finish and run `stop-worker.cmd`.
2. Replace the files in the single shared worker folder with the new ones. Keep `config.local.json`.
3. Run `setup-worker.cmd` (press Enter to keep your saved tokens).
4. Run `start-worker.cmd`.

**Uploads (v4.7.5):** a mockup is ready as soon as its 900 px preview and 2400 px Etsy copy are in R2. The full-size JPG (about three quarters of the bytes) follows once the worker has had nothing else to do for a few seconds, one at a time, so a home connection is not shared with it while a batch renders. Until it arrives, downloads give the Etsy copy. Pending full-size JPGs are kept in `%LOCALAPPDATA%\pod-worker-cache\full-jpg` and resumed after a restart or update.

**Never stuck (v4.7.6):** one PSD never holds up or pauses the rest of its batch. A render that runs longer than 5 minutes (a first-time preparation: 10 minutes plus 2 per 100 MB of PSD, at most 45; `POD_RENDER_TIMEOUT_MINUTES` / `POD_PREPARE_TIMEOUT_MINUTES` to change) is stopped and its thread replaced. Uploads are retried when the connection drops. A PSD that fails for a temporary reason goes back in the queue, up to 3 tries. Advance template preparation steps aside when a batch needs that slot. Masters larger than 6000 px are shrunk once per batch to a 6000 px copy (the size renders use), so render threads no longer each decode the full master.

**Template previews (v4.7.7):** once a PSD is prepared, the worker sends the shop a small (480 px) picture of its scene, once per version of the file, so Daily Listings can show what each mockup and preset looks like.

**OneDrive folders (v4.7.8):** a mockup folder kept in OneDrive is read too: its files and folders are cloud placeholders, which Windows lists as links, so the worker checks what each one really is.

**Restarts itself (v4.7.9):** `start-worker.cmd` runs the worker under `supervise.mjs`. If the worker stops unexpectedly (a crash, or Windows ending it when memory runs out), it is started again within seconds and carries on with the queued mockups and crops; `worker.log` and each shop's Render log say why it stopped. `stop-worker.cmd` and updates stop it for good (they leave `%TEMP%\pod-crop-worker.lock.stop`, which the next start clears).

**Quiet launches (v4.7.10):** a page that asks for the worker while it is already running no longer flashes "The process cannot access the file because it is being used by another process" (the running worker holds `worker.log`); launch requests are noted in `launch.log`.

The dashboards should show **Crop + Mockup Worker v4.7.10**. `worker.log` prints a `PSD_TIMINGS` line per mockup. The PSD/artwork download cache (`%LOCALAPPDATA%\pod-worker-cache\v1`, 4 GB by default, `POD_WORKER_CACHE_GB` to change) and the prepared-template cache can both be deleted while the worker is stopped.
