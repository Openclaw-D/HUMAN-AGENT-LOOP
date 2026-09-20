import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { parseArtifactBytes, PARSE_ADAPTERS_VERSION } from './adapters.mjs';

export const ASYNC_PARSE_VERSION = PARSE_ADAPTERS_VERSION + ':pdfjs-6.3.289-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const rejected = (code, detail) => ({ok:false,code,format:'pdf',detail,manualEntry:true,previewSafe:true,previewFormat:'pdf'});
/** No URLs, scripts, OCR or network providers; resource-bounded text extraction in an owned worker. */
export async function parseArtifactBytesAsync(bytes, meta={}, limits={}) {
 if(!Buffer.isBuffer(bytes)||bytes.subarray(0,5).toString()!=='%PDF-')return parseArtifactBytes(bytes,meta);
 const maxBytes=limits.maxBytes??20*1024*1024;
 if(bytes.length>maxBytes)return rejected('PARSE_FAILED','PDF_BYTE_LIMIT：文件超限');
 const result=await new Promise(resolve=>{
  let worker,settled=false;
  const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);void worker?.terminate();resolve(value);};
  const timer=setTimeout(()=>finish({ok:false,code:'PDF_TIMEOUT'}),limits.timeoutMs??15000);
  try {
   worker=new Worker(new URL('./pdf-worker.mjs',import.meta.url),{workerData:{bytes,maxPages:limits.maxPages??100,maxTextChars:limits.maxTextChars??500000},
    execArgv:process.execArgv.filter(a=>!a.startsWith('--input-type')),resourceLimits:{maxOldGenerationSizeMb:256}});
   worker.once('message',finish);worker.once('error',()=>finish({ok:false,code:'PDF_WORKER_FAILED'}));
   worker.once('exit',()=>finish({ok:false,code:'PDF_WORKER_EXIT'}));
  }catch{finish({ok:false,code:'PDF_WORKER_FAILED'});}
 });
 if(!result.ok)return rejected('PARSE_FAILED',result.code+': 无法可靠读取PDF，请人工核验');
 const text=result.pages.map(p=>p.text).join('\n');
 if(!text.trim())return rejected('FORMAT_UNSUPPORTED','PDF无可提取文本层；未执行OCR，请人工录入');
 const base=parseArtifactBytes(Buffer.from(text,'utf8'),{...meta,fileName:'extracted.txt',contentType:'text/plain'});
 const artifactHash=hash(bytes);
 return {...base,ok:true,format:'keyvalue_pdf',parserVersion:ASYNC_PARSE_VERSION,
  text,declaredFacts:base.declaredFacts??[],qualityFlags:base.qualityFlags??[],
  pages:result.pages.map(p=>({...p,artifactHash,textHash:hash(p.text),locator:{kind:'page',start:p.page,end:p.page}})),
  artifactHash,pdfjsVersion:result.pdfjsVersion,previewSafe:true,previewFormat:'pdf',
  note:'PDF.js原件文本提取；事实仍为待核验声明，不构成审批。',
  parseId:'prs-'+hash(artifactHash+ASYNC_PARSE_VERSION).slice(0,16)};
}
