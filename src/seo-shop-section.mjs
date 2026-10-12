// Keep the shop-section chosen for an Etsy draft consistent with its pasted SEO link.
export function seoEtsySectionId(sectionUrl){
 const text=String(sectionUrl||'').trim();
 if(!text)return null;
 let url;
 try{url=new URL(text)}catch{throw Error('SEO shop section link is not a valid Etsy URL. Paste the complete section link again.')}
 if(url.protocol!=='https:'||!['etsy.com','www.etsy.com'].includes(url.hostname.toLowerCase()))
   throw Error('SEO shop section link must be an HTTPS etsy.com section URL.');
 const id=url.searchParams.get('section_id');
 if(!id||!/^\d+$/.test(id))throw Error('SEO shop section URL is missing a valid section_id.');
 return id;
}
export function assertSeoShopSection(sectionUrl,selectedSectionId){
 const id=seoEtsySectionId(sectionUrl);
 if(!id)return null;
 if(String(selectedSectionId||'')!==id)
   throw Error('The selected Etsy shop section does not match the pasted SEO section link. Click Apply SEO Output again and verify the Shop section before creating the draft.');
 return id;
}
