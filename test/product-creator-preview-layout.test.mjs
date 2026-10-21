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

test('gallery displays large previews, two per row, scrolling with the preview column (one scrollbar)',()=>{
 const gallery=renderMockupPreviewPanel();
 const editor=renderMockupGeneratorSection();
 assert.match(gallery,/id="mg-preview-list"/);
 assert.match(gallery,/id="mg-select-all"/);
 assert.match(gallery,/id="mg-deselect-all"/);
 assert.match(gallery,/id="mg-apply-selected"/);
 assert.doesNotMatch(editor,/id="mg-preview-list"/);
 assert.match(editor,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(editor,/--preview-row-height:clamp\(300px,40dvh,460px\)/);
 const list=editor.match(/\.mg-preview-list\{[^}]*\}/)[0];
 assert.doesNotMatch(list,/overflow|max-height|[;{]height:/,'the list has no scroll area of its own');
 assert.match(editor,/#mg-apply-selected\{[^}]*position:sticky;bottom:0;z-index:5/);
 assert.match(editor,/\.mg-preview-item:has\(input:checked\)/);
});

test('preview selection remains interactive and only explicit Apply attaches finished mockups',()=>{
 const source=read('src/mockup-generator-client.js');
 assert.doesNotThrow(()=>new vm.Script(source));
 assert.match(source,/\$\('mg-apply-selected'\)\.addEventListener\('click',\(\)=>act\(useResults\)\)/);
 assert.match(source,/function selectionChanged\(\)/);
 const change=source.slice(source.indexOf('function selectionChanged()'),source.indexOf('async function syncGeneratedJpgs('));
 assert.doesNotMatch(change,/act\(useResults\)/);
 assert.match(source,/scroller=list\.closest\('\.creator-preview-scroll'\)\|\|list/);
 assert.match(source,/scroller\.scrollTop=savedScrollTop/);
 // A card click ticks its checkbox without focusing it (no jump).
 assert.match(source,/create\('div','',\{class:'mg-preview-item'\}\)/);
 assert.match(source,/if\(event\.target===checkbox\)return;/);
 assert.match(source,/aria-label':'Select generated mockup/);
});
