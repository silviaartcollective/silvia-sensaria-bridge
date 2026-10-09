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
