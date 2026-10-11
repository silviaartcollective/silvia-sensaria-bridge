// Automatically request the existing shared Windows crop worker when an admin page opens.
// Browsers can require permission or a user click for custom URL protocols; keep a manual fallback.
(()=>{
 'use strict';
 if(window.__sharedCropWorkerAutoStart)return;
 window.__sharedCropWorkerAutoStart=true;
 const URL='pod-crop-worker://start';
 const STATUS='/api/crop-worker/status';
 const KEY='pod-crop-worker-autostart-v1';
 const COOLDOWN=10*60*1000;
 const isWindows=()=>/win/i.test(String(navigator.userAgentData?.platform||navigator.platform||navigator.userAgent||''));
 const lastAttempt=()=>{try{return Number(sessionStorage.getItem(KEY)||0)}catch{return 0}};
 const saveAttempt=()=>{try{sessionStorage.setItem(KEY,String(Date.now()))}catch{}};
 let checking=false,visibilityListenerAdded=false;
 async function getWorker(){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);
  try{
   const response=await fetch(STATUS,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
   if(!response.ok)return null;
   const data=await response.json();
   return data?.ok===true&&data.worker?data.worker:null;
  }catch{return null}
  finally{clearTimeout(timeout)}
 }
 function removeFallback(){
  document.getElementById('shared-worker-autostart-fallback')?.remove();
 }
 function manualFallback(){
  const foot=document.querySelector('.shared-admin-foot');
  if(!foot)return;
  let line=document.getElementById('shared-worker-autostart-fallback');
  if(line)return;
  line=document.createElement('div');
  line.id='shared-worker-autostart-fallback';
  line.style.cssText='font-size:12px;line-height:1.5;margin-top:12px;padding-top:10px;border-top:1px solid #ffffff22;color:#cbd2c7;';
  const text=document.createElement('span');
  text.textContent='Crop worker is offline. If your browser blocked startup, ';
  const link=document.createElement('a');
  link.href=URL;
  link.textContent='launch it here';
  link.style.cssText='color:#fff;text-decoration:underline;font-weight:650;';
  line.append(text,link,document.createTextNode('.'));
  foot.append(line);
 }
 async function verifyStartup(){
  const status=await getWorker();
  if(status?.online){removeFallback();return}
  if(status?.configured)manualFallback();
 }
 async function attemptLaunch(){
  if(checking||!isWindows()||window.top!==window.self)return;
  checking=true;
  try{
   const status=await getWorker();
   if(!status||!status.configured){return}
   if(status.online){removeFallback();return}
   if(document.visibilityState==='hidden'){
    if(!visibilityListenerAdded){
     visibilityListenerAdded=true;
     document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState!=='hidden'){visibilityListenerAdded=false;void attemptLaunch()}
     },{once:true});
    }
    return;
   }
   const since=Date.now()-lastAttempt();
   if(since>=0&&since<COOLDOWN){setTimeout(verifyStartup,1500);return}
   saveAttempt();
   // This uses the already-installed Windows URL-protocol handler.
   // A user-facing browser permission dialog may appear, or automation may be blocked.
   try{window.location.href=URL}catch{manualFallback()}
   setTimeout(verifyStartup,12000);
  }finally{checking=false}
 }
 if(document.readyState==='loading')
  document.addEventListener('DOMContentLoaded',()=>{void attemptLaunch()},{once:true});
 else void attemptLaunch();
})();
