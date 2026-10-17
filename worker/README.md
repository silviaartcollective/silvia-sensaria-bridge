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
- After that, each mockup is a warp and composite: typically **1–3 seconds** plus the R2 upload. The worker claims the next PSD as soon as one finishes.
- If a PSD has several visible Smart Objects, choose the artwork layer once in the Product Creator. The choice is saved with the template.

**Template requirements:**
- RGB, 8 bits/channel, saved with **Maximize PSD and PSB File Compatibility** turned on.
- The artwork Smart Object uses Normal blending at 100% opacity.
- The artwork Smart Object has no Warp transform and no Smart Filters.

Any other layers, adjustments and effects in the scene are fine.

**After pulling this update on the PC:**
1. Wait for the current job to finish and stop the old worker.
2. Update the single shared worker folder.
3. Run `setup-worker.cmd` (press Enter to keep your saved tokens).
4. Run `start-worker.cmd`.

The dashboards should show **Crop + Mockup Worker v4.5.1**. `worker.log` prints a `PSD_TIMINGS` line per mockup. The PSD/artwork download cache (`%LOCALAPPDATA%\pod-worker-cache\v1`, 4 GB by default, `POD_WORKER_CACHE_GB` to change) and the prepared-template cache can both be deleted while the worker is stopped.
