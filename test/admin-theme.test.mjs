import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { decorateAdminHtml, withAdminTheme, renderAdminSidebar } from '../src/admin-sidebar.mjs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

// The theme script in a bare page: the computer is in light mode, nothing saved.
function runTheme({ saved = null } = {}) {
  const store = new Map(saved ? [['admin-theme', saved]] : []);
  const root = { dataset: {} };
  const head = { appendChild(el) { el.parentNode = head; el.isConnected = true; } };
  const document = { documentElement: root, styleSheets: [], head, body: null,
    querySelectorAll: () => [], createElement: () => ({ style: {}, isConnected: false }), addEventListener() {} };
  const window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {} };
  const context = { window, document, localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
    MutationObserver: class { observe() {} }, queueMicrotask };
  vm.runInNewContext(read('src/admin-theme-client.js'), context);
  return { theme: window.adminTheme, root, store };
}
const lightness = rgb => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return (Math.max(r, g, b) + Math.min(r, g, b)) / 510; };

test('dark colours keep their hue: light backgrounds go dark, dark text goes light, dark buttons and white text stay', () => {
  const { theme, root } = runTheme();
  assert.equal(root.dataset.theme, 'light');
  assert.equal(theme.mode, 'light');
  const page = theme.darken('#f4f1eb', 'bg'), card = theme.darken('#fffdfa', 'bg');
  assert.ok(lightness(page) < .12 && lightness(card) < .14 && lightness(card) > lightness(page), page + ' ' + card);
  assert.ok(lightness(theme.darken('#242921', 'text')) > .8);
  assert.equal(theme.darken('#fff', 'text'), '#fff');
  assert.ok(lightness(theme.darken('#252820', 'bg')) < .25);
  assert.equal(theme.darken('0 10px 28px rgba(0, 0, 0, 0.1)', 'shadow'), '0 10px 28px rgba(0, 0, 0, 0.1)');
  assert.match(theme.darken('0 0 18px #fff', 'shadow'), /^0 0 18px rgb\(10, 10, 10\)$/);
  // An off-white is barely coloured, so its dark one is barely coloured too.
  const [r, g, b] = page.match(/\d+/g).map(Number);
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 10, page);
  // A pale green notice stays recognisably green, its text a light green.
  const [nr, ng, nb] = theme.darken('#37583b', 'text').match(/\d+/g).map(Number);
  assert.ok(ng > nr && ng > nb && lightness(theme.darken('#37583b', 'text')) > .7);
});

test('the choice saved in this browser wins over the computer\'s setting', () => {
  assert.equal(runTheme({ saved: 'dark' }).root.dataset.theme, 'dark');
  const { theme, store, root } = runTheme();
  theme.choose('dark');
  assert.equal(store.get('admin-theme'), 'dark');
  assert.equal(root.dataset.theme, 'dark');
});

test('every page gets the theme once, after its styles; the sidebar has the switch', () => {
  const page = '<html><head><style>body{background:#f4f1eb}</style></head><body><aside><nav><a class="nav active" href="/">x</a></nav></aside></body></html>';
  const html = withAdminTheme(decorateAdminHtml(page));
  assert.equal(html.split('id="admin-theme-script"').length, 2);
  assert.equal(withAdminTheme(html), html);
  assert.ok(html.indexOf('admin-theme-script') > html.indexOf('shared-admin-sidebar-styles'));
  assert.ok(html.indexOf('admin-theme-script') < html.indexOf('</head>'));
  // Pages without the sidebar (sign-in) follow the theme too.
  assert.match(withAdminTheme('<html><head></head><body>Sign in</body></html>'), /id="admin-theme-script"/);
  assert.match(renderAdminSidebar('/'), /<button type="button" class="shared-theme-toggle" data-theme-toggle aria-pressed="false">☾ Dark mode<\/button>/);
  const server = read('src/server.mjs');
  assert.match(server, /const source = withAdminTheme\(decorateAdminHtml\(html\)\);/);
  assert.match(server, /const content=withAdminTheme\(renderListingConverterPage\(\)/);
});
