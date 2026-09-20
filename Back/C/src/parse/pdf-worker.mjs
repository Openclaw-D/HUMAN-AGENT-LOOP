import { parentPort, workerData } from 'node:worker_threads';
import { getDocument, version } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const packageDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
let task;
try {
 task = getDocument({data:new Uint8Array(workerData.bytes),isEvalSupported:false,
  useSystemFonts:false,useWorkerFetch:false,disableFontFace:true,stopAtErrors:true,
  cMapUrl:path.join(packageDir,'cmaps').replaceAll('\\','/')+'/',cMapPacked:true,
  standardFontDataUrl:path.join(packageDir,'standard_fonts').replaceAll('\\','/')+'/',
  verbosity:0});
 const doc=await task.promise;
 if(doc.numPages>workerData.maxPages)throw new Error('PDF_PAGE_LIMIT');
 const pages=[];let count=0;
 for(let page=1;page<=doc.numPages;page++){
  const p=await doc.getPage(page);
  const content=await p.getTextContent();
  let text='',lastY=null;
  for(const item of content.items){
   if(typeof item.str!=='string')continue;
   const y=item.transform?.[5];
   if(lastY!==null && y!==undefined && Math.abs(y-lastY)>1 && !text.endsWith('\n'))text+='\n';
   text+=item.str;
   if(item.hasEOL)text+='\n';
   if(y!==undefined)lastY=y;
  }
  text=text.trim();count+=text.length;
  if(count>workerData.maxTextChars)throw new Error('PDF_TEXT_LIMIT');
  pages.push({page,text});p.cleanup();
 }
 parentPort.postMessage({ok:true,pages,pdfjsVersion:version});
} catch(e) {
 parentPort.postMessage({ok:false,code:e?.name==='PasswordException'?'PDF_ENCRYPTED':
  /^PDF_(PAGE|TEXT)_LIMIT$/.test(e?.message)?e.message:'PDF_INVALID'});
} finally { if(task)await task.destroy(); }
