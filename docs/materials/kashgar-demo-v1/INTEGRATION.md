# 材料到页面与接口的对应

状态：本地文件已制作；当前应用运行接入NOT_RUN。禁止将本目录索引当成已登记A工件或已解析事实。

## 两个入口必须区分

1. 当前workbench客户端`Front/site-mirror/lib/workbench/wb-client.ts`的uploadOriginal调用`POST /api/jw/v2/actions/customers/{customerId}/originals`。载荷为requestId、kind、materialMeta及file{name,mime,dataBase64}。这条路不能仅因上传成功就宣称Connectors解析和分析已执行。
2. Connectors处理链入口为`POST /api/jw/v2/actions/connectors/evidence/upload`，上游为`POST /api/connectors/evidence/upload`。当前源码`Back/Connectors/src/http/server.mjs`要求有效且已接受的邀请、获准kind与匹配的客户。载荷使用tenantId、customerId、invitationId、kind、contentBase64、contentType、sourceGroup、sourceMode、periodFrom/To、currency、unit、caliber等字段。

租户、真实运行客户ID、邀请和权限从当前系统获取，不能把KS案例键或SYNTHETIC主体标识擅自替换为已存在客户。任何连接动作不得回退sourceMode=real，不得直接写verified或绕过权限。文本PDF的中文可提取不等于现有简化解析器一定支持，必须实测。

## 推荐上传集合

- 主体：D02/D03/D04 PDF → legal_document → 商机/政策。
- 财务：接口财务2025.csv → financial_statement → 商机/信审/商务。其数据取2025全年，2026YTD单独展示。不要把月度、年度、接口投影三种格式全部当新证据上传。
- 设备：接口设备.csv → equipment_list → 资产/商务；仅权属声明，不是核验结论。
- 权属：D15/D16 PDF → ownership_document → 资产/政策；登记检索未发生。
- 银行流水.csv → statement；税务台账.csv → tax_filing；销售与采购CSV → sales_purchase；生产及工资CSV → accounting_ledger。
- D09/D10/D12合同PDF → order_contract。D21是意向预算，映射document，不能伪装成已签新订单。
- D19现场访谈PDF → site_evidence，明确为模拟访谈。示意SVG不作真实现场证明。
- supplements/S01-补件答复.md属后续事件，需转换为当前解析器支持格式后接入；关联原件但保留独立补充版本。

manifest中sourceGroup用于同源去重，文件哈希用于字节校验；materialId只是本地稳定标识。运行登记后另建materialId→A artifactId/Connectors evidenceId映射，写入运行态目录，不把邀请码或令牌提交Git。

## 页面应显示

三位客户独立入口、申请金额、材料目录、原件预览、文件版本、期间和单位、来源引用、未核验状态。五列商机/政策/信审/商务/资产分别消费对应资料。原始材料、补件和系统分析在页面上有明确区分。

## 接线验收清单

1. 三客户逐一上传，核对落库字节哈希及客户归属；跨客户邀请上传应拒绝。
2. PDF提取、CSV财务和设备语义映射实测，失败时保留待人工，不生成假结果。
3. 同源PDF/Markdown、CSV/XLSX重复件不增加证据独立性；不同期间不得相互覆盖。
4. 从页面打开原件并定位金额来源；刷新后数据仍在，客户之间不得混用。
5. 补件保留原版及未解决事项，不预置通过；人工确认终点不产生正式额度或放款。

以上均待运行验证。当前后台有其他在制修改，本轮不写Back或Front业务代码；如需中大型后台接线，按既定分工另行给ZCode明确任务，Codex独立验收。此文档不替代实际完成。
