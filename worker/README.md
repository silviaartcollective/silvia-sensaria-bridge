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

## Photoshop PSD mockup generation

The **same running worker** now processes two queues: production artwork crops and PSD mockups from Silvia and Japandi Product Creator. Arté Antica remains connected for its existing crop jobs.

- Product Creator uploads the master image and PSDs directly to private R2, then creates a mockup batch automatically. It **does not** open PSDs or run Photopea in your browser.
- The PC worker downloads one PSD and master artwork to local temporary files, opens that PSD in a separate background Chromium session, replaces only its selected **visible Smart Object**, verifies all original layer visibility, exports a maximum **24-megapixel JPEG**, and uploads it to R2.
- Jobs continue without the Product Creator tab being open. Progress and thumbnails appear when the page is reopened. Checkboxes (selected by default), Select all, Deselect all, and Apply selected determine which seven custom mockups accompany the three preset Etsy images.
- For **mockup 19.psd**, the visible artwork Smart Object is named **5**. The other Smart Object is hidden and must stay hidden. Large files can take several minutes; errors appear against the affected PSD instead of indefinitely freezing the browser.
- **On your Windows PC:** update this repository's worker folder, close the old shared worker when idle, run `worker/setup-worker.cmd` (press Enter to keep previously saved per-shop tokens), and launch `worker/start-worker.cmd` once. The new PSD renderer needs **Chrome or Microsoft Edge** and the Puppeteer Core package installed by setup.
- You can examine `worker/worker.log` for PSD loading, processing and export errors. Generated JPGs and templates are only stored under the originating shop's namespace.
- Real PSD rendering still requires validation on the user's Windows workstation: Render deployments alone do not update installed PC worker files.


## Faster rendering: native Photoshop (worker v4.1.0)

On **Windows**, the shared worker now prefers **installed Adobe Photoshop** for PSD Smart Object replacement, using native Photoshop scripting. This avoids repeatedly launching Chromium, starting Photopea and waiting for Photopea's Smart Object editor. **Photopea is used as a fallback only if native Photoshop COM automation is unavailable.** Existing production crop processing remains unchanged.

**After pulling the latest code**: wait for the current crop to finish, stop the old worker, update the single shared worker folder, run `setup-worker.cmd` (press Enter to retain your saved shop tokens), and run `start-worker.cmd`. The Product Creator status should display **Crop + Mockup Worker v4.1.0**. Do not run separate workers for Silvia and Japandi. If desktop Photoshop is installed, watch `worker.log` for `native Photoshop` and per-PSD elapsed seconds. If you see `Photopea fallback`, check Photoshop installation/COM registration and the log.

Original PSDs are never overwritten. Hidden layers remain hidden. JPGs are validated at a maximum of 24 megapixels. A bounded, private on-disk cache in `%LOCALAPPDATA%\\pod-worker-cache\\v1` reuses PSD templates and master images between jobs; it defaults to 4 GB and evicts old files. You may delete this folder while the worker is stopped to reclaim disk space. Set `POD_WORKER_CACHE_GB` to adjust its limit or `POD_PSD_RENDERER=photopea` to force the original renderer.

**Performance expectations:** small cached mockups can be considerably faster, but opening a complex 194 MB PSD and exporting a 24MP JPG may still take longer than a few seconds, depending on PC hardware and the document. Measure actual times from `worker.log` before claiming a performance target. A stuck Smart Object operation will time out, be logged as a failure and allow the worker to continue.

