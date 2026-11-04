// Temporary problems (a dropped or slow connection, a busy server) are worth
// another try; anything else (a refused upload, a broken PSD) is not.
const TRANSIENT=/timed? ?out|aborted|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|socket|fetch failed|network|HTTP (408|429|5\d\d)/i;
export const isTransientError=error=>TRANSIENT.test(String(error?.message||error))||TRANSIENT.test(String(error?.cause?.code||''));

// A finished or failed crop is reported to its shop for about 3 minutes while
// the shop is unreachable (a Render deploy or restart), so the result is not lost.
export function withReportRetries(task,{attempts=12,delayMs=15000,log=console.error}={}){
  return withUploadRetries(task,{attempts,delayMs,log:message=>log(message.replace('Upload','Report')),fixedDelay:true});
}

// Runs an upload up to 3 times while its failures are temporary.
export async function withUploadRetries(task,{attempts=3,delayMs=2000,log=console.error,fixedDelay=false}={}){
  for(let attempt=1;;attempt++){
    try{return await task()}
    catch(error){
      if(attempt>=attempts||!isTransientError(error))throw error;
      log('Upload interrupted ('+error.message+'); retrying ('+(attempt+1)+'/'+attempts+').');
      await new Promise(resolve=>setTimeout(resolve,fixedDelay?delayMs:delayMs*attempt));
    }
  }
}
