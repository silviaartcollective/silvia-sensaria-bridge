// One source of truth for the Silvia administrator sidebar.
export const ADMIN_LINKS = Object.freeze([
  { href:'/', label:'Dashboard' },
  { href:'/product-creator', label:'Product Creator' },
  { href:'/listing-converter', label:'Gelato → Silvia Converter' },
  { href:'/shipping-profile', label:'Shipping Profile' },
  { href:'/pricing', label:'Pricing & Shipping' },
  { href:'/compare', label:'Supplier Comparison' },
  { href:'/custom-size', label:'Custom Size Lookup' },
  { href:'/description-updater', label:'Description Updater' },
  { href:'/tracking', label:'Order Tracking' },
  { href:'/test-order', label:'Test Order' },
  { href:'/#orders', label:'Orders' },
  { href:'/#artworks', label:'Artwork Library' },
  { href:'/#mappings', label:'Product SKUs' },
  { href:'/etsy/status', label:'Etsy Status' },
  { href:'/r2/status', label:'R2 Status' },
  { href:'/logout', label:'Log out' }
]);

function escapeHtml(str) {
  return String(str).replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;');
}
export function extractActiveAdminPath(html) {
  const nav = String(html).match(/<a\b[^>]*\bclass\s*=\s*["'][^"']*\bnav\b[^"']*\bactive\b[^"']*["'][^>]*\bhref\s*=\s*["']([^"']+)["']/i);
  if (nav) return nav[1];
  const reverse = String(html).match(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\bclass\s*=\s*["'][^"']*\bnav\b[^"']*\bactive\b[^"']*["']/i);
  return reverse?.[1] || '/';
}
export function renderAdminSidebar(activePath='/') {
  const active=String(activePath);
  const nav=ADMIN_LINKS.map(({href,label}) => {
    const selected=href===active;
    return '<a class="nav shared-nav-link'+(selected?' active is-current':'')+
      '" href="'+escapeHtml(href)+'"'+(selected?' aria-current="page"':'')+
      '>'+escapeHtml(label)+'</a>';
  }).join('\n');
  return '<aside class="shared-admin-sidebar app-sidebar" aria-label="Admin navigation">'+
    '<div class="shared-admin-brand">Silvia<br>Fulfillment'+
    '<small>Etsy → Sensaria</small></div>'+
    '<nav class="shared-admin-nav" aria-label="All dashboard pages">'+nav+'</nav>'+
    '<div class="shared-admin-foot">Silvia Art Collective<br>Private fulfillment service</div>'+
    '</aside>';
}

const STYLE = [
  '<style id="shared-admin-sidebar-styles">',
  'aside.shared-admin-sidebar{background:#252820!important;color:#f8f5ee!important;padding:28px 20px!important;width:238px;height:100vh;max-height:100vh;min-height:0!important;position:sticky;top:0;align-self:start;display:flex!important;flex-direction:column;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#5a6358 transparent;box-sizing:border-box;z-index:20}',
  'aside.shared-admin-sidebar .shared-admin-brand{flex:none;font:24px/1.1 Georgia,serif!important;margin:0 0 30px;color:#f8f5ee}',
  'aside.shared-admin-sidebar .shared-admin-brand small{display:block;font:12px/1.5 system-ui,sans-serif;margin-top:8px;color:#b9beb3}',
  'aside.shared-admin-sidebar nav.shared-admin-nav{flex:none;display:grid!important;gap:7px!important;padding:0;margin:0;min-width:0}',
  'aside.shared-admin-sidebar .shared-nav-link{display:block!important;width:100%;box-sizing:border-box;color:#cdd1c7!important;background:transparent;padding:11px 12px!important;border:0!important;border-radius:9px!important;text-align:left;text-decoration:none!important;font:14px/1.3 system-ui,sans-serif!important;font-weight:400!important;white-space:normal!important;word-break:normal;min-height:40px;box-shadow:none!important}',
  'aside.shared-admin-sidebar .shared-nav-link:hover,aside.shared-admin-sidebar .shared-nav-link:focus-visible,aside.shared-admin-sidebar .shared-nav-link.is-current{color:#fff!important;background:#373b33!important}',
  'aside.shared-admin-sidebar .shared-nav-link.is-current{font-weight:650!important}',
  'aside.shared-admin-sidebar .shared-admin-foot{flex:none;margin-top:25px;padding-top:18px;color:#aeb3a8;font:12px/1.5 system-ui,sans-serif}',
  '.shared-sidebar-mobile-toggle,.shared-sidebar-backdrop{display:none}',
  '@media(max-width:800px){',
  'body>.shell,body>.app-shell{grid-template-columns:minmax(0,1fr)!important}',
  'aside.shared-admin-sidebar{position:fixed!important;top:0;left:0;bottom:0;width:min(285px,86vw);max-height:100dvh;height:100dvh;display:flex!important;transform:translateX(-110%);transition:transform .2s ease;z-index:1002;box-shadow:10px 0 30px #0002;visibility:hidden}',
  'body.shared-sidebar-open aside.shared-admin-sidebar{transform:translateX(0);visibility:visible}',
  '.shared-sidebar-mobile-toggle{display:flex!important;align-items:center;gap:8px;position:fixed;top:12px;left:12px;z-index:1003;border:1px solid #d6d3ca;border-radius:9px;background:#252820;color:#fff;padding:9px 12px;font:13px system-ui,sans-serif;box-shadow:0 3px 12px #0002;cursor:pointer}',
  'body.shared-sidebar-open .shared-sidebar-mobile-toggle{left:min(297px,calc(86vw + 12px))}',
  '.shared-sidebar-backdrop{position:fixed;inset:0;border:0;padding:0;background:rgb(0 0 0 / 40%);z-index:1001}',
  'body.shared-sidebar-open .shared-sidebar-backdrop{display:block}',
  'body.shared-sidebar-open{overflow:hidden}',
  'body>.shell>main,body>.app-shell>main{padding-top:68px!important}',
  '}',
  '@media(prefers-reduced-motion:reduce){aside.shared-admin-sidebar{transition:none!important}}',
  '</style>'
].join('\n');

const MOBILE_CONTROLS = '<button type="button" class="shared-sidebar-mobile-toggle" aria-label="Open navigation menu" aria-expanded="false" aria-controls="admin-navigation">☰ Menu</button>'+
'<button type="button" class="shared-sidebar-backdrop" aria-label="Close navigation menu" tabindex="-1"></button>';

const MOBILE_SCRIPT = '<script id="shared-sidebar-mobile-script">'+
  '(()=>{const nav=document.querySelector("aside.shared-admin-sidebar"),'+
  'toggle=document.querySelector(".shared-sidebar-mobile-toggle"),'+
  'backdrop=document.querySelector(".shared-sidebar-backdrop");'+
  'if(!nav||!toggle||!backdrop)return;nav.id="admin-navigation";'+
  'function close(){document.body.classList.remove("shared-sidebar-open");'+
  'toggle.setAttribute("aria-expanded","false");toggle.setAttribute("aria-label","Open navigation menu");toggle.textContent="☰ Menu";}'+
  'toggle.addEventListener("click",()=>{if(document.body.classList.contains("shared-sidebar-open"))close();else{'+
  'document.body.classList.add("shared-sidebar-open");toggle.setAttribute("aria-expanded","true");'+
  'toggle.setAttribute("aria-label","Close navigation menu");toggle.textContent="✕ Close";}});'+
  'backdrop.addEventListener("click",close);'+
  'nav.addEventListener("click",e=>{if(e.target.closest("a"))close();});'+
  'document.addEventListener("keydown",e=>{if(e.key==="Escape")close();});'+
  'window.matchMedia("(min-width:801px)").addEventListener("change",e=>{if(e.matches)close();});'+
  '})();</script>';

export function decorateAdminHtml(html) {
  const source=String(html||'');
  if(!/<aside\b[^>]*>[\s\S]*?<nav\b/i.test(source))return source;
  const aside=/<aside\b[^>]*>[\s\S]*?<\/aside>/i;
  if(!aside.test(source)||!/<\/head>/i.test(source)||!/<\/body>/i.test(source))return source;
  const active=extractActiveAdminPath(source);
  return source
    .replace(aside,renderAdminSidebar(active))
    .replace(/<\/head>/i,STYLE+'</head>')
    .replace(/<body([^>]*)>/i,(_m,attrs)=>'<body'+attrs+'>'+MOBILE_CONTROLS)
    .replace(/<\/body>/i,MOBILE_SCRIPT+'</body>');
}
