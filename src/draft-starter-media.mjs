// Allow an Etsy draft to be created before optional PSD mockups finish.
export function starterDraftMedia(master,presets){
 if(!master?.key||!String(master.contentType||'').startsWith('image/'))
  throw Error('A completed master artwork image is required.');
 const byRole=new Map((presets||[]).map(p=>[p.role,p]));
 const roles=['choose-option','choose-frame','promotion','video'];
 const missing=roles.filter(role=>!byRole.get(role)?.key);
 if(missing.length)throw Error('Missing required preset listing media: '+missing.join(', '));
 return [
  {key:master.key,contentType:master.contentType,originalFilename:master.originalFilename||'artwork.jpg',starterArtwork:true},
  ...roles.map(role=>{
   const item=byRole.get(role);
   return {key:item.key,contentType:item.contentType,originalFilename:item.filename,presetRole:role};
  })
 ];
}
