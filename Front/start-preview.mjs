// No npm packages required: serve the checked-in production build on loopback.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const dist=path.join(path.dirname(fileURLToPath(import.meta.url)),'dist');
const requested=process.argv.find(a=>a.startsWith('--port='));
const port=requested?Number(requested.slice(7)):3618;
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid port');
if(!fs.existsSync(path.join(dist,'index.html'))){console.error('Front/dist is missing. Run npm ci && npm run build in Front first.');process.exit(1);}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
 let pathname;
 try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end('Bad request');return;}
 if(pathname==='/__jw_preview_health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({project:'JW',mode:'frontend-demo',backendConnected:false}));return;}
 if(pathname.includes('\0')||pathname.includes('\\')){res.writeHead(400);res.end('Bad path');return;}
 const file=path.resolve(dist,'.'+(pathname==='/'?'/index.html':pathname));
 const relative=path.relative(dist,file);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)){res.writeHead(403);res.end('Forbidden');return;}
 try{
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Not a regular file');
  const real=path.relative(fs.realpathSync(dist),fs.realpathSync(file));
  if(real==='..'||real.startsWith('..'+path.sep)||path.isAbsolute(real)){res.writeHead(403);res.end('Forbidden');return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
  if(req.method==='HEAD'){res.end();return;}
  const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
 }catch{res.writeHead(404);res.end('Not found');}
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is occupied. Nothing was stopped. Close the other preview or run node Front/start-preview.mjs --port=3619.`:error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{
 const url=`http://127.0.0.1:${server.address().port}/`;
 console.log(`JW frontend demo: ${url}\nLocal simulation; not connected to Back.\nKeep this window open. Press Ctrl+C to stop.`);
 if(process.platform==='win32'&&!process.argv.includes('--no-open')){
  const opener=spawn('cmd.exe',['/d','/c','start','',url],{windowsHide:true,stdio:'ignore'});
  opener.on('error',()=>console.log('Open the URL above in your browser.'));
 }
});
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
