// Temporary problems (a dropped or slow connection, a busy server) are worth
// another try; anything else (a refused upload, a broken PSD) is not.
const TRANSIENT=/timed? ?out|aborted|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|socket|fetch failed|network|HTTP (408|429|5\d\d)/i;
export const isTransientError=error=>TRANSIENT.test(String(error?.message||error))||TRANSIENT.test(String(error?.cause?.code||''));

// Runs an upload up to 3 times while its failures are temporary.
export async function withUploadRetries(task,{attempts=3,delayMs=2000,log=console.error}={}){
  for(let attempt=1;;attempt++){
    try{return await task()}
    catch(error){
      if(attempt>=attempts||!isTransientError(error))throw error;
      log('Upload interrupted ('+error.message+'); retrying ('+(attempt+1)+'/'+attempts+').');
      await new Promise(resolve=>setTimeout(resolve,delayMs*attempt));
    }
  }
}
