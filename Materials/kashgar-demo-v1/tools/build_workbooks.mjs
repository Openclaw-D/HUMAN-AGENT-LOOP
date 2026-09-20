import fs from 'node:fs/promises';
import path from 'node:path';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const root=path.resolve(process.argv[2]);
const qa=path.resolve(process.argv[3]);
await fs.mkdir(qa,{recursive:true});
const index=JSON.parse(await fs.readFile(path.join(root,'case-index.json'),'utf8'));
const col=n=>{let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
for(const c of index.cases){
 const data=JSON.parse(await fs.readFile(path.join(root,c.id,'workbook-data.json'),'utf8'));
 const wb=Workbook.create();
 // Source tabs retain row-level identity; statements calculate from monthly balances.
 const ordered=[data.tables[1],data.tables[0],...data.tables.slice(2)];
 for(const t of ordered)wb.worksheets.add(t.title);
 for(const t of ordered){
  const sh=wb.worksheets.getItem(t.title),end=col(t.headers.length),last=t.rows.length+4;
  sh.showGridLines=false;
  const titleEnd=col(Math.min(6,t.headers.length));
  sh.getRange(`A1:${titleEnd}1`).merge();sh.getRange('A1').values=[[c.name+' · '+t.title]];
  sh.getRange(`A2:${titleEnd}2`).merge();sh.getRange('A2').values=[['模拟演示｜金额单位：人民币元（另有标注除外）｜2023-01至2026-08｜无真实个人或客户资料']];
  sh.getRange(`A4:${end}4`).values=[t.headers];
  const values=t.rows.map(row=>row.map(v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)?new Date(v+'T00:00:00Z'):v));
  sh.getRange(`A5:${end}${last}`).values=values;
  sh.getRange(`A1:${end}${last}`).format.font.name='Microsoft YaHei';
  sh.getRange(`A1:${end}${last}`).format.font.size=10;
  sh.getRange(`A1:${end}1`).format.font.size=16;
  sh.getRange(`A1:${end}1`).format.font.bold=true;
  sh.getRange(`A1:${end}2`).format.rowHeight=30;
  sh.getRange(`A4:${end}4`).format.fill='#252525';
  sh.getRange(`A4:${end}4`).format.font.color='#FFFFFF';
  sh.getRange(`A4:${end}4`).format.rowHeight=38;
  sh.getRange(`A4:${end}4`).format.wrapText=true;
  sh.getRange(`A5:${end}${last}`).format.rowHeight=38;
  sh.getRange(`A5:${end}${last}`).format.wrapText=true;
  sh.getRange(`A1:${end}${last}`).format.verticalAlignment='center';
  sh.getRange(`A:${end}`).format.columnWidth=21;
  sh.getRange('A:A').format.columnWidth=t.title.includes('财务')||t.title==='年度报表'?22:46;
  for(let j=0;j<t.headers.length;j++){
   const letter=col(j+1),sample=values.find(x=>x[j]!=null)?.[j];
   if(sample instanceof Date)sh.getRange(`${letter}5:${letter}${last}`).setNumberFormat('yyyy-mm-dd');
   else if(typeof sample==='number')sh.getRange(`${letter}5:${letter}${last}`).setNumberFormat(t.headers[j].includes('利率')?'0.0%':'#,##0.00');
   else if(t.rows.some(row=>String(row[j]??'').length>16)||t.headers[j].includes('号')||t.headers[j].includes('关联')||t.headers[j].includes('备注')||t.headers[j].includes('口径'))sh.getRange(`${letter}:${letter}`).format.columnWidth=46;
  }
  sh.freezePanes.freezeRows(4);
 }
 const m=wb.worksheets.getItem('月度财务');
 for(let r=5;r<=48;r++){
  const prev=r-1,base=c.opening;
  m.getRange(`J${r}`).formulas=[[`=B${r}-SUM(C${r}:I${r})`]];
  m.getRange(`U${r}`).formulas=[[`=K${r}-L${r}-'税务台账'!E${r}-D${r}-E${r}-F${r}-H${r}-I${r}-M${r}`]];
  m.getRange(`W${r}`).formulas=[[`=U${r}-V${r}`]];
  m.getRange(`N${r}`).formulas=[[`=${r===5?base.cash:'N'+prev}+W${r}`]];
  m.getRange(`O${r}`).formulas=[[`=${r===5?base.ar:'O'+prev}+B${r}+'税务台账'!C${r}-K${r}`]];
  m.getRange(`P${r}`).formulas=[[`=${r===5?base.inventory:'P'+prev}+L${r}-C${r}`]];
  m.getRange(`Q${r}`).formulas=[[`=${r===5?base.fixedAssets:'Q'+prev}-G${r}`]];
  m.getRange(`S${r}`).formulas=[[`=${r===5?base.equity:'S'+prev}+J${r}-V${r}`]];
  m.getRange(`T${r}`).formulas=[[`=SUM(N${r}:Q${r})`]];
 }
 const a=wb.worksheets.getItem('年度报表');
 for(let i=0;i<4;i++){
  const r=i+5,start=5+i*12,end=i===3?48:start+11;
  a.getRange(`B${r}`).formulas=[[`=SUM('月度财务'!B${start}:B${end})`]];
  a.getRange(`C${r}`).formulas=[[`=SUM('月度财务'!J${start}:J${end})`]];
  for(let j=0;j<7;j++)a.getRange(`${col(j+4)}${r}`).formulas=[[`='月度财务'!${col(j+14)}${end}`]];
  a.getRange(`K${r}`).formulas=[[`=SUM('月度财务'!U${start}:U${end})`]];
 }
 wb.recalculate();
 const actual=a.getRange('B5:K8').values;
 for(let r=0;r<4;r++)for(let j=0;j<10;j++)if(Math.abs(actual[r][j]-data.tables[1].rows[r][j+1])>.01)throw Error(`${c.id} annual mismatch ${r},${j}: ${actual[r][j]}`);
 // A disposable edit checks that source-driven formulas really recalculate.
 const old=m.getRange('F48').values[0][0];m.getRange('F48').values=[[old+100]];wb.recalculate();
 if(Math.abs(a.getRange('C8').values[0][0]-(data.tables[1].rows[3][2]-100))>.01)throw Error('Recalculation failed');
 m.getRange('F48').values=[[old]];wb.recalculate();
 const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:15},maxChars:1800});
 await fs.writeFile(path.join(qa,c.id+'-formula-scan.jsonl'),errors.ndjson);
 if(!errors.ndjson.includes('matched 0 entries'))throw Error('Unexpected formula scan: '+errors.ndjson);
 await (await SpreadsheetFile.exportXlsx(wb)).save(path.join(qa,c.id+'.xlsx'));
 await fs.copyFile(path.join(qa,c.id+'.xlsx'),path.join(root,c.id,'经营台账.xlsx'));
 await fs.writeFile(path.join(qa,c.id+'-workbook-verification.json'),JSON.stringify({annualReconciliation:'PASS',recalculation:'PASS',formulaErrors:0}));
 for(const t of ordered){
  const end=col(Math.min(6,t.headers.length));
  const image=await wb.render({sheetName:t.title,range:`A1:${end}${Math.min(12,t.rows.length+4)}`,scale:1,format:'png'});
  await fs.writeFile(path.join(qa,c.id+'-'+t.title+'.png'),new Uint8Array(await image.arrayBuffer()));
 }
 console.log(JSON.stringify({case:c.id,sheets:ordered.length,annualReconciliation:'PASS',recalculation:'PASS'}));
}
