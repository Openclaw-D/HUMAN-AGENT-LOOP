"""Reproducible synthetic customer documents. No private source data or network calls."""
from pathlib import Path
import json, csv, hashlib, math, html
from datetime import date
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4

ROOT=Path(__file__).resolve().parents[1]
STAMP='2026-09-20'
NOTE='模拟演示 / SYNTHETIC - 非真实客户资料，不具证明或签署效力'
pdfmetrics.registerFont(TTFont('CN','C:/Windows/Fonts/msyh.ttc',subfontIndex=0))
STYLE=ParagraphStyle('text',fontName='CN',fontSize=10,leading=17,spaceAfter=9,wordWrap='CJK')
TITLE=ParagraphStyle('title',parent=STYLE,fontSize=20,leading=28,spaceAfter=18)
SMALL=ParagraphStyle('small',parent=STYLE,fontSize=8,leading=12)
CASES=[
 dict(id='KS-TEXTILE-200',name='喀什示例棉纺有限公司',industry='棉纱纺织',brand='卓朗（用户称谓；官方中文为卓郎）',amount=2000000,grade='较差',rev=1800000,growth=-0.08,raw=.65,pay=140000,energy=110000,admin=90000,debt=4800000,rate=.08,fa=8000000,depr=60000,cash=800000,ar=1000000,inv=800000,ap=1000000,count=4,unit='kg',price=22,rawprice=15,employees=28,product='棉纱',material='皮棉',yieldrate=.90,collection=.99,recent=.78),
 dict(id='KS-LASER-500',name='喀什示例金属加工有限公司',industry='激光金属加工',brand='邦德激光',amount=5000000,grade='正常',rev=2300000,growth=.05,raw=.50,pay=350000,energy=150000,admin=180000,debt=4000000,rate=.06,fa=14000000,depr=90000,cash=1500000,ar=1000000,inv=1200000,ap=900000,count=7,unit='件',price=230,rawprice=6,employees=50,product='标准金属加工件',material='钢板',yieldrate=.85,collection=.995,recent=.95),
 dict(id='KS-INJECTION-1000',name='喀什示例塑料制品有限公司',industry='注塑制品生产',brand='华美达',amount=10000000,grade='较好',rev=4200000,growth=.08,raw=.43,pay=520000,energy=260000,admin=320000,debt=6000000,rate=.05,fa=26000000,depr=180000,cash=3000000,ar=1400000,inv=1800000,ap=1400000,count=13,unit='件',price=12,rawprice=8,employees=80,product='工业塑料周转配件',material='PP粒子',yieldrate=.97,collection=1.0,recent=.99)
]

def dump(path,obj):
 path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8')
def csvwrite(path,headers,rows):
 path.parent.mkdir(parents=True,exist_ok=True)
 with path.open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.writer(f);w.writerow(headers);w.writerows(rows)
def p(text,style=STYLE):return Paragraph(html.escape(str(text)),style)
def money(v):return f'{v/10000:,.2f} 万元'
def page(canvas,doc):
 canvas.setFont('CN',8);canvas.setFillColor(colors.HexColor('#777777'));canvas.drawString(40,24,NOTE);canvas.drawRightString(A4[0]-40,24,str(doc.page))
def make_pdf(path,c,sections):
 flow=[p(c['name'],TITLE),p(f"{c['industry']} / 新疆喀什 / 申请 {money(c['amount'])}"),p(NOTE),p('原始材料阅读册 · v1.0 · 基准日 2026-08-31'),p('所有企业、个人、交易、设备参数、价格和核验记录均为模拟。品牌仅为设备使用场景，不表示品牌参与或背书。'),p('配套经营台账.xlsx及originals目录CSV保存完整明细；本册保留来源编号与关键条款。2023-2025年为完整年度，2026年为1-8月，禁止把八个月收入冒充年收入。')]
 for sid,title,kind,body,table in sections:
  flow.extend([PageBreak(),p(f'{sid}  {title}',TITLE),p(f"主体：{c['name']}  /  编号：{c['id']}"),p('记录状态：合成声明，未作真实外部核验。',SMALL)])
  for line in body:flow.append(p(line))
  if table:
   n=len(table[0]); widths=[(A4[0]-80)/n]*n
   t=Table([[p(x,SMALL) for x in row] for row in table],colWidths=widths,repeatRows=1,hAlign='LEFT')
   t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#eeeeee')),('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,0),.5,colors.grey),('BOTTOMPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7)]));flow.append(t)
 SimpleDocTemplate(str(path),pagesize=A4,rightMargin=40,leftMargin=40,topMargin=40,bottomMargin=45,title=c['name']+'模拟原始材料',author='JW Synthetic Demo').build(flow,onFirstPage=page,onLaterPages=page)

def build(c):
 folder=ROOT/c['id']; orig=folder/'originals';orig.mkdir(parents=True,exist_ok=True)
 bank=[];sales=[];purchase=[];production=[];monthly=[];vatrows=[];payrows=[];receivables=[]
 cash=c['cash'];ar=c['ar'];inv=c['inv'];fa=c['fa'];debt=c['debt'];equity=cash+ar+inv+fa-debt-c['ap'];opening_equity=equity
 def txn(dt,ref,counterparty,typ,credit,debit):
  nonlocal cash
  cash+=credit-debit
  bank.append([f"{c['id']}-B{len(bank)+1:04}",dt,ref,counterparty,typ,credit,debit,cash,'CNY','SYNTHETIC'])
 for year in range(2023,2027):
  for m in range(1,13 if year<2026 else 9):
   ym=f'{year}-{m:02}';season=[.80,.72,1.02,1.06,1.10,1.05,1.08,1.08,1.04,1.02,1.06,1.10][m-1]
   revenue=round(c['rev']*((1+c['growth'])**(year-2023))*season)
   units=round(revenue/c['price']);revenue=units*c['price']
   raw=round(revenue*c['raw']);buy=raw+(round(revenue*.035) if c['grade']=='较差' and year==2026 else 0)
   wage=c['pay'];energy=round(c['energy']*season);admin=c['admin'];interest=round(debt*c['rate']/12);depr=c['depr']
   operating=revenue-raw-wage-energy-admin-depr;pretax=operating-interest;incometax=round(max(pretax,0)*.25);net=pretax-incometax
   outvat=round(revenue*.13);invat=round(buy*.13);vat=outvat-invat
   openingcash=cash;collected=0
   shares=[.65,.25,.10] if c['grade']=='较差' else ([.40,.35,.25] if c['grade']=='正常' else [.34,.33,.33])
   allocated=0;vatallocated=0
   for j,share in enumerate(shares):
    netval=round(revenue*share) if j<2 else revenue-allocated;allocated+=netval
    tax=round(outvat*share) if j<2 else outvat-vatallocated;vatallocated+=tax
    ref=f"{c['id']}-S-{year}{m:02}-{j+1}";gross=netval+tax
    rate=c['recent'] if year==2026 else c['collection'];paid=round(gross*rate);collected+=paid
    sales.append([ref,ym+'-05',f'模拟下游{j+1}',c['product'],netval,tax,gross,paid,gross-paid,ym+'-10',ref+'-INV',ref+'-DEL','SYNTHETIC'])
    txn(ym+f'-{12+j:02}',ref,f'模拟下游{j+1}','销售回款',paid,0)
    if gross>paid:receivables.append([ref,f'模拟下游{j+1}',ym+'-10',gross-paid,'本期未收尾款；历史尾款持续未清需解释'])
   ar+=revenue+outvat-collected
   remaining=buy;remainingtax=invat
   for j,share in enumerate([.60,.40]):
    netval=round(buy*share) if j==0 else remaining;tax=round(invat*share) if j==0 else remainingtax;remaining-=netval;remainingtax-=tax
    ref=f"{c['id']}-P-{year}{m:02}-{j+1}"
    purchase.append([ref,ym+'-08',f'模拟原料商{j+1}',c['material'],round(netval/c['rawprice'],3),c['rawprice'],netval,tax,netval+tax,ref+'-INV',ref+'-GRN','SYNTHETIC'])
    txn(ym+f'-{16+j:02}',ref,f'模拟原料商{j+1}','原料付款',0,netval+tax)
   for suffix,party,typ,value in [('PAY','模拟工资代发','工资',wage),('ELEC','模拟供电结算','电费',energy),('OPEX','模拟费用结算','管理销售费用',admin),('INT','模拟融资机构','利息',interest),('VAT','模拟税费账户','增值税',vat),('CIT','模拟税费账户','所得税',incometax)]:
    txn(ym+'-25',f"{c['id']}-{suffix}-{year}{m:02}",party,typ,0,value)
   operatingcash=cash-openingcash
   dividend=0
   if m==12 and c['grade']!='较差':
    dividend=max(0,cash-(2000000 if c['grade']=='正常' else 4000000))
    txn(ym+'-28',c['id']+'-DIV-'+str(year),'模拟股东','利润分配（筹资）',0,dividend)
   inv+=buy-raw;fa-=depr;equity+=net-dividend
   totalassets=cash+ar+inv+fa;liabilities=debt+c['ap']
   assert abs(totalassets-liabilities-equity)<1,(c['id'],ym,totalassets-liabilities-equity)
   monthly.append([ym,revenue,raw,wage,energy,admin,depr,interest,incometax,net,collected,buy,vat,cash,ar,inv,fa,liabilities,equity,totalassets,operatingcash,dividend,cash-openingcash])
   vatrows.append([ym,revenue,outvat,buy,invat,vat,pretax,incometax,ym+'-25','当月收付简化；不代表正式税表'])
   good=units;total=math.ceil(good/c['yieldrate']);rawkg=round(raw/c['rawprice'],3)
   production.append([ym,f"{c['id']}-LOT-{year}{m:02}",c['product'],total,good,total-good,rawkg,round(energy/.75),energy,c['unit'],'计划口径；产能及耗用待现场验证'])
   payrows.append([ym,c['employees'],wage,round(wage/c['employees'],2),f"{c['id']}-PAY-{year}{m:02}",'汇总模拟；工资社保均计入人工费用'])
 assert min(r[7] for r in bank)>=0,(c['id'],'negative cash')
 periods=[]
 for y in range(2023,2027):
  rows=[x for x in monthly if x[0].startswith(str(y))];last=rows[-1]
  periods.append([str(y) if y<2026 else '2026-01至08',sum(r[1] for r in rows),sum(r[9] for r in rows),last[13],last[14],last[15],last[16],last[17],last[18],last[19],sum(r[20] for r in rows)])
 equipment=[];equipgross=c['fa']//c['count'];nbv=(c['fa']-44*c['depr'])//c['count']
 for i in range(c['count']):
  serial=f"SYN-{c['id']}-EQ-{i+1:02}"
  currentnbv=nbv if i<c['count']-1 else c['fa']-44*c['depr']-nbv*(c['count']-1)
  equipment.append([serial,c['brand'],f"SIM-{c['industry']}-{i+1:02}",'2022-12-01',equipgross,equipgross-currentnbv,currentnbv,'self-owned','待人工核验',f"{c['id']}-EQ-CONTRACT",serial+'-INV',serial+'-PAY',serial+'-ACCEPT','喀什模拟厂区A栋','SYNTHETIC'])
 tables=[
 ('月度财务','financial_statement',['月份','收入元','原料成本元','人工元','电费元','管理销售元','折旧元','利息元','所得税元','净利润元','客户回款元','原料采购元','增值税缴付元','现金元','应收元','存货元','固定资产净额元','负债元','权益元','资产元','经营净现金元','分红筹资流出元','现金净变动元'],monthly),
 ('年度报表','financial_statement',['期间','收入元','净利润元','现金元','应收元','存货元','固定资产净额元','负债元','权益元','资产元','经营净现金元'],periods),
 ('银行流水','statement',['流水号','日期','关联单号','对手方','摘要','收入元','支出元','余额元','币种','标识'],bank),
 ('销售开票回款','sales_purchase',['订单号','合同日期','客户','产品','不含税元','税额元','价税合计元','已回款元','未收元','交付日','模拟发票号','交付单号','标识'],sales),
 ('采购进项付款','sales_purchase',['采购号','日期','供应商','原料','数量kg','单价元kg','不含税元','税额元','价税合计元','模拟发票号','入库单号','标识'],purchase),
 ('生产用电','accounting_ledger',['月份','批次','产品','投入件数或kg','良品件数或kg','损耗件数或kg','原料领用kg','电量kWh','电费元','产出单位','备注'],production),
 ('税务台账','tax_filing',['月份','销项计税额元','销项税元','进项计税额元','进项税元','增值税缴付元','税前利润元','所得税元','模拟缴付日','口径'],vatrows),
 ('人员工资','accounting_ledger',['月份','人数','人工费用元','平均人工元','代发关联单','口径'],payrows),
 ('设备清单','equipment_list',['序列号','品牌场景','模拟型号','验收日','原值元','累计折旧元','净值元','权属声明','核验状态','合同号','发票号','付款号','验收号','地点','标识'],equipment),
 ('应收明细','accounting_ledger',['订单号','客户','交付日','余额元','备注'],[['OPENING-AR','模拟历史客户','2022-12-31',c['ar'],'期初历史应收；当前未清偿，需核实可收回性']]+receivables),
 ('债务计划','financial_statement',['债务编号','债权人','期末本金元','年利率','到期日','还本方式','担保','状态'],[[c['id']+'-LOAN','模拟融资机构',debt,c['rate'],'2026-10-31' if c['grade']=='较差' else '2028-12-31','到期还本、每月付息','设备范围待核实' if c['grade']=='较差' else '非本次设备担保','截至基准日无已发生逾期（合成）']]),
 ]
 for title,kind,headers,rows in tables:csvwrite(orig/(title+'.csv'),headers,rows)
 last=monthly[-1];period2025=periods[2];recent=monthly[-8:]
 profile={k:v for k,v in c.items()};profile.update(synthetic=True,legalEntityRef='SYNTHETIC-'+c['id'],region='中国新疆喀什',asOf='2026-08-31',sourceMode='synthetic',authority='none',requestedAmountMinor=c['amount']*100,unit='CNY-yuan',latest={'cash':last[13],'receivables':last[14],'inventory':last[15],'netFixedAssets':last[16],'liabilities':last[17],'equity':last[18],'assets':last[19],'revenue2025':period2025[1],'profit2025':period2025[2],'operatingCash2026Ytd':sum(r[20] for r in recent)},opening={'date':'2022-12-31','cash':c['cash'],'ar':c['ar'],'inventory':c['inv'],'fixedAssets':c['fa'],'debt':debt,'accountsPayable':c['ap'],'equity':opening_equity})
 dump(folder/'customer-profile.json',profile)
 # Annual parser input kept distinct from YTD to prevent false annual revenue aggregation.
 csvwrite(orig/'接口财务2025.csv',['period','revenue_wan','total_assets_wan','total_liabilities_wan','net_fixed_assets_wan','sourceMode'],[['2025',period2025[1]/10000,period2025[9]/10000,period2025[7]/10000,period2025[6]/10000,'synthetic']])
 csvwrite(orig/'接口设备.csv',['equipment_id','model','net_book_value_wan','ownership','sourceMode'],[[e[0],e[2],e[6]/10000,'self-owned','synthetic'] for e in equipment])
 docs=[]
 def doc(sid,title,kind,body,table=None):docs.append((sid,title,kind,body,table))
 doc('D01','融资需求登记','document',[f"申请人：{c['name']}；申请金额 {money(c['amount'])}；业务为新客户首次售后回租预评估。",'用途：采购生产原料、补充订单周转；资金用途须与现有负债偿还需求分别核实。','拟议期限36个月，价格未定；不存在已批准额度或放款承诺。设备所有权、可回租范围及价值须独立核验。',f"设备品牌场景：{c['brand']}。联系人：模拟经办甲；电话不生成，使用 CASE-CONTACT-{c['id']} 内部演示标识。"])
 doc('D02','主体登记资料','legal_document',[f"legal_name={c['name']}",f"uniform_social_credit_code=SYNTHETIC-{c['id']}",'注册地址：中国新疆喀什模拟工业园A区（虚构地址，不对应真实门牌）。','设立日期：2020-03-16；经营范围：本案例对应产品制造销售；登记状态设定为存续。','该页是模拟登记信息单，不仿制营业执照、国徽、印章或有效统一社会信用代码。'])
 doc('D03','章程与股权结构','legal_document',['股东模拟自然人甲持股70%，模拟自然人乙持股30%；最终受益人同前述自然人，无代持设定。',f"实缴资本模拟为 {money(min(opening_equity,3000000))}，其余期初权益为留存收益；权益变动详见报表。",'模拟章程条款：执行董事负责日常经营，融资及担保须按内部授权决议办理；本页不替代正式签署章程。','股权链、实缴来源及关联企业须经外部登记与出资流水核验。'])
 doc('D04','身份与经办授权','legal_document',['法定代表人：模拟自然人甲；证件占位：SYN-ID-A；经办人：模拟经办甲，证件占位：SYN-ID-C。','授权范围：提交本次准入材料、解释经营及设备情况；不包含代替有权人员批准授信。','授权期限：2026-09-01至2026-12-31；签署状态：演示占位，未真实签署。','不生成可用身份证号码、人像证件或私人联系方式。'])
 doc('D05','企业介绍与经营组织','document',[f"生产经营：{c['product']}；原料为{c['material']}；所在地喀什。设备{c['count']}台/组，员工{c['employees']}人。",'厂长负责生产批次、财务负责账务回款、销售负责订单、仓管负责入出库，四方记录通过订单和批次编号关联。','销售为自购原料生产并销售，不含客户来料或代销；本套不设出口收入。'])
 doc('D06','财务报表说明','financial_statement',['2023、2024、2025三个年度及2026年1-8月报表见年度报表.csv；月度财务.csv保留44个月明细。','采用简化模拟科目：现金、应收、存货、固定资产，负债含借款及期初应付；权益按净利润结转并扣除实际模拟分红。','正常和较好案例2023-2025年末进行利润分配，银行摘要标记筹资，经营净现金与现金净变动分别列示；较差案例不分红。分红来源与后续融资必要性须评估。','期间不新增设备、不增减借款本金；期初设备购置已在2022年完成。本模拟未构建法定全科目及所有税种，不能作为审计报告或正式申报报表。'],[['期间','收入','净利润','资产','负债']]+[[r[0],money(r[1]),money(r[2]),money(r[9]),money(r[7])] for r in periods])
 doc('D07','账户与流水声明','statement',[f"唯一模拟经营账户：SYN-ACCOUNT-{c['id']}，期初现金 {money(c['cash'])}。",'银行流水.csv覆盖2023-01至2026-08，最近12个月为2025-09至2026-08。每笔收入和支出有余额及业务关联单号。','销售回款含增值税，营业收入不含税；两者差额通过销项税、应收余额解释，不将银行入账直接当成收入。','期初应收和应付为历史未清事项，详见账龄说明；无隐藏私人账户设定。'])
 doc('D08','税务与发票说明','tax_filing',['税务台账.csv及销售/采购台账为合成申报工作底稿，不是税务机关出具材料。','演示计算假设：货物购销按13%算增值税，正税前利润按25%计所得税；电费及其他费用不抵扣进项。','简化为当月计提当月支付；不模拟优惠、亏损结转、附加税等，因此不能用于实际纳税判断。','模拟发票号以SYN/案例号表达，订单、发票、交付和流水通过关联单号连接。'])
 order=sales[-3]
 doc('D09','销售合同与交付凭据','order_contract',[f"合同号：{order[0]}；卖方{c['name']}；买方{order[2]}。",f"标的：{c['product']}；不含税金额{money(order[4])}，税额{money(order[5])}，价税合计{money(order[6])}。",'条款：按月批次交付，验收后付款，质量异议在验收后10日内提出；未支付余额保留为应收，不自动视为结清。',f"交付日期：{order[9]}；交付单{order[11]}；实际回款{money(order[7])}；其余订单逐笔见销售开票回款.csv。",'签署与验收均为模拟记录，无真实签名或印章。'])
 pr=purchase[-2]
 doc('D10','原料采购与入库凭据','order_contract',[f"合同号：{pr[0]}；供应商{pr[2]}；原料{c['material']}。",f"本笔数量{pr[4]}kg，单价{pr[5]}元/kg，不含税结算{money(pr[6])}，含税{money(pr[8])}；数量保留三位小数可能产生舍入差。",f"入库单{pr[10]}；同编号采购付款在银行流水.csv；其余采购见采购进项付款.csv。",'条款：到货验收后结算，质量不符协商退换；模拟记录不表示真实供应商供货。'])
 doc('D11','生产与库存说明','accounting_ledger',[f"生产：{c['material']}投入后形成{c['product']}。良品率假设{c['yieldrate']:.0%}；工艺参数仅为演示，不是设备额定能力。",'生产用电.csv保留月度批次、投入产出、损耗、领料和用电；产品当月销售，无产成品结存；存货表示原料及历史库存。','存货余额按期初+采购-耗用滚动；销售金额依产品数量×假设单价生成。','纺织需核对纺纱工序和皮棉耗用；激光需核对板材、工时和废料；注塑需核对模具、克重和循环时间。'])
 doc('D12','场地租赁与费用','order_contract',['模拟场地：新疆喀什模拟工业园A栋；出租人：模拟园区运营方，租期2022-01-01至2029-12-31。',f"月租金包含在管理销售费用{money(c['admin'])}中，未另行重复入账；水电按生产记录单列。",'用途为案例对应制造业，转租和设备处置须依约办理；签署为模拟，产权真实性及出租权限待核验。'])
 doc('D13','人员与工资记录','accounting_ledger',[f"员工{c['employees']}人，月人工费用{money(c['pay'])}，详见人员工资.csv，与银行工资汇总支出对应。",'只使用岗位汇总，不生成真实人员名册、工资卡或手机号；工资社保在简化人工费用内合并。','人工费用口径与财报一致；工资支付不是自动证明全部员工真实在岗。'])
 doc('D14','设备买卖合同','equipment_contract',[f"合同编号{c['id']}-EQ-CONTRACT；买方{c['name']}；卖方模拟设备经销商（非真实品牌法人）。",f"设备品牌场景为{c['brand']}；共{c['count']}台/组，含税原始采购总价模拟为{money(c['fa'])}。",'采购和验收均发生于2022年12月；本包期初以固定资产账面金额承接，旧购置款不混入2023年后银行流水。','历史购置税费统一按资本化模拟处理，未主张历史进项抵扣。型号均带SIM前缀，不作为厂商产品参数。','付款条款为30%预付、60%发货、10%验收；演示历史记录假设已付清，实际核验仍须完整凭证。'])
 doc('D15','设备发票付款验收对应单','ownership_document',['设备清单.csv逐台保存合同、模拟发票号、付款号和验收号，序列号均为SYN前缀。',f"每台/组原值{money(equipgross)}；全部历史价款{money(equipgross*c['count'])}；采购付款日期为2022-12-01。",'历史设备付款为独立模拟凭据，不是当期经营流水。验收记录：外观与试运行符合模拟约定，安装地点为喀什模拟厂区A栋。','权属声明self-owned仅代表客户声明。清单和付款记录不得自动替代登记检索或人工核验。'])
 doc('D16','设备现状与权利负担','ownership_document',[f"2026-08-31设备账面净值{money(last[16])}，并非独立评估价值，尚未形成可融资净值。",'较差案例：现有融资担保描述不明确，可能覆盖拟回租设备，需要逐台取得范围说明。' if c['grade']=='较差' else '本案例声明拟回租设备未抵押；仍须真实登记检索与债权人核实，未预置为已核验。','资产核验应覆盖存在性、型号序列、占有使用、购买与付款、担保负担、可处置性；可与信审并行。'])
 doc('D17','征信与债务信息单','document',[f"模拟借款本金{money(debt)}，年利率{c['rate']:.0%}，按月付息，到期还本。",'截至2026-08-31模拟无已发生借款逾期，未来到期压力不写成已经逾期。债务计划.csv保存到期日及担保情况。','企业与实控人的正式征信查询均未发生；本页是情景信息单，不仿制人民银行征信报告。','模拟个人甲无另外已披露借款，无外部个人资产资料；未据此计算个人增信能力。'])
 doc('D18','应收与关联往来说明','accounting_ledger',[f"期末应收余额{money(ar)}；期初历史应收{money(c['ar'])}仍未清偿，其余尾款逐单见应收明细.csv。",'应收按实际未收尾款列示；本简化场景未计提减值，预评估必须关注长期未收及潜在资产虚高。','较差客户近月回款比例下降、第一大客户占65%；正常和较好客户仍保留历史应收疑点，不自动判定无风险。','期初应付账款为历史留存，供应商对账及逾期性质需补充解释；无新增对外担保的客户声明尚未外部核验。'])
 doc('D19','现场访谈与资质核查','site_evidence',['模拟访谈：厂长解释生产流程，财务解释账务与回款，仓管按设备和订单编号核对实物；不表示真正到过现场。','现场照片尚无真实来源；本包附现场采集清单和示意图，不能标记现场核验通过。','适用的环保、消防、安全生产及场地用途等要求须由政策域结合工艺核定；本包不编造许可证或默认所有行业同一许可。','本案无酒店、住宿或加盟关系，华美达只用于注塑设备品牌场景。'])
 doc('D20','担保与事项声明','document',['本次尚无已生效新增保证或抵押安排；不得用未落实的增信填补偿债缺口。','模拟声明无已披露诉讼处罚；声明不等于法院、监管或登记机关核验。','须核对涉诉、处罚、失信、受益所有人、关联交易及担保负担。缺少核验来源时保留未核验状态。'])
 doc('D21','未来订单与资金预算','order_contract',[f"客户计划申请{money(c['amount'])}，这是需求声明而非支持额度。",'未来六个月新订单模拟意向金额：纺织800万元、激光2000万元、注塑5000万元，分别仅取本案例对应一项；尚未确认为已实现收入。','原料预付款、人工电费及经营安全垫应根据采购计划分期测算，并扣除可自由使用现金和客户预付款。不能因订单总额较大直接支持全部申请。','正常和较好案例存在历史分红，需解释为何不由股东留存利润支持周转。较差案例还需区分到期还债与经营用途，不能用虚构用途掩盖偿债缺口。','本页为意向与预算，非已签正式销售合同，不输入new_order_amount作为已核实事实。'])
 for sid,title,kind,body,table in docs:
  text=f'# {sid} {title}\n\n{NOTE}\n\n主体：{c["name"]}；来源组：{c["id"]}-{sid}；状态：declared\n\n'+'\n\n'.join(body)
  if table:text+='\n\n'+'\n'.join(' | '.join(str(x) for x in row) for row in table)
  (orig/f'{sid}-{title}.md').write_text(text+'\n',encoding='utf-8')
 make_pdf(folder/'原始材料阅读册.pdf',c,docs)
 # Do not relabel a schematic as a field photograph.
 (orig/'现场采集清单.md').write_text('# 现场影像采集清单\n\n'+NOTE+'\n\n待采集：厂区门牌及全景、原料仓、生产工序、每台设备四面、铭牌特写、运行视频、产品与库存、场地用途证据。\n照片需设备编号、拍摄时间、地点、拍摄人及原始文件哈希。当前全部为未采集，不用示意图冒充照片。\n',encoding='utf-8')
 svg='<svg xmlns="http://www.w3.org/2000/svg" width="960" height="420"><rect width="960" height="420" fill="#f7f7f7"/><text x="35" y="48" font-size="24" font-family="Microsoft YaHei">模拟工艺示意 · 非现场照片</text>'
 for i,t in enumerate([c['material']+'仓','生产设备区',c['product']+'检验','成品交付区']):svg+=f'<rect x="{35+i*230}" y="120" width="200" height="150" fill="white" stroke="#888"/><text x="{45+i*230}" y="198" font-size="19" font-family="Microsoft YaHei">{html.escape(t)}</text>'
 svg+=f'<text x="35" y="340" font-size="18" font-family="Microsoft YaHei">{c["id"]} · 新疆喀什 · 尺寸与布局均为模拟</text></svg>'
 (orig/'工艺示意.svg').write_text(svg,encoding='utf-8')
 supplement=folder/'supplements';supplement.mkdir(exist_ok=True)
 (supplement/'S01-补件答复.md').write_text(f'# {c["id"]} 补件答复（模拟）\n\n{NOTE}\n\n日期：2026-09-05；对D16、D18、D19作出补充，不覆盖原件。\n\n财务确认历史应收尚未收回，应收余额仍以台账为准；未取得真实回款证明。设备担保范围仍须人工核验；现场影像仍待采集。\n\n较差客户演示保持阻断；正常和较好客户补件后也不能仅凭答复变成verified。\n',encoding='utf-8')
 (folder/'DEMO_EXPECTATIONS.md').write_text(f'# {c["id"]} 演示预期（非客户原件）\n\n{NOTE}\n\n申请{money(c["amount"])}；用户设定{c["grade"]}。标签只用于案例设计，不作为模型事实或批准结果。\n\n1. 进件：登记独立客户，导入同客户的原件，展示材料来源和期间。\n2. 核验：识别应收账龄、设备权属和资质待核事项；资产可与信审并行。\n3. 分析：比较2025全年与2026同口径趋势，八个月不直接冒充全年；发现收款与收入差异并追溯。\n4. 补件：加入S01保留原件，未解决事项继续待核。\n5. 收口：有权人员确认预评估结论；无自动通过、批准额度、提款或结清。\n\n较差案例应重点呈现回款下降、客户集中、临近债务到期和担保范围不清；正常案例呈现经营稳定及条件待落实；较好案例呈现较强盈利和现金基础，同时保留权属与历史应收核验。\n\n不得为了让演示通过而绕过真实规则或写入verified。当前应用导入、解析、运行结论与用户视觉验收均NOT_RUN。\n',encoding='utf-8')
 dump(folder/'workbook-data.json',{'note':NOTE,'case':profile,'tables':[dict(title=t,kind=k,headers=h,rows=r) for t,k,h,r in tables]})
 return profile

if __name__=='__main__':
 profiles=[build(c) for c in CASES]
 dump(ROOT/'case-index.json',{'schemaVersion':'kashgar-materials@1.0','synthetic':True,'asOf':'2026-08-31','cases':profiles})
 print(json.dumps([{'id':c['id'],**c['latest']} for c in profiles],ensure_ascii=False,indent=2))
