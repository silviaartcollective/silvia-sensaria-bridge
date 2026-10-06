import sharp from 'sharp';

const ETSY_API_BASE = 'https://api.etsy.com/v3';
const referenceFingerprintCache = new Map();

function apiHeaders({ keystring, sharedSecret, accessToken }) {
  return {
    'x-api-key': `${keystring}:${sharedSecret}`,
    authorization: `Bearer ${accessToken}`
  };
}

export async function getEtsyListingImages({
  listingId,
  keystring,
  sharedSecret,
  accessToken
}) {
  const response = await fetch(
    `${ETSY_API_BASE}/application/listings/${encodeURIComponent(listingId)}/images`,
    { headers: apiHeaders({ keystring, sharedSecret, accessToken }) }
  );
  if (!response.ok) {
    throw new Error(`Etsy listing images fetch failed (${response.status}): ${await response.text()}`);
  }
  const data = await response.json();
  return (data.results || data || [])
    .slice()
    .sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
}

export async function chooseRecentMockupReference({
  listings,
  keystring,
  sharedSecret,
  accessToken,
  minImages = 4,
  maxCandidates = 8
}) {
  const candidates = (listings || []).slice(0, maxCandidates);
  if (!candidates.length) return null;

  const checked = await Promise.all(
    candidates.map(async (listing, recentIndex) => {
      try {
        const images = await getEtsyListingImages({
          listingId: listing.listing_id,
          keystring,
          sharedSecret,
          accessToken
        });
        return { listing, images, recentIndex };
      } catch {
        return { listing, images: [], recentIndex };
      }
    })
  );

  // Use the newest complete listing, not whichever listing happens to have the
  // largest image count. Silvia listings intentionally share one slot order.
  const selected = checked.find((item) => item.images.length >= minImages)
    || checked.find((item) => item.images.length >= 2)
    || null;
  if (!selected) return null;

  void warmReferenceFingerprints(selected.images, 20).catch(() => {});

  return {
    listingId: selected.listing.listing_id,
    title: selected.listing.title || '',
    imageCount: selected.images.length,
    images: selected.images
  };
}

function referenceImageUrl(image) {
  // Preserve the original composition. The 170x135 rendition is cropped and
  // can make two different room mockups look deceptively similar.
  return image?.url_570xN
    || image?.url_fullxfull
    || image?.url_300x300
    || image?.url_170x135
    || null;
}

function normalizeVector(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const centered = values.map((value) => value - mean);
  const norm = Math.sqrt(centered.reduce((sum, value) => sum + value * value, 0)) || 1;
  return centered.map((value) => value / norm);
}

async function fingerprintImage(input) {
  const width = 64;
  const height = 64;
  const { data, info } = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = Math.max(1, Number(info.channels || 3));
  const structure = [];
  const colour = [];
  const luminance = new Array(width * height).fill(0);

  const centreLeft = Math.floor(width * 0.26);
  const centreRight = Math.ceil(width * 0.74);
  const centreTop = Math.floor(height * 0.15);
  const centreBottom = Math.ceil(height * 0.74);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      const r = Number(data[offset] ?? 0);
      const g = Number(data[offset + Math.min(1, channels - 1)] ?? r);
      const b = Number(data[offset + Math.min(2, channels - 1)] ?? r);
      const gray = (0.299 * r) + (0.587 * g) + (0.114 * b);
      luminance[y * width + x] = gray;

      const insideArtworkZone =
        x >= centreLeft && x < centreRight &&
        y >= centreTop && y < centreBottom;

      // The artwork itself changes listing-to-listing, so only a small amount
      // of its colour influences the match. Room/furniture/frame pixels carry
      // most of the identity of a mockup slot.
      const weight = insideArtworkZone ? 0.12 : 1;
      structure.push(gray * weight);
      colour.push((r / 255) * weight, (g / 255) * weight, (b / 255) * weight);
    }
  }

  const edges = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const insideArtworkZone =
        x >= centreLeft && x < centreRight &&
        y >= centreTop && y < centreBottom;
      if (insideArtworkZone) continue;
      const left = luminance[y * width + (x - 1)];
      const right = luminance[y * width + (x + 1)];
      const up = luminance[(y - 1) * width + x];
      const down = luminance[(y + 1) * width + x];
      edges.push(right - left, down - up);
    }
  }

  return {
    structure: normalizeVector(structure),
    edges: normalizeVector(edges),
    colour
  };
}

function cosineSimilarity(a, b) {
  const length = Math.min(a.length, b.length);
  if (!length) return 0;
  let score = 0;
  for (let i = 0; i < length; i += 1) score += a[i] * b[i];
  return Math.max(-1, Math.min(1, score));
}

function colourSimilarity(a, b) {
  const length = Math.min(a.length, b.length);
  if (!length) return 0;
  let mse = 0;
  for (let i = 0; i < length; i += 1) {
    const delta = a[i] - b[i];
    mse += delta * delta;
  }
  mse /= length;
  return Math.max(0, 1 - Math.sqrt(mse));
}

function descriptorSimilarity(a, b) {
  const structure = (cosineSimilarity(a.structure, b.structure) + 1) / 2;
  const edges = (cosineSimilarity(a.edges, b.edges) + 1) / 2;
  const colour = colourSimilarity(a.colour, b.colour);
  return (structure * 0.5) + (edges * 0.35) + (colour * 0.15);
}

async function fetchImageBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Reference image download failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

async function referenceFingerprint(url) {
  const cached = referenceFingerprintCache.get(url);
  if (cached) return cached;

  const promise = (async () => {
    const buffer = await fetchImageBuffer(url);
    return fingerprintImage(buffer);
  })();
  referenceFingerprintCache.set(url, promise);

  try {
    return await promise;
  } catch (error) {
    referenceFingerprintCache.delete(url);
    throw error;
  }
}

export async function warmReferenceFingerprints(referenceImages, maxImages = 20) {
  const refs = (referenceImages || [])
    .slice()
    .sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0))
    .slice(0, maxImages)
    .map(referenceImageUrl)
    .filter(Boolean);
  await Promise.all(refs.map((url) => referenceFingerprint(url)));
  return refs.length;
}

function bestGlobalAssignment(scoreMatrix) {
  const rows = scoreMatrix.length;
  const columns = scoreMatrix[0]?.length || 0;
  if (!rows || columns < rows) return null;

  // Exact dynamic-programming assignment for normal Etsy image counts. This
  // avoids greedy swaps where two similar neutral-room mockups steal each
  // other's slots.
  if (columns <= 14) {
    let states = new Map([[0, { score: 0, slots: [] }]]);
    for (let row = 0; row < rows; row += 1) {
      const next = new Map();
      for (const [mask, state] of states.entries()) {
        for (let column = 0; column < columns; column += 1) {
          if (mask & (1 << column)) continue;
          const nextMask = mask | (1 << column);
          const candidate = {
            score: state.score + Number(scoreMatrix[row][column] || 0),
            slots: [...state.slots, column]
          };
          const current = next.get(nextMask);
          if (!current || candidate.score > current.score) next.set(nextMask, candidate);
        }
      }
      states = next;
    }

    let best = null;
    for (const state of states.values()) {
      if (!best || state.score > best.score) best = state;
    }
    return best?.slots || null;
  }

  // Defensive fallback for unusually large listings.
  const pairs = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      pairs.push({ row, column, score: scoreMatrix[row][column] });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const usedRows = new Set();
  const usedColumns = new Set();
  const slots = new Array(rows).fill(null);
  for (const pair of pairs) {
    if (usedRows.has(pair.row) || usedColumns.has(pair.column)) continue;
    usedRows.add(pair.row);
    usedColumns.add(pair.column);
    slots[pair.row] = pair.column;
  }
  return slots.every((slot) => slot !== null) ? slots : null;
}

export async function sortCustomMockupsByReference({
  customMedia,
  referenceImages,
  getObject,
  minimumAverageScore = 0.58,
  minimumPairScore = 0.42
}) {
  const customImages = (customMedia || []).filter((item) =>
    String(item?.contentType || '').startsWith('image/')
  );
  const nonImages = (customMedia || []).filter((item) =>
    !String(item?.contentType || '').startsWith('image/')
  );

  if (customImages.length < 2 || !(referenceImages || []).length) {
    return {
      items: [...customMedia],
      applied: false,
      reason: 'template does not contain enough mockup slots',
      averageScore: null,
      matches: []
    };
  }

  const refs = (referenceImages || [])
    .slice()
    .sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0))
    .slice(0, Math.min((referenceImages || []).length, customImages.length))
    .map((image) => ({ ...image, url: referenceImageUrl(image) }))
    .filter((image) => image.url);

  if (!refs.length) {
    return {
      items: [...customMedia],
      applied: false,
      reason: 'template does not contain usable mockup slots',
      averageScore: null,
      matches: []
    };
  }

  let customPrepared = [];
  try {
    const [customResult, referencePrepared] = await Promise.all([
      Promise.all(customImages.map(async (item, index) => {
        const object = await getObject(item.key);
        return {
          item,
          index,
          buffer: object.body,
          fingerprint: await fingerprintImage(object.body)
        };
      })),
      Promise.all(refs.map(async (image, index) => ({
        image,
        index,
        fingerprint: await referenceFingerprint(image.url)
      })))
    ]);
    customPrepared = customResult;

    const preparedBuffers = new Map(customPrepared.map((item) => [item.item.key, item.buffer]));
    const scoreMatrix = customPrepared.map((custom) =>
      referencePrepared.map((reference) =>
        descriptorSimilarity(custom.fingerprint, reference.fingerprint)
      )
    );

    let matches;
    if (customPrepared.length <= referencePrepared.length) {
      const assignment = bestGlobalAssignment(scoreMatrix);
      if (!assignment) {
        return {
          items: [...customMedia],
          applied: false,
          reason: 'could not assign every mockup to a unique template slot',
          averageScore: null,
          matches: [],
          preparedBuffers
        };
      }
      matches = assignment.map((referenceIndex, customIndex) => ({
        customIndex,
        referenceIndex,
        score: scoreMatrix[customIndex][referenceIndex]
      }));
    } else {
      // More uploaded mockups than template slots: match every template slot
      // to its best unique uploaded image, then append any extra mockups in
      // their original upload order.
      const transposed = referencePrepared.map((_, referenceIndex) =>
        customPrepared.map((_, customIndex) => scoreMatrix[customIndex][referenceIndex])
      );
      const assignment = bestGlobalAssignment(transposed);
      if (!assignment) {
        return {
          items: [...customMedia],
          applied: false,
          reason: 'could not assign every template slot to a unique uploaded mockup',
          averageScore: null,
          matches: [],
          preparedBuffers
        };
      }
      matches = assignment.map((customIndex, referenceIndex) => ({
        customIndex,
        referenceIndex,
        score: scoreMatrix[customIndex][referenceIndex]
      }));
    }
    const averageScore = matches.reduce((sum, match) => sum + match.score, 0) / matches.length;
    const weakestScore = Math.min(...matches.map((match) => match.score));

    if (averageScore < minimumAverageScore || weakestScore < minimumPairScore) {
      return {
        items: [...customMedia],
        applied: false,
        reason: `template match confidence was too low (avg ${averageScore.toFixed(2)}, weakest ${weakestScore.toFixed(2)})`,
        averageScore,
        matches: [],
        preparedBuffers
      };
    }

    const byReference = matches.slice().sort((a, b) => a.referenceIndex - b.referenceIndex);
    const matchedCustomIndexes = new Set(byReference.map((match) => match.customIndex));
    const sorted = byReference.map((match) => customPrepared[match.customIndex].item);
    const extras = customPrepared
      .filter((_, index) => !matchedCustomIndexes.has(index))
      .map((entry) => entry.item);

    return {
      items: [...sorted, ...extras, ...nonImages],
      applied: true,
      reason: extras.length ? `${extras.length} extra mockup(s) appended after the matched template slots` : null,
      averageScore,
      matchedCount: byReference.length,
      extraCount: extras.length,
      matches: byReference.map((match) => ({
        originalIndex: match.customIndex,
        targetRank: match.referenceIndex + 1,
        score: match.score
      })),
      preparedBuffers
    };
  } catch (error) {
    return {
      items: [...customMedia],
      applied: false,
      reason: error?.message || String(error),
      averageScore: null,
      matches: [],
      preparedBuffers: new Map(customPrepared.map((item) => [item.item.key, item.buffer]))
    };
  }
}

export async function mapWithConcurrency(items, limit, mapper) {
  const values = Array.from(items || []);
  const output = new Array(values.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      output[index] = await mapper(values[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(Number(limit) || 1, values.length || 1)) },
    () => worker()
  );
  await Promise.all(workers);
  return output;
}
