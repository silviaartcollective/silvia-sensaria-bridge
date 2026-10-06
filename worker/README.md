# Silvia Crop Worker

This folder contains the local Windows worker used by Silvia Art Collective to generate full-resolution POD aspect-ratio crops.

The worker mirrors the Arté Antica crop architecture:

- downloads the private R2 master through a temporary signed URL
- generates 2x3, 3x4, 4x5 and 11x14 production JPEGs at 300 DPI
- uploads each crop directly to private R2 with temporary signed PUT URLs
- reports progress back to the Silvia Render app
- never stores R2 access keys on the PC

## Setup

1. Add a long random `CROP_WORKER_TOKEN` environment variable to the Silvia Render service.
2. In this folder run `npm install`.
3. Copy `config.example.json` to `config.local.json`.
4. Set `appUrl` to `https://silvia-sensaria-bridge.onrender.com`.
5. Set `workerToken` to the same value as Render's `CROP_WORKER_TOKEN`.
6. Run `npm start` whenever you want the workstation to process queued crop jobs.

`config.local.json` must stay private and should never be committed.
