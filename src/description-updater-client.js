(() => {
  const $ = id => document.getElementById(id);
  let matches = [];
  async function request(path, data) {
    const options = data === undefined ? { cache: 'no-store' } :
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) };
    const res = await fetch(path, options);
    let result; try { result = await res.json(); } catch { throw new Error('Invalid server response (HTTP ' + res.status + ').'); }
    if (!res.ok || !result.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }
  function status(msg, error = false, field = 'status') {
    $(field).textContent = msg;
    $(field).className = 'status ' + (error ? 'fail' : 'ok');
  }
  function selection() {
    return [...document.querySelectorAll('.pick:checked')].map(item => {
      const row = matches.find(m => String(m.listingId) === item.value);
      return { listingId: row.listingId, hash: row.hash };
    });
  }
  function updateButton() {
    $('apply').disabled = $('confirm').value.trim() !== 'UPDATE DESCRIPTIONS' || !selection().length;
  }
  function render(items) {
    const root = $('matches'); root.replaceChildren();
    for (const entry of items) {
      const row = document.createElement('div'); row.className = 'row';
      const box = document.createElement('input');
      box.type = 'checkbox'; box.className = 'pick'; box.checked = true;
      box.value = String(entry.listingId); box.addEventListener('change', updateButton);
      const label = document.createElement('label');
      const title = document.createElement('strong');
      title.textContent = entry.title;
      label.append(title);
      const details = document.createElement('small');
      details.textContent = 'Etsy listing #' + entry.listingId + ' · ' + entry.occurrenceCount +
        ' replacement(s) · ' + entry.context;
      label.append(details); row.append(box, label); root.append(row);
    }
    $('select-all').checked = true; $('confirm').value = ''; updateButton();
  }
  $('preview').addEventListener('click', async () => {
    $('preview').disabled = true; $('results').classList.add('hidden');
    status('Scanning active Etsy listings. No descriptions will be changed…');
    try {
      const data = await request('/api/description-updater/preview');
      matches = data.matches || [];
      $('count').textContent = matches.length + ' matches in ' + data.scanned + ' active listings';
      if (!matches.length) { status('No active Etsy listings contain the exact original thickness phrase.'); return; }
      render(matches);
      $('results').classList.remove('hidden');
      status('Found ' + matches.length + ' matching listings. Select which descriptions to change.');
    } catch (error) { status(error.message || String(error), true); }
    finally { $('preview').disabled = false; }
  });
  $('select-all').addEventListener('change', e => {
    for (const node of document.querySelectorAll('.pick')) node.checked = e.target.checked;
    updateButton();
  });
  $('confirm').addEventListener('input', updateButton);
  $('apply').addEventListener('click', async () => {
    const selected = selection();
    if (!selected.length || $('confirm').value.trim() !== 'UPDATE DESCRIPTIONS') return;
    if (!window.confirm('Update canvas thickness wording on ' + selected.length + ' live Etsy listings? Other text will remain unchanged.')) return;
    $('apply').disabled = true; $('preview').disabled = true;
    status('Applying exact description replacements to Etsy…', false, 'apply-status');
    try {
      const data = await request('/api/description-updater/apply', {
        confirm: 'UPDATE DESCRIPTIONS',
        selections: selected
      });
      const failures = (data.results || []).filter(row => !row.ok);
      status('Updated ' + data.updated + ' of ' + data.selected +
        ' listings.' + (failures.length ? '\nNeeds attention: ' +
        failures.map(x => '#' + x.listingId + ': ' + x.error).join('\n') : ''),
        failures.length > 0, 'apply-status');
      $('confirm').value = '';
      $('preview').click();
    } catch (error) { status(error.message || String(error), true, 'apply-status'); }
    finally { $('preview').disabled = false; updateButton(); }
  });
})();