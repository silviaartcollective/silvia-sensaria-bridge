import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {renderProductCreator} from '../src/product-creator.mjs';
import {renderMockupGeneratorSection,renderMockupPreviewPanel} from '../src/mockup-generator-ui.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Product Creator keeps a separate right-side gallery outside the listing form',()=>{
 const html=renderProductCreator();
 const formStart=html.indexOf('<form class="form" id="creator-form">');
 const formEnd=html.indexOf('</form>',formStart);
 const galleryStart=html.indexOf('<aside-card class="card creator-preview-scroll"');
 const galleryEnd=html.indexOf('</aside-card>',galleryStart);
 assert.ok(formStart>=0&&formEnd>formStart);
 assert.ok(galleryStart>formEnd&&galleryEnd>galleryStart);
 assert.ok(html.slice(formStart,formEnd).includes('id="mg-templates"'));
 assert.ok(html.slice(galleryStart,galleryEnd).includes('id="mg-preview-list"'));
 assert.ok(html.slice(galleryStart,galleryEnd).includes('id="mg-apply-selected"'));
 assert.equal(html.split('id="mg-preview-list"').length,2,'only one generated preview gallery');
 assert.match(html,/\.creator-editor-scroll,\.creator-preview-scroll\{[^}]*overflow-y:auto/);
 assert.match(html,/\.grid\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(410px,1\.02fr\)/);
 assert.match(html,/scrollbar-gutter:stable/);
 assert.match(html,/<details class="creator-planned-details">/);
});

test('gallery displays large previews, two per row, in a scrolling selection viewport',()=>{
 const gallery=renderMockupPreviewPanel();
 const editor=renderMockupGeneratorSection();
 assert.match(gallery,/id="mg-preview-list"/);
 assert.match(gallery,/id="mg-select-all"/);
 assert.match(gallery,/id="mg-deselect-all"/);
 assert.match(gallery,/id="mg-apply-selected"/);
 assert.doesNotMatch(editor,/id="mg-preview-list"/);
 assert.match(editor,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(editor,/--preview-row-height:clamp\(300px,40dvh,460px\)/);
 assert.match(editor,/height:calc\(2 \* var\(--preview-row-height\) \+ 24px\)/);
 assert.match(editor,/overflow-y:auto;overscroll-behavior:contain/);
 assert.match(editor,/\.mg-preview-item:has\(input:checked\)/);
});

test('preview selection remains interactive and only explicit Apply attaches finished mockups',()=>{
 const source=read('src/mockup-generator-client.js');
 assert.doesNotThrow(()=>new vm.Script(source));
 assert.match(source,/\$\('mg-apply-selected'\)\.addEventListener\('click',\(\)=>act\(useResults\)\)/);
 assert.match(source,/function selectionChanged\(\)/);
 const change=source.slice(source.indexOf('function selectionChanged()'),source.indexOf('async function syncGeneratedJpgs('));
 assert.doesNotMatch(change,/act\(useResults\)/);
 assert.match(source,/const savedScrollTop=list\.scrollTop/);
 assert.match(source,/list\.scrollTop=savedScrollTop/);
 assert.match(source,/aria-label':'Select generated mockup/);
});
