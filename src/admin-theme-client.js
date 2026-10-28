// Dark mode for every page of the app. Each page has its own colours in its
// own <style>, so the dark look is made from them: every colour in the page's
// styles (and in style="" attributes) gets a dark counterpart with the same
// hue (light backgrounds become dark, dark text becomes light, lines are
// dimmed), in a stylesheet added after the page's own and switched with the
// theme. Photos and mockups are not changed. The choice is kept in this
// browser; until one is made, the computer's own setting is followed.
(()=>{'use strict';
if(window.adminTheme)return;
const KEY='admin-theme',root=document.documentElement,SHEET_ID='admin-theme-dark';
const saved=()=>{try{return localStorage.getItem(KEY)}catch{return null}};
const systemDark=window.matchMedia?.('(prefers-color-scheme: dark)');
const wanted=()=>{const choice=saved();return choice==='dark'||choice==='light'?choice:systemDark?.matches?'dark':'light';};

// ---------------------------------------------------------------- colours
const COLOR=/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/gi;
function parse(text){
 const t=String(text).trim().toLowerCase();
 if(t==='white')return [255,255,255,1];
 if(t==='black')return [0,0,0,1];
 let m=t.match(/^#([0-9a-f]{3,8})$/);
 if(m){
  let h=m[1];if(h.length<=4)h=[...h].map(c=>c+c).join('');
  if(h.length!==6&&h.length!==8)return null;
  return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16),h.length===8?parseInt(h.slice(6),16)/255:1];
 }
 m=t.match(/^rgba?\(([^)]*)\)$/);
 if(!m)return null;
 const p=m[1].split(/[\s,/]+/).filter(Boolean),n=(v,max)=>v.endsWith('%')?parseFloat(v)*max/100:parseFloat(v);
 if(p.length<3)return null;
 return [n(p[0],255),n(p[1],255),n(p[2],255),p[3]==null?1:n(p[3],1)];
}
function toHsl(r,g,b){
 r/=255;g/=255;b/=255;
 const max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2;
 if(max===min)return [0,0,l];
 const d=max-min,s=l>.5?d/(2-max-min):d/(max+min);
 const h=max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4;
 return [h/6,s,l];
}
function toRgb(h,s,l){
 if(!s)return [l,l,l].map(v=>Math.round(v*255));
 const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;
 const f=t=>{t=(t+1)%1;return t<1/6?p+(q-p)*6*t:t<1/2?q:t<2/3?p+(q-p)*(2/3-t)*6:p;};
 return [f(h+1/3),f(h),f(h-1/3)].map(v=>Math.round(v*255));
}
// Backgrounds: light ones become dark, white surfaces a little lighter than
// the page so cards still stand out; dark ones (buttons, the sidebar) stay dark.
// Text: dark text becomes light; light text (on dark buttons) stays. Lines: dimmed.
function darkColor(text,kind){
 const c=parse(text);
 if(!c)return text;
 const [h,,l]=toHsl(c[0],c[1],c[2]);
 // How colourful it is (an off-white is barely so, however its saturation reads).
 const chroma=(Math.max(c[0],c[1],c[2])-Math.min(c[0],c[1],c[2]))/255;
 let L=l;
 if(kind==='bg'){
  if(l>=.9)L=.085+(l-.9)*.4;
  else if(l>=.5)L=.085+(.9-l)*.6;
  else L=Math.min(.5,l*1.1+.04);
 }else if(kind==='text'){
  if(l<.6)L=.92-l*.5;
 }else if(kind==='line'){
  if(l>=.5)L=.2+(1-l)*.45;
 }else if(kind==='shadow'){
  // A dark shadow stays; a light glow would shine on a dark page.
  if(l>=.5)L=.04;
 }else if(kind==='accent'){
  if(l<.5)L=.5+(.5-l)*.2;
 }
 if(L===l)return text;
 // The same colourfulness at the new lightness.
 const room=1-Math.abs(2*L-1);
 const S=room>0?Math.min(1,chroma*(kind==='bg'?.9:1.1)/room):0;
 const [r,g,b]=toRgb(h,S,L),a=Math.round(c[3]*1000)/1000;
 return a<1?'rgba('+r+', '+g+', '+b+', '+a+')':'rgb('+r+', '+g+', '+b+')';
}
const darkValue=(value,kind)=>String(value).replace(COLOR,match=>darkColor(match,kind));
// What a property colours.
function kindOf(prop){
 if(prop==='color'||prop==='caret-color'||prop==='fill'||prop==='stroke'||prop==='-webkit-text-fill-color'||prop==='text-decoration-color')return 'text';
 if(prop.startsWith('background'))return 'bg';
 if(prop==='box-shadow'||prop==='text-shadow')return 'shadow';
 if(/^(border|outline|column-rule)(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?$/.test(prop))return 'line';
 return '';
}
// The page's own colour variables (--green2…) are darkened the way the page
// uses them: as a background, as text or as a line. One used both ways (a dark
// green for buttons and for text) becomes a middle shade that works as both.
const varUse=new Map();
function noteVarUse(style){
 for(const [,prop,value] of String(style.cssText).matchAll(/([a-z-]+)\s*:\s*([^;]*var\(--[^;]*)/g)){
  const kind=kindOf(prop);
  if(!kind)continue;
  for(const [,name] of value.matchAll(/var\(\s*(--[\w-]+)/g)){
   if(!varUse.has(name))varUse.set(name,new Set());
   varUse.get(name).add(kind);
  }
 }
}
function varKind(name,value){
 const used=varUse.get(name);
 if(used?.size===1)return [...used][0];
 const c=parse((String(value).match(COLOR)||[''])[0]);
 const light=c&&toHsl(c[0],c[1],c[2])[2]>=.5;
 if(used?.size)return light?'bg':used.has('text')?'accent':'bg';
 // Not used by any rule here (maybe by an element's style=""): told by its name.
 const n=name.toLowerCase();
 if(/ink|text|muted|fg|font/.test(n))return 'text';
 if(/line|border|rule|stroke/.test(n))return 'line';
 return light?'bg':'';
}
// The dark declarations of one rule (or one element's style="").
function darkDeclarations(style){
 const out=[];
 for(let i=0;i<style.length;i++){
  const prop=style[i],value=style.getPropertyValue(prop);
  if(!value||!value.match(COLOR))continue;
  const kind=prop.startsWith('--')?varKind(prop,value):kindOf(prop);
  if(!kind)continue;
  const dark=darkValue(value,kind);
  if(dark!==value)out.push([prop,dark.trim(),style.getPropertyPriority(prop)]);
 }
 return out;
}

// ---------------------------------------------------------------- styles
function rulesCss(rules){
 let css='';
 for(const rule of rules){
  if(rule.selectorText!==undefined&&rule.style){
   const decl=darkDeclarations(rule.style);
   if(decl.length)css+=rule.selectorText+'{'+decl.map(([p,v,i])=>p+':'+v+(i?' !important':'')).join(';')+'}\n';
  }else if(rule.cssRules&&(rule.media||rule.conditionText!==undefined)){
   const inner=rulesCss(rule.cssRules);
   if(inner)css+=(rule.media?'@media '+rule.media.mediaText:'@supports '+rule.conditionText)+'{\n'+inner+'}\n';
  }
 }
 return css;
}
// Links and form controls the page leaves to the browser follow the theme too.
const BASE=':root{color-scheme:dark}\na:not([class]){color:#9cc0ff}\na:not([class]):visited{color:#c4a8ff}\n';
let sheet=null,dirty=true;
function eachRule(rules,visit){
 for(const rule of rules){
  if(rule.style)visit(rule.style);
  if(rule.cssRules)eachRule(rule.cssRules,visit);
 }
}
function build(){
 let css=BASE;
 const sources=[...document.styleSheets].filter(source=>source.ownerNode?.id!==SHEET_ID);
 varUse.clear();
 for(const source of sources){try{eachRule(source.cssRules,noteVarUse);}catch{}}
 for(const el of document.querySelectorAll('[style*="var("]'))noteVarUse(el.style);
 for(const source of sources){try{css+=rulesCss(source.cssRules);}catch{}}
 if(!sheet){sheet=document.createElement('style');sheet.id=SHEET_ID;}
 sheet.textContent=css;
 // After every style of the page, so its colours give way.
 const parent=document.body||document.head;
 if(sheet.parentNode!==parent||sheet.nextElementSibling)parent.appendChild(sheet);
 dirty=false;
}

// ---------------------------------------------------------------- style=""
// Each element remembers, per property, its own colour and the dark one put
// in its place; a colour a page script sets later is darkened in turn, and
// switching back to light restores only what is still the dark one.
const inline=new WeakMap();
const same=(a,b)=>String(a).replace(/\s+/g,'')===String(b).replace(/\s+/g,'');
function darkenInline(el){
 const style=el.getAttribute('style');
 if(!style||!style.match(COLOR))return;
 const done=inline.get(el)||new Map();
 const decl=darkDeclarations(el.style).filter(([p])=>!(done.has(p)&&same(el.style.getPropertyValue(p),done.get(p).dark)));
 if(!decl.length)return;
 for(const [p,v,i] of decl){
  done.set(p,{light:el.style.getPropertyValue(p),priority:i,dark:v});
  el.style.setProperty(p,v,i);
 }
 inline.set(el,done);
 el.setAttribute('data-theme-inline','');
}
function darkenAll(node){
 if(node.nodeType!==1)return;
 if(node.hasAttribute('style'))darkenInline(node);
 for(const el of node.querySelectorAll('[style]'))darkenInline(el);
}
function lightenAll(){
 for(const el of document.querySelectorAll('[data-theme-inline]')){
  for(const [p,{light,priority,dark}] of inline.get(el)||[])
   if(same(el.style.getPropertyValue(p),dark))el.style.setProperty(p,light,priority);
  inline.delete(el);el.removeAttribute('data-theme-inline');
 }
}

// ---------------------------------------------------------------- switching
let mode='light';
function label(){
 for(const button of document.querySelectorAll('[data-theme-toggle]')){
  button.textContent=mode==='dark'?'☀ Light mode':'☾ Dark mode';
  button.setAttribute('aria-pressed',String(mode==='dark'));
 }
}
function apply(next){
 mode=next==='dark'?'dark':'light';
 root.dataset.theme=mode;
 if(mode==='dark'){
  if(dirty||!sheet?.isConnected)build();
  sheet.media='all';
  if(document.body)darkenAll(document.body);
 }else{
  if(sheet)sheet.media='not all';
  lightenAll();
 }
 label();
}
function choose(next){
 try{localStorage.setItem(KEY,next)}catch{}
 apply(next);
 // Pages inside this one (the converter in Listings) follow at once.
 for(const frame of document.querySelectorAll('iframe')){try{frame.contentWindow?.adminTheme?.apply(next)}catch{}}
}
window.adminTheme={apply,choose,toggle:()=>choose(mode==='dark'?'light':'dark'),get mode(){return mode},darken:darkValue};

// Styles and elements added later (the photo organizer, rows drawn by the page).
let pending=false;
const observer=new MutationObserver(records=>{
 for(const record of records){
  if(record.type==='attributes'){if(mode==='dark')darkenInline(record.target);continue;}
  for(const node of record.addedNodes){
   if(node===sheet)continue;
   if(node.nodeName==='STYLE'||(node.nodeName==='LINK'&&/stylesheet/i.test(node.rel))||node.querySelector?.('style,link[rel~=stylesheet]'))dirty=true;
   if(mode==='dark')darkenAll(node);
  }
 }
 if(dirty&&mode==='dark'&&!pending){pending=true;queueMicrotask(()=>{pending=false;if(mode==='dark')build();});}
});
observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['style']});

apply(wanted());
document.addEventListener('DOMContentLoaded',()=>{
 dirty=true;apply(mode);
 document.addEventListener('click',event=>{if(event.target.closest?.('[data-theme-toggle]'))window.adminTheme.toggle();});
});
// Another tab, or the computer's setting while no choice is saved.
window.addEventListener('storage',event=>{if(event.key===KEY)apply(wanted());});
systemDark?.addEventListener?.('change',()=>{if(!saved())apply(wanted());});
})();
