from pathlib import Path
import json,csv,hashlib,html,re
from pypdf import PdfReader,PdfWriter
import pypdfium2 as pdfium
from PIL import Image,ImageOps,ImageDraw

ROOT=Path(__file__).resolve().parents[1]
QA=ROOT.parents[1]/'.local/kashgar-material-build/qa'
QA.mkdir(parents=True,exist_ok=True)
index=json.loads((ROOT/'case-index.json').read_text(encoding='utf-8'))
allchecks=[]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def readcsv(p):
 with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def montage(paths,out,columns=3,width=340):
 thumbs=[]
 for path in paths:
  im=Image.open(path).convert('RGB');im.thumbnail((width,400))
  card=Image.new('RGB',(width,430),'#dddddd');card.paste(im,((width-im.width)//2,25));ImageDraw.Draw(card).text((5,5),path.stem[:44],fill='black');thumbs.append(card)
 canvas=Image.new('RGB',(columns*width,((len(thumbs)+columns-1)//columns)*430),'white')
 for i,im in enumerate(thumbs):canvas.paste(im,((i%columns)*width,(i//columns)*430))
 canvas.save(out)

for c in index['cases']:
 folder=ROOT/c['id'];orig=folder/'originals'
 result=json.loads((QA/(c['id']+'-workbook-verification.json')).read_text())
 assert result=={'annualReconciliation':'PASS','recalculation':'PASS','formulaErrors':0}
 extra=folder/'经营台账.xlsx.inspect.ndjson'
 if extra.exists():extra.replace(QA/(c['id']+'-export-inspect.ndjson'))
 pdf=PdfReader(folder/'原始材料阅读册.pdf');assert len(pdf.pages)==22
 for i,page in enumerate(pdf.pages):assert '模拟' in page.extract_text(),(c['id'],i)
 # Page originals share the source group of their Markdown; never independent evidence.
 for i,md in enumerate(sorted(orig.glob('D??-*.md')),1):
  writer=PdfWriter();writer.add_page(pdf.pages[i]);writer.write(orig/(md.stem+'.pdf'))
 months=readcsv(orig/'月度财务.csv');bank=readcsv(orig/'银行流水.csv');sales=readcsv(orig/'销售开票回款.csv');purchase=readcsv(orig/'采购进项付款.csv');eq=readcsv(orig/'设备清单.csv')
 assert len(months)==44
 balance=c['opening']['cash'];cashchecks=0
 for r in bank:
  balance+=int(r['收入元'])-int(r['支出元']);assert balance==int(r['余额元']);cashchecks+=1
 assert balance==c['latest']['cash']
 for m in months:
  ym=m['月份'];b=[x for x in bank if x['日期'].startswith(ym)];s=[x for x in sales if x['合同日期'].startswith(ym)];p=[x for x in purchase if x['日期'].startswith(ym)]
  assert sum(int(x['不含税元']) for x in s)==int(m['收入元'])
  assert sum(int(x['已回款元']) for x in s)==sum(int(x['收入元']) for x in b)
  assert sum(int(x['价税合计元']) for x in p)==sum(int(x['支出元']) for x in b if x['摘要']=='原料付款')
  assert int(m['资产元'])==int(m['权益元'])+int(m['负债元'])
  assert int(m['现金净变动元'])==sum(int(x['收入元'])-int(x['支出元']) for x in b)
 assert sum(int(x['净值元']) for x in eq)==c['latest']['netFixedAssets']
 ar=readcsv(orig/'应收明细.csv');assert sum(int(x['余额元']) for x in ar)==c['latest']['receivables']
 # Include cash-flow statement, not just income and balance sheet fields.
 headers=['period','operating_cash_yuan','investing_cash_yuan','financing_cash_yuan','net_cash_change_yuan','ending_cash_yuan','sourceMode']
 with (orig/'现金流量表.csv').open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.writer(f);w.writerow(headers)
  for year in ['2023','2024','2025','2026']:
   rows=[r for r in months if r['月份'].startswith(year)]
   w.writerow([year if year!='2026' else '2026-01至08',sum(int(r['经营净现金元']) for r in rows),0,-sum(int(r['分红筹资流出元']) for r in rows),sum(int(r['现金净变动元']) for r in rows),rows[-1]['现金元'],'synthetic'])
 entries=[]
 kinds={t['title']:t['kind'] for t in json.loads((folder/'workbook-data.json').read_text(encoding='utf-8'))['tables']}
 kinds.update({'接口财务2025':'financial_statement','接口设备':'equipment_list','现金流量表':'financial_statement'})
 docKinds=['document','legal_document','legal_document','legal_document','document','financial_statement','statement','tax_filing','order_contract','order_contract','accounting_ledger','order_contract','accounting_ledger','equipment_contract','ownership_document','ownership_document','document','accounting_ledger','site_evidence','document','document']
 for path in sorted(orig.iterdir()):
  match=re.match(r'D(\d+)-',path.name);docid=f'D{int(match[1]):02}' if match else path.stem
  kind=docKinds[int(match[1])-1] if match else kinds.get(path.stem,'site_evidence' if path.suffix=='.svg' else 'document')
  # financial parser copies must not inflate evidence with multiple formats.
  sourceid={'接口财务2025':'年度报表','接口设备':'设备清单'}.get(docid,docid)
  entries.append(dict(materialId=c['id']+'-'+docid,file=path.relative_to(ROOT).as_posix(),kind=kind,contentType={'.pdf':'application/pdf','.csv':'text/csv','.md':'text/markdown','.svg':'image/svg+xml'}[path.suffix],sha256=sha(path),bytes=path.stat().st_size,sourceGroup=c['id']+'-'+sourceid,sourceMode='synthetic',authority='none',verification='declared',uploadByDefault=path.suffix in ['.csv','.pdf'] and path.stem not in ['年度报表','月度财务','设备清单'],caliber='模拟资料；金额元，接口投影列_wan为万元；期间以文件内容为准',duplicateRepresentation=path.suffix=='.md' or path.stem.startswith('接口'),parserStatus='NOT_RUN',customerKey=c['id']))
 manifest=dict(schemaVersion='kashgar-materials@1.0',customerKey=c['id'],legalEntityRef=c['legalEntityRef'],sourceMode='synthetic',runtimeCustomerId=None,materials=entries,note='本地材料ID不是A工件ID；运行身份和邀请由授权流程获取。PDF与MD同源，XLSX为全部CSV的展示汇编。')
 (folder/'material-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
 # Preview every PDF page; contact sheets plus full-size reviewable pages.
 rendered=[];doc=pdfium.PdfDocument(str(folder/'原始材料阅读册.pdf'))
 for i in range(len(doc)):
  path=QA/f'{c["id"]}-pdf-{i+1:02}.png';doc[i].render(scale=1.1).to_pil().save(path);rendered.append(path)
 montage(rendered,QA/(c['id']+'-pdf-contact.png'),columns=4,width=240)
 images=[QA/(c['id']+'-'+t['title']+'.png') for t in json.loads((folder/'workbook-data.json').read_text(encoding='utf-8'))['tables']]
 montage(images,QA/(c['id']+'-xlsx-contact.png'),columns=2,width=650)
 allchecks.append(dict(case=c['id'],pdfPages=len(pdf.pages),csvFiles=len(list(orig.glob('*.csv'))),originalPdfFiles=len(list(orig.glob('*.pdf'))),months=44,bankTransactions=cashchecks,salesOrders=len(sales),purchaseOrders=len(purchase),equipment=len(eq),balanceSheet='PASS',bankRunningBalance='PASS',salesInvoicesReceipts='PASS',purchasePayments='PASS',receivables='PASS',equipmentNetValue='PASS',xlsxFormulaRecalculation='PASS',runtimeUpload='NOT_RUN',realCustomerDocuments=False))

report={'version':'1.0.0','checks':allchecks,'visualReview':'PENDING','gaps':['无真实客户授权原件','无真实现场影像','无外部征信/登记/诉讼核验','税务及财务科目为简化演示口径','未完成当前应用上传/解析/业务旅程联调','无用户视觉或业务验收'],'git':'intended_for_git; not staged/committed/pushed'}
(ROOT/'VALIDATION.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
cards=[]
for c in index['cases']:
 manifest=json.loads((ROOT/c['id']/'material-manifest.json').read_text(encoding='utf-8'))
 links=''.join(f'<li><a href="{html.escape(e["file"])}">{html.escape(Path(e["file"]).name)}</a> <small>{e["kind"]}</small></li>' for e in manifest['materials'] if not e['file'].endswith('.md'))
 cards.append(f'<section><h2>{html.escape(c["name"])}</h2><p>{html.escape(c["industry"])} · {c["amount"]//10000}万元 · {c["grade"]}案例</p><p>{html.escape(c["brand"])}</p><p><a class="button" href="{c["id"]}/原始材料阅读册.pdf">阅读材料册</a> <a class="button" href="{c["id"]}/经营台账.xlsx">打开经营台账</a></p><details><summary>逐件查看原始材料</summary><ul>{links}</ul></details><p><a href="{c["id"]}/material-manifest.json">接口材料索引</a> · <a href="{c["id"]}/DEMO_EXPECTATIONS.md">演示预期</a></p></section>')
(ROOT/'index.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>喀什三客户模拟材料包</title><style>body{max-width:1180px;margin:40px auto;padding:0 24px;background:#f5f4f1;color:#252525;font:16px/1.7 system-ui}h1{font-size:30px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}section{background:white;border:1px solid #ddd;padding:24px;border-radius:10px}h2{font-size:21px}a{color:#333}small{color:#777}li{margin:9px 0;overflow-wrap:anywhere}.button{display:inline-block;padding:8px 12px;background:#eee;text-decoration:none}.note{background:#fff0c8;padding:16px}summary{cursor:pointer}ul{padding-left:20px}</style><h1>喀什三客户模拟材料包</h1><p>原始材料、经营台账、来源索引 · 2026-08-31基准</p><p class="note">全部为模拟演示。没有真实客户原件、真实签章或已核实身份。此页仅用于材料浏览，尚未接入JW业务页面及接口。</p><main>'+''.join(cards)+'</main><p><a href="README.md">范围与来源说明</a> · <a href="INTEGRATION.md">页面与接口接续</a> · <a href="VALIDATION.json">校验记录</a></p></html>',encoding='utf-8')
print(json.dumps(allchecks,ensure_ascii=False,indent=2))
