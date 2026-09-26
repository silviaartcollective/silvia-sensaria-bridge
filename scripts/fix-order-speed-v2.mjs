import fs from 'node:fs';

const path = 'src/server.mjs';
let text = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  if (!text.includes(from)) throw new Error(`Could not find patch target: ${label}`);
  text = text.replace(from, to);
}

replaceOnce(
  "import http from 'node:http';\nimport { readFileSync } from 'node:fs';",
  "import http from 'node:http';\nimport { readFileSync } from 'node:fs';\nimport sharp from 'sharp';",
  'sharp import'
);

replaceOnce(
  "const MOCKUP_ORDER_TEMPLATE_KEY = 'presets/mockup-order-template-v3.json';",
  `const MOCKUP_ORDER_TEMPLATE_KEY = 'presets/mockup-order-template-v3.json';\n\n// The v3 locked template is the exact reference that produced the user's latest\n// test draft. Its custom-image slots are stable, but that reference's custom\n// order differs from the shop's canonical 15-image layout. This remap converts\n// those 12 identified custom slots into the exact established Silvia order.\n// Preset images are inserted separately at image ranks 2, 5 and 15.\nconst SILVIA_CANONICAL_CUSTOM_REMAP_15 = [1, 10, 0, 11, 7, 9, 8, 6, 5, 3, 2, 4];\n\nfunction canonicalCustomMockupOrder(items) {\n  const values = Array.from(items || []);\n  if (values.length !== SILVIA_CANONICAL_CUSTOM_REMAP_15.length) return values;\n  return SILVIA_CANONICAL_CUSTOM_REMAP_15.map((index) => values[index]).filter(Boolean);\n}\n\nasync function optimizeEtsyImageObject(object) {\n  if (!object?.body) return object;\n  try {\n    const optimized = await sharp(object.body, { failOn: 'none' })\n      .rotate()\n      .resize({\n        width: 2400,\n        height: 2400,\n        fit: 'inside',\n        withoutEnlargement: true\n      })\n      .jpeg({\n        quality: 92,\n        chromaSubsampling: '4:4:4',\n        progressive: true\n      })\n      .toBuffer();\n    return {\n      ...object,\n      body: optimized,\n      contentType: 'image/jpeg',\n      originalBytes: object.body.length,\n      uploadBytes: optimized.length\n    };\n  } catch {\n    return object;\n  }\n}`,
  'mockup constants/helpers'
);

replaceOnce(
  `  const presetByRole = new Map(PRESET_MEDIA.map((item) => [item.role, {\n    key: item.key,\n    contentType: item.contentType,\n    originalFilename: item.filename,\n    presetRole: item.role\n  }]));\n\n  const orderedImages = [];\n  let customIndex = 0;`,
  `  const presetByRole = new Map(PRESET_MEDIA.map((item) => [item.role, {\n    key: item.key,\n    contentType: item.contentType,\n    originalFilename: item.filename,\n    presetRole: item.role\n  }]));\n\n  // Convert the stable v3 reference-slot identities into the exact canonical\n  // 15-image shop layout shown in the approved Etsy listing.\n  const canonicalCustomItems = canonicalCustomMockupOrder(sortResult.items);\n\n  const orderedImages = [];\n  let customIndex = 0;`,
  'canonical item setup'
);

replaceOnce(
  `    } else if (sortResult.items[customIndex]) {\n      orderedImages.push(sortResult.items[customIndex]);\n      customIndex += 1;\n    }\n  }\n  while (customIndex < sortResult.items.length) {\n    orderedImages.push(sortResult.items[customIndex]);\n    customIndex += 1;\n  }`,
  `    } else if (canonicalCustomItems[customIndex]) {\n      orderedImages.push(canonicalCustomItems[customIndex]);\n      customIndex += 1;\n    }\n  }\n  while (customIndex < canonicalCustomItems.length) {\n    orderedImages.push(canonicalCustomItems[customIndex]);\n    customIndex += 1;\n  }`,
  'canonical item usage'
);

replaceOnce(
  `  const fetched = await mapWithConcurrency(needBuffers, 6, async (item) => {\n    const object = await getArtworkObject(item.key);\n    return [item.key, object];\n  });\n  const objectByKey = new Map(fetched);\n\n  for (const [key, buffer] of preparedBuffers.entries()) {\n    objectByKey.set(key, { body: buffer, contentType: null });\n  }`,
  `  const fetched = await mapWithConcurrency(needBuffers, 6, async (item) => {\n    const object = await getArtworkObject(item.key);\n    return [item.key, object];\n  });\n  const objectByKey = new Map(fetched);\n\n  for (const [key, buffer] of preparedBuffers.entries()) {\n    objectByKey.set(key, { body: buffer, contentType: null });\n  }\n\n  // Etsy image upload latency is dominated by transferring large mockup files.\n  // 2400 px / quality 92 remains well above Etsy thumbnail/display needs while\n  // dramatically reducing payload size. The R2 originals are never modified.\n  const imageKeys = mediaItems\n    .filter((item) => String(item.contentType || '').startsWith('image/'))\n    .map((item) => item.key);\n  await mapWithConcurrency(imageKeys, 3, async (key) => {\n    const object = objectByKey.get(key);\n    if (!object) return;\n    objectByKey.set(key, await optimizeEtsyImageObject(object));\n  });`,
  'upload image optimization'
);

replaceOnce(
  `      presetImageRanks: Object.fromEntries([...presetImageRanks.entries()].map(([rank, role]) => [role, rank])),\n      matches: sortResult.matches || []`,
  `      presetImageRanks: Object.fromEntries([...presetImageRanks.entries()].map(([rank, role]) => [role, rank])),\n      canonicalLayoutApplied: canonicalCustomItems.length === 12,\n      canonicalLayoutVersion: canonicalCustomItems.length === 12 ? 'silvia-15-v1' : null,\n      matches: sortResult.matches || []`,
  'sort metadata'
);

replaceOnce(
  `  const uploadedImages = new Array(imageItems.length);\n  await mapWithConcurrency(imageItems, 2, async ({ item, rank }, index) => {`,
  `  const uploadStartedAt = Date.now();\n  let originalImageBytes = 0;\n  let uploadImageBytes = 0;\n  const uploadedImages = new Array(imageItems.length);\n  await mapWithConcurrency(imageItems, 2, async ({ item, rank }, index) => {`,
  'media upload timing start'
);

replaceOnce(
  `    const object = plan.objectByKey.get(item.key) || await getArtworkObject(item.key);\n    const filename = String(item.originalFilename || item.key.split('/').pop() || 'listing-image.jpg');`,
  `    const object = plan.objectByKey.get(item.key) || await getArtworkObject(item.key);\n    originalImageBytes += Number(object.originalBytes || object.body?.length || 0);\n    uploadImageBytes += Number(object.uploadBytes || object.body?.length || 0);\n    const filename = String(item.originalFilename || item.key.split('/').pop() || 'listing-image.jpg');`,
  'media byte metrics'
);

replaceOnce(
  `  return {\n    imageCount: manifest.etsyMedia.images.length,\n    videoUploaded: Boolean(video?.videoId),\n    mockupSort: plan.sort\n  };`,
  `  return {\n    imageCount: manifest.etsyMedia.images.length,\n    videoUploaded: Boolean(video?.videoId),\n    mockupSort: plan.sort,\n    timing: {\n      uploadMs: Date.now() - uploadStartedAt,\n      originalImageBytes,\n      uploadImageBytes,\n      compressionRatio: originalImageBytes > 0\n        ? Number((uploadImageBytes / originalImageBytes).toFixed(3))\n        : null\n    }\n  };`,
  'media return timing'
);

// Add stage timings to draft setup response so the next real test tells us\n// exactly what remains slow instead of relying on the single total number.
replaceOnce(
  `    const startedAt = Date.now();\n    try {\n      const session = await getEtsySession();`,
  `    const startedAt = Date.now();\n    const stageTiming = {};\n    try {\n      const sessionStartedAt = Date.now();\n      const session = await getEtsySession();\n      stageTiming.sessionMs = Date.now() - sessionStartedAt;`,
  'draft session timing'
);

replaceOnce(
  `      const taxonomyPromise = getCachedTaxonomyProperties(session, body.taxonomy_id);\n      const mediaPlanPromise = prepareMediaPlan({ session, manifest });`,
  `      const prepStartedAt = Date.now();\n      const taxonomyPromise = getCachedTaxonomyProperties(session, body.taxonomy_id);\n      const mediaPlanPromise = prepareMediaPlan({ session, manifest }).then((value) => {\n        stageTiming.mediaPrepareMs = Date.now() - prepStartedAt;\n        return value;\n      });`,
  'draft prep timing'
);

replaceOnce(
  `        draft = await createDraftListing({`,
  `        const createStartedAt = Date.now();\n        draft = await createDraftListing({`,
  'draft create timing start'
);

replaceOnce(
  `        manifest.etsyDraftListingId = draft.listing_id;`,
  `        stageTiming.createDraftMs = Date.now() - createStartedAt;\n        manifest.etsyDraftListingId = draft.listing_id;`,
  'draft create timing end'
);

replaceOnce(
  `      await withEtsyListingRetry(() => updateListingInventory({`,
  `      const inventoryStartedAt = Date.now();\n      await withEtsyListingRetry(() => updateListingInventory({`,
  'inventory timing start'
);

replaceOnce(
  `      const properties = await taxonomyPromise;`,
  `      stageTiming.inventoryMs = Date.now() - inventoryStartedAt;\n\n      const properties = await taxonomyPromise;`,
  'inventory timing end'
);

replaceOnce(
  `      const attributes = await applyAllListingAttributes({`,
  `      const attributesStartedAt = Date.now();\n      const attributes = await applyAllListingAttributes({`,
  'attributes timing start'
);

replaceOnce(
  `      const mediaPlan = await mediaPlanPromise;`,
  `      stageTiming.attributesMs = Date.now() - attributesStartedAt;\n\n      const mediaPlan = await mediaPlanPromise;`,
  'attributes timing end'
);

replaceOnce(
  `      const media = await uploadPreparedMediaToEtsy({`,
  `      const mediaStartedAt = Date.now();\n      const media = await uploadPreparedMediaToEtsy({`,
  'media timing start'
);

replaceOnce(
  `      manifest.etsyConfiguredAt = new Date().toISOString();`,
  `      stageTiming.mediaUploadMs = Date.now() - mediaStartedAt;\n      stageTiming.mediaUploadDetail = media.timing || null;\n\n      manifest.etsyConfiguredAt = new Date().toISOString();`,
  'media timing end'
);

replaceOnce(
  `        timing: {\n          totalMs: Date.now() - startedAt\n        },`,
  `        timing: {\n          totalMs: Date.now() - startedAt,\n          ...stageTiming\n        },`,
  'timing response'
);

fs.writeFileSync(path, text);
console.log('Applied canonical mockup order, upload optimization, and detailed timing.');
