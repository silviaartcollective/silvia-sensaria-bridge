// Pure scheduling helpers shared by the runner and its regression tests.
export function rotatingApps(apps,position){
  if(!Array.isArray(apps)||!apps.length)return [];
  const start=((position%apps.length)+apps.length)%apps.length;
  return apps.map((_,index)=>apps[(start+index)%apps.length]);
}
export function heartbeatFor(app,active){
  return {busy:Boolean(active),jobId:active?.app?.appUrl===app.appUrl ? active.job.id : '',
    sharedWorker:true,activeApp:active?.app?.name||''};
}
