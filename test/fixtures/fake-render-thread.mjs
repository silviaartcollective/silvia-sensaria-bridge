// Stands in for worker/render-thread.mjs in tests: a PSD named *hang* never
// answers; anything else renders at once.
import {parentPort} from 'node:worker_threads';
parentPort?.on('message',({id,args})=>{
  if(/hang/.test(args.psdPath))return;
  parentPort.postMessage({id,result:{ok:true,psdPath:args.psdPath,preparedFromCache:false}});
});
