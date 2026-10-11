#target photoshop
// Shared Crop + Mockup Worker: local Adobe Photoshop renderer.
// Never save over the input PSD. Inactive mockup layers are never enabled.
var cfg=__MOCKUP_CONFIGURATION__;
if(typeof JSON==="undefined")JSON={};
if(typeof JSON.stringify!=="function")JSON.stringify=function(v){
 function quote(s){return '"'+String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\r/g,'\\r').replace(/\n/g,'\\n')+'"'}
 function encode(x){if(x===null||typeof x==="undefined")return "null";
 if(typeof x==="string")return quote(x);
 if(typeof x==="number"||typeof x==="boolean")return String(x);
 if(x instanceof Array){var a=[];for(var i=0;i<x.length;i++)a.push(encode(x[i]));return "["+a.join(",")+"]"}
 var b=[];for(var k in x)if(x.hasOwnProperty(k))b.push(quote(k)+":"+encode(x[k]));return "{"+b.join(",")+"}"}
 return encode(v);
};
function fileWrite(location,contents){
 var f=new File(location);f.encoding="UTF8";
 if(!f.open("w"))throw new Error("Unable to write result: "+location);
 f.write(contents);f.close();
}
function step(text){fileWrite(cfg.stage,"Photoshop: "+text)}
function layerInfo(doc){
 var records=[],smart=[];
 function visit(layers,prefix,parentsVisible){
  for(var i=0;i<layers.length;i++){
   var layer=layers[i],path=prefix?prefix+"."+i:""+i;
   var group=layer.typename==="LayerSet";
   var kind=group?"group":(layer.kind===LayerKind.SMARTOBJECT?"smart":"other");
   var visible=parentsVisible&&layer.visible!==false;
   var item={path:path,name:String(layer.name),kind:kind,visible:visible};
   records.push(item);
   if(kind==="smart")smart.push(item);
   if(group)visit(layer.layers,path,visible);
  }
 }
 visit(doc.layers,"",true);
 return {objects:smart,visibility:records};
}
function namedLayer(doc,record){
 var p=record.path.split("."),list=doc.layers,l=null;
 for(var i=0;i<p.length;i++){
  l=list[Number(p[i])];
  if(!l)throw new Error("Smart Object path disappeared: "+record.path);
  if(i<p.length-1)list=l.layers;
 }
 return l;
}
function choose(info){
 var visible=[],objects=info.objects;
 for(var i=0;i<objects.length;i++)if(objects[i].visible)visible.push(objects[i]);
 if(cfg.mappingName){
  var named=[];
  for(var n=0;n<visible.length;n++)if(visible[n].name===cfg.mappingName)named.push(visible[n]);
  if(named.length===1)return named[0];
 }
 if(cfg.templateName&&/^mockup[ _-]*19\.(psd|psb)$/i.test(cfg.templateName)){
  for(var k=0;k<visible.length;k++)if(visible[k].name==="5")return visible[k];
 }
 if(cfg.mappingPath){
  for(var j=0;j<visible.length;j++)if(visible[j].path===cfg.mappingPath)return visible[j];
 }
 if(visible.length===1)return visible[0];
 return null;
}
var parent=null,child=null,artDoc=null,report=null,previousDialogs=app.displayDialogs;
try{
 app.displayDialogs=DialogModes.NO;
 step("Opening "+cfg.templateName+" ("+cfg.fileMB+" MB)");
 parent=app.open(new File(cfg.psd));
 var info=layerInfo(parent);
 step("Inspecting "+info.objects.length+" Smart Objects");
 var slot=choose(info);
 if(!slot) {
  report={ok:true,needsMapping:true,objects:info.objects,
   reason:"Select one visible artwork Smart Object for this PSD."};
 }else{
  if(/^mockup[ _-]*19\.(psd|psb)$/i.test(cfg.templateName)){
   var hidden=null;
   for(var h=0;h<info.objects.length;h++)if(info.objects[h].name==="mockup 1 (1)")hidden=info.objects[h];
   if(hidden&&hidden.visible)throw new Error("Mockup 19 contains a Smart Object that should be hidden.");
   if(slot.name!=="5")throw new Error("Mockup 19 artwork layer must be Smart Object 5.");
  }
  var layer=namedLayer(parent,slot);
  if(layer.kind!==LayerKind.SMARTOBJECT||layer.visible===false)
   throw new Error("The selected artwork layer is not a visible Smart Object.");
  step("Opening Smart Object "+slot.name+" in Photoshop");
  app.activeDocument=parent;parent.activeLayer=layer;
  executeAction(stringIDToTypeID("placedLayerEditContents"),undefined,DialogModes.NO);
  child=app.activeDocument;
  if(child===parent)throw new Error("Photoshop did not open the Smart Object document.");
  step("Placing master artwork");
  var oldLayers=[];
  for(var oldIndex=0;oldIndex<child.layers.length;oldIndex++)oldLayers.push(child.layers[oldIndex]);
  artDoc=app.open(new File(cfg.artwork));app.activeDocument=artDoc;
  if(artDoc.layers.length>1)artDoc.flatten();
  var sourceLayer=artDoc.activeLayer;
  var inserted=sourceLayer.duplicate(child,ElementPlacement.PLACEATBEGINNING);
  artDoc.close(SaveOptions.DONOTSAVECHANGES);artDoc=null;
  app.activeDocument=child;
  for(var oldId=0;oldId<oldLayers.length;oldId++)oldLayers[oldId].visible=false;
  inserted.visible=true;child.activeLayer=inserted;
  var bounds=inserted.bounds;
  var iw=bounds[2].as("px")-bounds[0].as("px"),ih=bounds[3].as("px")-bounds[1].as("px");
  var tw=child.width.as("px"),th=child.height.as("px");
  if(iw<=0||ih<=0||tw<=0||th<=0)throw new Error("Artwork or Smart Object dimensions invalid.");
  var factor=cfg.fitMode==="cover"?Math.max(tw/iw,th/ih):Math.min(tw/iw,th/ih);
  inserted.resize(factor*100,factor*100,AnchorPosition.MIDDLECENTER);
  bounds=inserted.bounds;
  inserted.translate(tw/2-(bounds[0].as("px")+bounds[2].as("px"))/2,
   th/2-(bounds[1].as("px")+bounds[3].as("px"))/2);
  step("Saving updated Smart Object");
  child.save();child.close(SaveOptions.DONOTSAVECHANGES);child=null;
  app.activeDocument=parent;
  var after=layerInfo(parent);
  if(JSON.stringify(info.visibility)!==JSON.stringify(after.visibility))
   throw new Error("Original PSD layer visibility or structure changed. Export refused.");
  step("Exporting JPG");
  var width=Math.round(parent.width.as("px")),height=Math.round(parent.height.as("px"));
  if(width*height>24000000){
   var ratio=Math.sqrt(24000000/(width*height));
   width=Math.max(1,Math.floor(width*ratio));height=Math.max(1,Math.floor(height*ratio));
   parent.resizeImage(UnitValue(width,"px"),UnitValue(height,"px"),null,ResampleMethod.BICUBIC);
  }
  if(parent.mode!==DocumentMode.RGB)parent.changeMode(ChangeMode.RGB);
  if(parent.bitsPerChannel!==BitsPerChannelType.EIGHT)parent.bitsPerChannel=BitsPerChannelType.EIGHT;
  var options=new JPEGSaveOptions();options.quality=10;options.embedColorProfile=true;
  parent.saveAs(new File(cfg.output),options,true,Extension.LOWERCASE);
  report={ok:true,needsMapping:false,objects:info.objects,usedMapping:slot.path,
   visibilityVerified:true,artworkReplaced:true,
   dimensions:{width:Math.round(parent.width.as("px")),height:Math.round(parent.height.as("px"))}};
 }
}catch(error){
 report={ok:false,error:String(error.message||error)};
}finally{
 try{if(artDoc)artDoc.close(SaveOptions.DONOTSAVECHANGES)}catch(_){}
 try{if(child)child.close(SaveOptions.DONOTSAVECHANGES)}catch(_){}
 try{if(parent)parent.close(SaveOptions.DONOTSAVECHANGES)}catch(_){}
 try{app.displayDialogs=previousDialogs}catch(_){}
 try{fileWrite(cfg.report,JSON.stringify(report||{ok:false,error:"No result returned by Photoshop"}))}catch(_){}
}
