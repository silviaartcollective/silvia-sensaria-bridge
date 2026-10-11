import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const origin='https://www.photopea.com';
const page=readFileSync(new URL('../worker/photopea-worker-page.js',import.meta.url),'utf8');

function harness(layers=[]){
 const emitted=[],posted=[];
 let messageListener;
 const frameWindow={postMessage(data){posted.push(data)}};
 const window={
  addEventListener(name,listener){if(name==='message')messageListener=listener;}
 };
 const document={getElementById(){return {contentWindow:frameWindow}}};
 const app={
  activeDocument:{layers},
  echoToOE(value){emitted.push(value);}
 };
 const instrumented=page.replace(
  ' window.renderMockupOnPC=async function(config){',
  ' window.__testPhotopea={inspect,visibilityCheck,send};\n window.renderMockupOnPC=async function(config){'
 );
 assert.notEqual(instrumented,page,'test hook injection');
 vm.runInNewContext(instrumented,{window,document,app,LayerKind:{SMARTOBJECT:18},
  crypto:{randomUUID:()=> 'test-uuid'},setTimeout,clearTimeout,console});
 return {window,emitted,posted,reply(data){
  messageListener({origin,source:frameWindow,data});
 }};
}

test('Photopea layer scan is compatible with ordinary, grouped and hidden smart layers',()=>{
 const group={typename:'LayerSet',name:'Group',visible:true,
  layers:[{typename:'ArtLayer',name:'Nested Smart',visible:true,kind:18}]};
 Object.defineProperty(group,'kind',{get(){throw Error('Do not inspect group.kind')}});
 const layers=[
  {typename:'ArtLayer',name:'mockup 1 (1)',visible:false,kind:18},
  {typename:'ArtLayer',name:'Background',visible:true,kind:1},
  group,
  {typename:'ArtLayer',name:'5',visible:true,kind:18}
 ];
 const h=harness(layers);
 h.window.__testPhotopea.inspect();
 const payload=h.emitted.find(x=>x.startsWith('MG_INSPECT:'));
 assert.ok(payload,'layer scan must return a result');
 const scanned=JSON.parse(payload.slice('MG_INSPECT:'.length));
 assert.deepEqual(scanned.objects.map(x=>x.name),['mockup 1 (1)','Nested Smart','5']);
 assert.equal(scanned.objects[0].visible,false);
 assert.equal(scanned.objects[1].path,'2.0');
 assert.equal(scanned.objects[2].visible,true);
 h.window.__testPhotopea.visibilityCheck();
 const after=JSON.parse(h.emitted.find(x=>x.startsWith('MG_VISIBILITY:')).slice('MG_VISIBILITY:'.length));
 assert.equal(JSON.stringify(after),JSON.stringify(scanned.visibility));
 assert.ok(page.includes("name==='inspect'||name==='visibilityCheck'?45000"),
  'inspection timeout must be short');
 assert.ok(!page.includes("path.split('.').map(Number)"),
  'Array.map is not supported by the Photopea script interpreter');
});

test('Photopea script ignores early done and completes on its unique sentinel',async()=>{
 const h=harness();
 const task=h.window.__testPhotopea.send('app.echoToOE("TEST");',3000,'unique-sentinel');
 h.reply('done'); // iframe initialization
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.posted.length,1);
 h.reply('done'); // early done from the scripting interpreter is NOT completion
 h.reply('MG_RESULT:visible');
 h.reply('MG_SENTINEL:unique-sentinel');
 const result=await task;
 assert.ok(result.messages.includes('MG_RESULT:visible'));
});

test('Photopea processing errors fail immediately and can be retried in a new job',async()=>{
 const h=harness();
 const task=h.window.__testPhotopea.send('invalid-script',3000,'test-token');
 h.reply('done');
 await new Promise(resolve=>setImmediate(resolve));
 h.reply('MG_ERROR:Unsafe layer operation');
 await assert.rejects(task,/Unsafe layer operation/);
});
