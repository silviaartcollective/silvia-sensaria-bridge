// ag-psd refuses a whole PSD when a layer's secondary ("real") user mask has
// bounds larger than its sanity limit, which Photoshop does write (e.g. canvas
// mockups). The renderer never uses that mask, so the patched reader drops it
// and reads the rest of the PSD. Runs after `npm install` and at worker start.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const FROM = "throw new Error('Invalid realMask size');";
const TO = 'delete layer.realMask; /* patched by the PC worker: unused mask with out-of-range bounds */';

export function patchAgPsd() {
  const results = [];
  for (const file of ['dist/psdReader.js', 'dist-es/psdReader.js']) {
    const target = fileURLToPath(new URL('./node_modules/ag-psd/' + file, import.meta.url));
    let source;
    try { source = fs.readFileSync(target, 'utf8'); } catch { continue; }
    if (source.includes(TO)) { results.push(file + ': already patched'); continue; }
    if (!source.includes(FROM)) { results.push(file + ': pattern not found'); continue; }
    const temporary = target + '.' + process.pid + '.tmp';
    fs.writeFileSync(temporary, source.split(FROM).join(TO));
    fs.renameSync(temporary, target);
    results.push(file + ': patched');
  }
  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  console.log('ag-psd mask patch: ' + (patchAgPsd().join('; ') || 'ag-psd not installed'));
}
