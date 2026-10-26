// ChatGPT SEO settings (Daily Listings and the Listing Reposter): the model and
// the instructions ChatGPT gets, stored on the server (ai-seo.mjs).
(()=>{'use strict';
if(!document.getElementById('ai-instructions'))return;
const el=id=>document.getElementById(id);
async function request(path,body){
 const res=await fetch(path,body===undefined?{cache:'no-store'}:
   {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
 let data;try{data=await res.json();}catch{throw Error('Server returned an invalid response (HTTP '+res.status+').');}
 if(!res.ok||!data.ok){const error=Error(data.error||'Request failed (HTTP '+res.status+').');error.data=data;throw error;}
 return data;
}
const notice=(id,text,kind='')=>{const node=el(id);node.className='notice'+(kind?' '+kind:'');node.textContent=text;};

// ChatGPT SEO settings
let defaults={instructions:'',model:''};
async function loadSettings(){
 const data=await request('/api/ai-seo/settings');
 defaults=data.defaults;
 el('ai-model').value=data.settings.model;el('ai-instructions').value=data.settings.instructions;
 el('ai-state').textContent=data.configured?'Connected':'Not connected';
 if(!data.configured)notice('ai-status','ChatGPT is not connected yet. Add your OpenAI API key in Render as OPENAI_API_KEY (Environment), then reload this page.','warn');
 return data;
}
el('ai-default').addEventListener('click',()=>{el('ai-instructions').value=defaults.instructions;el('ai-model').value=defaults.model;});
el('ai-save').addEventListener('click',async()=>{
 el('ai-save').disabled=true;
 try{
  const data=await request('/api/ai-seo/settings',{instructions:el('ai-instructions').value,model:el('ai-model').value});
  el('ai-instructions').value=data.settings.instructions;el('ai-model').value=data.settings.model;
  notice('ai-status',data.settings.custom?'Saved. ChatGPT uses your instructions.':'Saved. ChatGPT uses the built-in instructions.');
 }catch(error){notice('ai-status',String(error.message||error),'error');}
 finally{el('ai-save').disabled=false;}
});
void loadSettings().catch(error=>notice('ai-status',String(error.message||error),'error'));
})();
