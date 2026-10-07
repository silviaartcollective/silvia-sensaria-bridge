(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const PRESET_FIND = '(Thickness: 2 cm)';
  const PRESET_REPLACE = '(Thickness: 1.25" / 3.2 cm)';
  let matches = [], scannedTerms = null, scanning = false, updating = false;
  async function request(path, data) {
    const options = data === undefined ? { cache: 'no-store' } :
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) };
    const response = await fetch(path, options);
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error('Server returned invalid JSON (HTTP ' + response.status + ').'); }
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'Request failed.');
    return payload;
  }
  function showStatus(message, failed = false, field = 'status') {
    $(field).textContent = String(message);
    $(field).className = 'status ' + (failed ? 'fail' : 'ok');
  }
  function terms() {
    return { findText: $('find-text').value, replaceText: $('replace-text').value };
  }
  function matchesScannedTerms() {
    const current = terms();
    return scannedTerms && current.findText === scannedTerms.findText &&
      current.replaceText === scannedTerms.replaceText;
  }
  function selectedRows() {
    const checked = document.querySelectorAll('.pick:checked');
    return [...checked].map(item => {
      const row = matches.find(entry => String(entry.listingId) === item.value);
      return row ? { listingId: row.listingId, hash: row.hash } : null;
    }).filter(Boolean);
  }
  function refreshApplyButton() {
    $('apply').disabled = scanning || updating || !matchesScannedTerms() ||
      $('confirm').value.trim() !== 'UPDATE DESCRIPTIONS' || !selectedRows().length;
  }
  function invalidatePreview() {
    scannedTerms = null;
    matches = [];
    $('results').classList.add('hidden');
    $('count').textContent = 'Scan to preview changes';
    $('confirm').value = '';
    refreshApplyButton();
  }
  function draw(items) {
    const root = $('matches'); root.replaceChildren();
    for (const entry of items) {
      const row = document.createElement('div'); row.className = 'row';
      const box = document.createElement('input');
      box.type = 'checkbox'; box.className = 'pick'; box.checked = true;
      box.value = String(entry.listingId);
      box.addEventListener('change', refreshApplyButton);
      const label = document.createElement('label');
      const title = document.createElement('strong');
      title.textContent = entry.title;
      const detail = document.createElement('small');
      detail.textContent = 'Etsy #' + entry.listingId + ' · ' + entry.occurrenceCount +
        ' match(es) · Description: ' + entry.currentLength + ' → ' + entry.updatedLength + ' characters';
      const before = document.createElement('small');
      before.textContent = 'BEFORE: ' + entry.context;
      const after = document.createElement('small');
      after.textContent = 'AFTER: ' + entry.previewContext;
      label.append(title, detail, before, after); row.append(box, label); root.append(row);
    }
    $('select-all').checked = true;
    $('confirm').value = '';
    refreshApplyButton();
  }
  async function scan() {
    if (scanning || updating) return;
    const current = terms();
    if (!current.findText.trim()) return showStatus('Enter the text to find before scanning.', true);
    if (current.findText === current.replaceText) return showStatus('The replacement is identical to the original text.', true);
    scanning = true; $('preview').disabled = true;
    invalidatePreview();
    showStatus('Reading active Etsy listing descriptions. No listings are being changed…');
    try {
      const payload = await request('/api/description-updater/preview', current);
      if (terms().findText !== current.findText || terms().replaceText !== current.replaceText) {
        return showStatus('Text changed during scanning. Scan again to preview the new wording.', true);
      }
      matches = payload.matches || [];
      scannedTerms = current;
      $('count').textContent = matches.length + ' matches in ' + payload.scanned + ' active listings';
      const skipped = (payload.skipped || []).length;
      if (!matches.length) {
        showStatus('No eligible Etsy listings contain this exact text.' +
          (skipped ? ' ' + skipped + ' listing(s) were skipped due to description length.' : ''));
        return;
      }
      draw(matches);
      $('results').classList.remove('hidden');
      showStatus('Found ' + matches.length + ' matching listing(s). Review the before/after examples and select which listings to edit.' +
        (skipped ? ' ' + skipped + ' listing(s) were skipped due to invalid resulting description.' : ''));
    } catch (error) { showStatus(error.message || String(error), true); }
    finally { scanning = false; $('preview').disabled = false; refreshApplyButton(); }
  }
  $('preset').addEventListener('click', () => {
    $('find-text').value = PRESET_FIND; $('replace-text').value = PRESET_REPLACE;
    invalidatePreview(); showStatus('Canvas thickness correction loaded. Click Scan Etsy descriptions.');
  });
  $('clear').addEventListener('click', () => {
    $('find-text').value = ''; $('replace-text').value = '';
    invalidatePreview(); showStatus('Fields cleared. Enter any text to search and its replacement.');
  });
  for (const id of ['find-text', 'replace-text']) {
    $(id).addEventListener('input', invalidatePreview);
  }
  $('preview').addEventListener('click', scan);
  $('select-all').addEventListener('change', e => {
    for (const box of document.querySelectorAll('.pick')) box.checked = e.target.checked;
    refreshApplyButton();
  });
  $('confirm').addEventListener('input', refreshApplyButton);
  $('apply').addEventListener('click', async () => {
    if (scanning || updating || !matchesScannedTerms()) return;
    const selected = selectedRows();
    if (!selected.length || $('confirm').value.trim() !== 'UPDATE DESCRIPTIONS') return;
    const current = terms();
    const preview = 'Find: ' + current.findText.slice(0, 120) + '\nReplace: ' +
      (current.replaceText ? current.replaceText.slice(0, 120) : '(remove matched text)');
    if (!window.confirm('Update ' + selected.length + ' live Etsy description(s)?\n\n' + preview +
      '\n\nOnly matching passages will be replaced. This change takes effect immediately.')) return;
    updating = true; refreshApplyButton(); $('preview').disabled = true;
    showStatus('Updating ' + selected.length + ' selected Etsy description(s)…', false, 'apply-status');
    try {
      const response = await request('/api/description-updater/apply', {
        confirm: 'UPDATE DESCRIPTIONS',
        selections: selected,
        findText: current.findText, replaceText: current.replaceText
      });
      const failures = (response.results || []).filter(row => !row.ok);
      const outcome = 'Updated ' + response.updated + ' of ' + response.selected +
        ' selected listings.' + (failures.length ? '\nNeeds attention: ' +
        failures.map(row => '#' + row.listingId + ': ' + row.error).join('\n') : '') +
        '\nRun a new scan to verify the live descriptions.';
      showStatus(outcome, !!failures.length, 'apply-status');
      showStatus(outcome, !!failures.length);
      $('confirm').value = '';
      scannedTerms = null; matches = [];
      $('results').classList.add('hidden');
    } catch (error) { showStatus(error.message || String(error), true, 'apply-status'); }
    finally { updating = false; $('preview').disabled = false; refreshApplyButton(); }
  });
})();