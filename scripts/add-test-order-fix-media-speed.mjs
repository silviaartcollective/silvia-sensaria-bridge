import fs from 'node:fs';

function mustReplace(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Patch target not found: ${label}`);
  return text.replace(from, to);
}

{
  const path = 'src/server.mjs';
  let text = fs.readFileSync(path, 'utf8');

  text = mustReplace(
    text,
    `import { renderProductCreator } from './product-creator.mjs';`,
    `import { renderProductCreator } from './product-creator.mjs';\nimport { renderTestOrderPage } from './test-order-page.mjs';\nimport { buildTestReceipt } from './test-order.mjs';\nimport { etsyReceiptToSensariaCsvFromR2 } from './fulfillment.mjs';`,
    'server imports'
  );

  text = text.replace(
    `const MOCKUP_ORDER_TEMPLATE_KEY = 'presets/mockup-order-template-v2.json';`,
    `const MOCKUP_ORDER_TEMPLATE_KEY = 'presets/mockup-order-template-v3.json';`
  );

  const mediaStart = text.indexOf('async function prepareMediaPlan({ session, manifest }) {');
  const mediaEnd = text.indexOf('async function uploadPreparedMediaToEtsy({ session, listingId, manifest, plan }) {');
  if (mediaStart < 0 || mediaEnd < 0 || mediaEnd <= mediaStart) throw new Error('prepareMediaPlan block not found');

  const newPrepare = `async function prepareMediaPlan({ session, manifest }) {
  const customMedia = Array.isArray(manifest?.mockups) ? manifest.mockups : [];
  const presetStatus = await presetMediaStatus();
  if (!presetStatus.configured) {
    throw new Error('The 3 preset images + listing video are not installed in R2 yet.');
  }

  const reference = currentMockupReference(session);
  const customImages = customMedia.filter((item) =>
    String(item?.contentType || '').startsWith('image/')
  );

  // The established Silvia listing layout has preset images interleaved at
  // Etsy IMAGE ranks 2, 5 and 15. The listing video is separate and Etsy shows
  // it as the second featured tile automatically. Match only artwork-specific
  // mockups against the remaining reference-image slots.
  const presetImageRanks = new Map([
    [2, 'choose-option'],
    [5, 'choose-frame'],
    [15, 'promotion']
  ]);

  if (!reference) {
    throw new Error('No locked Etsy mockup reference is available. Open Product Creator once to cache an active listing template.');
  }

  const referenceCustomImages = (reference.images || []).filter((_, index) =>
    !presetImageRanks.has(index + 1)
  );

  const sortResult = customImages.length
    ? await sortCustomMockupsByReference({
        customMedia: customImages,
        referenceImages: referenceCustomImages,
        getObject: getArtworkObject
      })
    : {
        items: [],
        applied: true,
        reason: 'no custom mockups',
        averageScore: null,
        matches: []
      };

  if (customImages.length >= 2 && (
    !sortResult.applied ||
    (sortResult.matches || []).length !== customImages.length
  )) {
    throw new Error(
      \`Exact mockup ordering could not be matched to #\${reference.listingId}. \${sortResult.reason || 'Every uploaded mockup must match one template slot.'}\`
    );
  }

  const presetByRole = new Map(PRESET_MEDIA.map((item) => [item.role, {
    key: item.key,
    contentType: item.contentType,
    originalFilename: item.filename,
    presetRole: item.role
  }]));

  const orderedImages = [];
  let customIndex = 0;
  const totalImageCount = customImages.length + 3;
  for (let rank = 1; rank <= totalImageCount; rank += 1) {
    const presetRole = presetImageRanks.get(rank);
    if (presetRole && presetByRole.get(presetRole)) {
      orderedImages.push(presetByRole.get(presetRole));
    } else if (sortResult.items[customIndex]) {
      orderedImages.push(sortResult.items[customIndex]);
      customIndex += 1;
    }
  }
  while (customIndex < sortResult.items.length) {
    orderedImages.push(sortResult.items[customIndex]);
    customIndex += 1;
  }

  const videoPreset = presetByRole.get('video');
  const mediaItems = videoPreset ? [...orderedImages, videoPreset] : orderedImages;
  const existingImages = new Map((manifest.etsyMedia?.images || []).map((item) => [item.key, item]));
  const preparedBuffers = sortResult.preparedBuffers instanceof Map
    ? sortResult.preparedBuffers
    : new Map();

  const needBuffers = mediaItems.filter((item) => {
    if (String(item.contentType || '').startsWith('video/')) {
      return !(manifest.etsyMedia?.video?.videoId && manifest.etsyMedia?.video?.key === item.key);
    }
    return !existingImages.get(item.key)?.listingImageId && !preparedBuffers.has(item.key);
  });

  const fetched = await mapWithConcurrency(needBuffers, 6, async (item) => {
    const object = await getArtworkObject(item.key);
    return [item.key, object];
  });
  const objectByKey = new Map(fetched);

  for (const [key, buffer] of preparedBuffers.entries()) {
    objectByKey.set(key, { body: buffer, contentType: null });
  }

  return {
    mediaItems,
    objectByKey,
    sort: {
      applied: Boolean(sortResult.applied),
      reason: sortResult.reason || null,
      averageScore: sortResult.averageScore ?? null,
      referenceListingId: reference?.listingId || null,
      referenceTitle: reference?.title || null,
      presetImageRanks: Object.fromEntries([...presetImageRanks.entries()].map(([rank, role]) => [role, rank])),
      matches: sortResult.matches || []
    }
  };
}

`;
  text = text.slice(0, mediaStart) + newPrepare + text.slice(mediaEnd);

  const uploadStart = text.indexOf('async function uploadPreparedMediaToEtsy({ session, listingId, manifest, plan }) {');
  const uploadEnd = text.indexOf('async function applyAllListingAttributes({ session, listingId, body, properties }) {');
  if (uploadStart < 0 || uploadEnd < 0 || uploadEnd <= uploadStart) throw new Error('uploadPreparedMediaToEtsy block not found');

  const newUpload = `async function uploadPreparedMediaToEtsy({ session, listingId, manifest, plan }) {
  manifest.etsyMedia ||= { images: [], video: null };
  const existingImages = new Map((manifest.etsyMedia.images || []).map((item) => [item.key, item]));
  const imageItems = plan.mediaItems
    .filter((item) => String(item.contentType || '').startsWith('image/'))
    .map((item, index) => ({ item, rank: index + 1 }));
  const videoItem = plan.mediaItems.find((item) => String(item.contentType || '').startsWith('video/')) || null;

  // Two upload workers are materially faster than fully serial uploads while
  // still respecting Etsy's short listing lock. Any 409 is retried with backoff.
  const uploadedImages = new Array(imageItems.length);
  await mapWithConcurrency(imageItems, 2, async ({ item, rank }, index) => {
    const existing = existingImages.get(item.key);
    if (existing?.listingImageId) {
      uploadedImages[index] = { ...existing, rank };
      return;
    }

    const object = plan.objectByKey.get(item.key) || await getArtworkObject(item.key);
    const filename = String(item.originalFilename || item.key.split('/').pop() || 'listing-image.jpg');
    const uploaded = await withEtsyListingRetry(() => uploadListingImage({
      shopId: session.shop.shop_id,
      listingId,
      imageBuffer: object.body,
      filename,
      contentType: object.contentType || item.contentType || 'image/jpeg',
      rank,
      altText: manifest.title || '',
      keystring: session.keystring,
      sharedSecret: session.sharedSecret,
      accessToken: session.accessToken
    }), { attempts: 8, baseDelayMs: 180 });

    uploadedImages[index] = {
      listingImageId: uploaded.listing_image_id || null,
      key: item.key,
      filename,
      rank
    };
  });

  let video = manifest.etsyMedia.video || null;
  if (
    videoItem &&
    !(manifest.etsyMedia.video?.videoId && manifest.etsyMedia.video?.key === videoItem.key)
  ) {
    const object = plan.objectByKey.get(videoItem.key) || await getArtworkObject(videoItem.key);
    const filename = String(videoItem.originalFilename || videoItem.key.split('/').pop() || 'listing-video.mov');
    const uploaded = await withEtsyListingRetry(() => uploadListingVideo({
      shopId: session.shop.shop_id,
      listingId,
      videoBuffer: object.body,
      filename,
      contentType: object.contentType || videoItem.contentType || 'video/quicktime',
      keystring: session.keystring,
      sharedSecret: session.sharedSecret,
      accessToken: session.accessToken
    }), { attempts: 8, baseDelayMs: 180 });
    video = {
      videoId: uploaded.video_id || null,
      key: videoItem.key,
      filename
    };
  }

  // Persist media state once instead of doing an R2 manifest write after every
  // image. This removes a large number of network round-trips during drafts.
  manifest.etsyMedia.images = uploadedImages.filter(Boolean).sort((a, b) => a.rank - b.rank);
  manifest.etsyMedia.video = video;
  manifest.mockupSort = plan.sort;
  await saveArtworkManifest(manifest);

  return {
    imageCount: manifest.etsyMedia.images.length,
    videoUploaded: Boolean(video?.videoId),
    mockupSort: plan.sort
  };
}

`;
  text = text.slice(0, uploadStart) + newUpload + text.slice(uploadEnd);

  const routeMarker = `  if (req.method === 'GET' && url.pathname === '/product-creator') {`;
  const newRoutes = `  if (req.method === 'GET' && url.pathname === '/test-order') {
    if (!requireAdminPage(req, res, '/test-order')) return;
    return sendHtml(res, 200, renderTestOrderPage());
  }

  if (req.method === 'POST' && url.pathname === '/api/test-order') {
    if (!requireAdminApi(req, res)) return;
    const startedAt = Date.now();
    try {
      const body = await readJsonBody(req);
      const { meta, receipt } = buildTestReceipt(body);
      const manifest = await loadArtworkManifest(meta.artworkId);
      if (!manifest?.master?.key || manifest.status !== 'ready') {
        throw new Error(\`Artwork \${meta.artworkId} is not ready in R2. Create/upload that artwork first.\`);
      }

      const result = await etsyReceiptToSensariaCsvFromR2(receipt);
      const refreshedManifest = await loadArtworkManifest(meta.artworkId);
      const productionEntry = refreshedManifest?.production?.[\`\${meta.format}|\${meta.size}|\${meta.orientation}\`];
      const spec = productionEntry?.spec || {};
      const output = spec.output || null;
      const row = result.rows?.[0] || {};

      return sendJson(res, 200, {
        ok: true,
        dryRun: true,
        submittedToSensaria: false,
        reference: meta.reference,
        sku: meta.sku,
        friendlySku: row.FriendlySKU || null,
        productionKey: productionEntry?.key || null,
        production: {
          kind: spec.kind || null,
          dpi: spec.dpi || null,
          output,
          face: spec.face || null,
          mirrorBleedPx: spec.mirrorBleedPx || 0,
          safeInsetPx: spec.safeInsetPx || 0,
          template: spec.template || null
        },
        rows: result.rows,
        csv: result.csv,
        timingMs: Date.now() - startedAt
      });
    } catch (error) {
      return sendJson(res, 400, {
        ok: false,
        dryRun: true,
        submittedToSensaria: false,
        error: error?.message || String(error),
        timingMs: Date.now() - startedAt
      });
    }
  }

` + routeMarker;
  text = mustReplace(text, routeMarker, newRoutes, 'test order routes');

  fs.writeFileSync(path, text);
}

{
  const path = 'src/dashboard.mjs';
  let text = fs.readFileSync(path, 'utf8');
  text = text.replace(
    `<a class="nav" href="#orders">Orders</a>`,
    `<a class="nav" href="/test-order">Test Order</a>\n    <a class="nav" href="#orders">Orders</a>`
  );
  text = text.replace(
    `<div class="actions"><a class="btn primary" href="/r2/status" target="_blank">Check R2 storage</a><a class="btn" href="/etsy/status" target="_blank">Check Etsy connection</a></div>`,
    `<div class="actions"><a class="btn primary" href="/test-order">Run dry test order</a><a class="btn" href="/r2/status" target="_blank">Check R2 storage</a><a class="btn" href="/etsy/status" target="_blank">Check Etsy connection</a></div>`
  );
  fs.writeFileSync(path, text);
}

console.log('Test order, exact preset mockup ranks and faster draft media upload patched.');
