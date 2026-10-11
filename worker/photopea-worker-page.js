// Runs only inside the worker's isolated localhost Chromium page.
// PSD bytes and generated JPGs never pass through the Product Creator browser.
(()=>{
 'use strict';
 const frame=document.getElementById('photopea');
 const photopeaOrigin='https://www.photopea.com';
 let pending=null,readyResolve=null,readyReject=null,readyPromise=null,readyTimer=null;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const errorText=err=>String(err?.message||err);
 function settle(p,error,result){
  if(pending!==p)return;
  pending=null;clearTimeout(p.timer);
  if(error)p.reject(error);else p.resolve(result);
 }
 // Photopea's scripting engine may send "done" early or fail silently.
 // Script replies are acknowledged by a unique sentinel, NOT by the generic "done".
 window.addEventListener('message',event=>{
  if(event.origin!==photopeaOrigin||event.source!==frame.contentWindow)return;
  if(!pending){
   if(event.data==='done'&&readyResolve){
    const yes=readyResolve;readyResolve=null;readyReject=null;
    if(readyTimer)clearTimeout(readyTimer);readyTimer=null;yes();
   }
   return;
  }
  const p=pending;
  if(event.data instanceof ArrayBuffer){
   p.binary=event.data;
   if(p.seenSentinel&&p.expectBinary)
    settle(p,null,{messages:p.messages,binary:p.binary});
   return;
  }
  if(typeof event.data!=='string')return;
  if(event.data==='done'){
   if(!p.token){
    settle(p,null,{messages:p.messages,binary:p.binary});
   }else if(p.seenSentinel){
    if(p.expectBinary&&!p.binary)
     settle(p,Error('Photopea completed export without sending JPG bytes.'));
    else settle(p,null,{messages:p.messages,binary:p.binary});
   }
   return;
  }
  p.messages.push(event.data);
  if(event.data.startsWith('MG_ERROR:')){
   settle(p,Error(event.data.slice(9)));return;
  }
  if(p.token&&event.data==='MG_SENTINEL:'+p.token){
   p.seenSentinel=true;
   if(!p.expectBinary||p.binary)
    settle(p,null,{messages:p.messages,binary:p.binary});
  }
 });
 async function stage(value){
  document.getElementById('stage').textContent=value;
  await fetch('./stage',{method:'POST',headers:{'content-type':'text/plain'},body:value}).catch(()=>{});
 }
 async function init(){
  if(!readyPromise){
   readyPromise=new Promise((resolve,reject)=>{
    readyResolve=resolve;readyReject=reject;
    readyTimer=setTimeout(()=>{if(readyReject){readyResolve=null;readyReject=null;reject(Error('Photopea did not connect in 90 seconds. Check PC browser access to photopea.com.'));}},90000);
   });
   frame.src=photopeaOrigin+'/#'+encodeURIComponent(JSON.stringify({environment:{intro:false,vmode:2}}));
  }
  return readyPromise;
 }
 async function send(data,timeout=420000,token=null,expectBinary=false){
  await init();
  if(pending)throw Error('Photopea still has an active command.');
  return new Promise((resolve,reject)=>{
   const p={resolve,reject,messages:[],binary:null,token,expectBinary,seenSentinel:false};
   pending=p;
   p.timer=setTimeout(()=>{
    const recent=p.messages.filter(x=>x.startsWith('MG_')).slice(-3).join(' | ');
    settle(p,Error('Photopea '+(data instanceof ArrayBuffer?'PSD/image import':'script')+
      ' did not respond within '+Math.round(timeout/1000)+'s.'+
      (recent?' Last response: '+recent.slice(0,180):' The scripting interpreter may have stopped; this PSD will be marked failed.')));
   },timeout);
   try{frame.contentWindow.postMessage(data,photopeaOrigin,data instanceof ArrayBuffer?[data]:[])}
   catch(err){clearTimeout(p.timer);pending=null;reject(err)}
  });
 }
 async function script(fn,...args){
  const token=crypto.randomUUID();
  const source='('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+
   ');app.echoToOE('+JSON.stringify('MG_SENTINEL:'+token)+');';
  // Metadata scans must not monopolize the queue for five minutes after a silent interpreter crash.
  const name=fn.name||'';
  const timeout=name==='inspect'||name==='visibilityCheck'?45000:
    name==='openArtworkSlot'||name==='replaceArtwork'?150000:90000;
  return send(source,timeout,token);
 }
 async function loadFile(kind,timeout){
  await stage('Opening '+(kind==='psd'?'PSD template':'master artwork')+' on PC');
  const response=await fetch('./'+kind,{cache:'no-store',signal:AbortSignal.timeout(240000)});
  if(!response.ok)throw Error('Local '+kind+' read failed (HTTP '+response.status+').');
  const buffer=await response.arrayBuffer();
  await stage('Importing '+(buffer.byteLength/1024/1024).toFixed(1)+' MB '+(kind==='psd'?'PSD':'artwork')+' into PC Photopea');
  await send(buffer,timeout);
 }
 function inspect(){
  // Photopea has a limited, nonstandard JS interpreter. Do not use Array.map,
  // unguarded LayerSet.kind, modern JS helpers, or speculative property access.
  var doc=app.activeDocument,objects=[],visibility=[];
  function scan(layers,prefix,parentVisible){
   for(var i=0;i<layers.length;i++){
    var layer=layers[i];
    var group=layer.typename==='LayerSet';
    var kind=group?'group':(layer.kind===LayerKind.SMARTOBJECT?'smart':'other');
    var path=prefix?prefix+'.'+i:''+i;
    var name=''+layer.name;
    var visible=(layer.visible!==false)&&parentVisible;
    var data={path:path,name:name,kind:kind,visible:visible};
    visibility[visibility.length]=data;
    if(kind==='smart')objects[objects.length]=data;
    if(group)scan(layer.layers,path,visible);
   }
  }
  app.echoToOE('MG_INSPECT_BEGIN');
  scan(doc.layers,'',true);
  app.echoToOE('MG_INSPECT:'+JSON.stringify({objects:objects,visibility:visibility}));
 }
 function openArtworkSlot(path){
  try{
   var parent=app.activeDocument,parts=path.split('.'),l=parent.layers[Number(parts[0])];
   for(var i=1;i<parts.length;i++)l=l.layers[Number(parts[i])];
   if(!l||!(l.kind===LayerKind.SMARTOBJECT||String(l.kind).toLowerCase().indexOf('smart')>=0)||!l.visible)
    throw Error('Target artwork layer is hidden or is not a visible Smart Object.');
   parent.source='MG_PARENT_DOC';parent.activeLayer=l;
   executeAction(stringIDToTypeID('placedLayerEditContents'));
   var child=app.activeDocument;
   if(child===parent)throw Error('Photopea did not open the Smart Object contents.');
   child.source='MG_CHILD_DOC';
   app.echoToOE('MG_SLOT:'+JSON.stringify({width:Math.round(child.width.as('px')),
    height:Math.round(child.height.as('px'))}));
  }catch(e){app.echoToOE('MG_ERROR:'+String(e.message||e))}
 }
 function replaceArtwork(mode){
  try{
   var art=app.activeDocument,child=null,parent=null;
   for(var i=0;i<app.documents.length;i++){
    var d=app.documents[i];if(d.source==='MG_CHILD_DOC')child=d;if(d.source==='MG_PARENT_DOC')parent=d;
   }
   if(!child||!parent||art===child)throw Error('The artwork Smart Object could not be located.');
   var old=[];for(var k=0;k<child.layers.length;k++)old.push(child.layers[k]);
   if(!art.activeLayer)throw Error('Replacement artwork has no active layer.');
   var layer=art.activeLayer.duplicate(child,ElementPlacement.PLACEATBEGINNING);
   app.activeDocument=child;
   for(var j=0;j<old.length;j++)old[j].visible=false;
   layer.visible=true;child.activeLayer=layer;
   var b=layer.bounds,sw=b[2].as('px')-b[0].as('px'),sh=b[3].as('px')-b[1].as('px');
   var tw=child.width.as('px'),th=child.height.as('px');
   if(sw<=0||sh<=0||tw<=0||th<=0)throw Error('Invalid Smart Object dimensions.');
   var factor=(mode==='cover'?Math.max(tw/sw,th/sh):Math.min(tw/sw,th/sh))*100;
   layer.resize(factor,factor,AnchorPosition.MIDDLECENTER);
   b=layer.bounds;layer.translate(tw/2-(b[0].as('px')+b[2].as('px'))/2,
     th/2-(b[1].as('px')+b[3].as('px'))/2);
   app.activeDocument=art;art.close();
   app.activeDocument=child;child.save();child.close();
   app.activeDocument=parent;
   app.echoToOE('MG_REPLACED:'+JSON.stringify({replaced:true}));
  }catch(e){app.echoToOE('MG_ERROR:'+String(e.message||e))}
 }
 function visibilityCheck(){
  var doc=app.activeDocument,visibility=[];
  function scan(layers,prefix,parentVisible){
   for(var i=0;i<layers.length;i++){
    var layer=layers[i];
    var group=layer.typename==='LayerSet';
    var kind=group?'group':(layer.kind===LayerKind.SMARTOBJECT?'smart':'other');
    var path=prefix?prefix+'.'+i:''+i;
    var data={path:path,name:''+layer.name,kind:kind,
     visible:(layer.visible!==false)&&parentVisible};
    visibility[visibility.length]=data;
    if(group)scan(layer.layers,path,data.visible);
   }
  }
  scan(doc.layers,'',true);
  app.echoToOE('MG_VISIBILITY:'+JSON.stringify(visibility));
 }
 function exportComposite(){
  try{
   var doc=app.activeDocument,w=Math.round(doc.width.as('px')),h=Math.round(doc.height.as('px'));
   if(!w||!h)throw Error('Invalid PSD composite size.');
   if(w*h>24000000){
    var factor=Math.sqrt(24000000/(w*h));
    doc.resizeImage(UnitValue(Math.max(1,Math.floor(w*factor)),'px'),
     UnitValue(Math.max(1,Math.floor(h*factor)),'px'),null,ResampleMethod.BICUBIC);
   }
   app.echoToOE('MG_EXPORT:'+JSON.stringify({width:Math.round(doc.width.as('px')),
     height:Math.round(doc.height.as('px'))}));
   doc.saveToOE('jpg:0.9');
  }catch(e){app.echoToOE('MG_ERROR:'+String(e.message||e))}
 }
 function parse(message,tag){
  const value=message.messages.find(line=>line.startsWith(tag));
  if(!value)throw Error('Photopea did not confirm '+tag);
  return JSON.parse(value.slice(tag.length));
 }
 function targetFor(inspected,mapping){
  const visible=inspected.objects.filter(o=>o.kind==='smart'&&o.visible);
  if(mapping?.path){
   const selected=visible.find(x=>x.path===mapping.path||x.name===mapping.path);
   return selected||null;
  }
  if(visible.length===1)return visible[0];
  // In mockup 19.psd, Smart Object "5" is visible and the other Smart Object is hidden.
  const namedFive=visible.filter(o=>o.name==='5');
  if(namedFive.length===1)return namedFive[0];
  return null; // An ambiguous PSD must be mapped explicitly rather than guessing.
 }
 window.renderMockupOnPC=async function(config){
  await stage('Connecting PC background Photoshop processor');
  await init();
  await loadFile('psd',420000);
  await stage('Inspecting visible PSD Smart Objects');
  const inspected=parse(await script(inspect),'MG_INSPECT:');
  await stage('Found '+inspected.objects.length+' Smart Objects · choosing visible artwork layer');
  if(/^mockup[ _-]*19\\.(?:psd|psb)$/i.test(config.templateName||'')){
   const artworkSlot=inspected.objects.find(o=>o.name==='5'&&o.kind==='smart');
   const hidden=inspected.objects.find(o=>o.name==='mockup 1 (1)'&&o.kind==='smart');
   if(!artworkSlot?.visible||hidden?.visible)
    throw Error('Mockup 19 visibility mismatch: Smart Object 5 must be visible; mockup 1 (1) must remain hidden.');
  }
  const selected=targetFor(inspected,config.mapping||null);
  if(!selected)return {needsMapping:true,objects:inspected.objects,
   reason:config.mapping?.path?'Saved Smart Object no longer matches a visible layer.':'Select the artwork Smart Object for this template.'};
  await stage('Opening artwork Smart Object '+selected.name);
  const slot=parse(await script(openArtworkSlot,selected.path),'MG_SLOT:');
  if(slot.width<1||slot.height<1)throw Error('Invalid artwork slot dimensions.');
  await loadFile('artwork',240000);
  await stage('Replacing artwork in visible Smart Object '+selected.name);
  const replaced=parse(await script(replaceArtwork,config.fitMode||'contain'),'MG_REPLACED:');
  if(!replaced.replaced)throw Error('Smart Object replacement was not completed.');
  const after=parse(await script(visibilityCheck),'MG_VISIBILITY:');
  if(JSON.stringify(after)!==JSON.stringify(inspected.visibility))
   throw Error('PSD layer visibility changed. Export refused to protect hidden mockup layers.');
  await stage('Exporting a JPG (maximum 24 megapixels)');
  const token=crypto.randomUUID();
  const source='('+exportComposite.toString()+')();app.echoToOE('+JSON.stringify('MG_SENTINEL:'+token)+');';
  const output=await send(source,300000,token,true);
  const dims=parse(output,'MG_EXPORT:');
  if(!output.binary||output.binary.byteLength<100||dims.width*dims.height>24000000)
   throw Error('Photopea did not return a valid 24MP-or-smaller JPG.');
  const signature=new Uint8Array(output.binary,0,2);
  if(signature[0]!==255||signature[1]!==216)throw Error('Photopea output is not a JPEG.');
  await stage('Saving generated JPG on PC');
  const response=await fetch('./output',{method:'POST',headers:{'content-type':'image/jpeg'},
   body:output.binary,signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw Error('Local JPG export could not be saved (HTTP '+response.status+').');
  return {needsMapping:false,objects:inspected.objects,usedMapping:selected.path,
   dimensions:dims,visibilityVerified:true,artworkReplaced:true};
 };
})();
