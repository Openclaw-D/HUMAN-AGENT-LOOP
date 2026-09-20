# 03路缺陷报告与对外事项 · 2026-09-20

writer：ZCode 03路。跨路缺陷交责任 owner，03路不代写他人 ownership。

## DEF-03-01（交04路）夹具 PDF 生成器编码缺陷：中文文本层损毁

- **位置**：`Back/Edge/scripts/acceptance/gen-fixtures.mjs`（04路 ownership，03路未改）
- **现象**：N1/P1/A1 三个 PDF 的中文内容在提取后为乱码（如 `订单金额` → `¢UÑ\u001aº\u0011`），仅 ASCII 片段存活。
- **根因**：`makePdf` 末尾 `Buffer.from(out, 'binary')` 按 latin1 编码，多字节 UTF-8 字符被截断（`&0xFF`）——信息在**生成时**损毁，非解析器问题；且 xref 偏移按 `Buffer.byteLength`（UTF-8）计算、实际字节被截短，两者不一致。
- **影响**：04夹具 PDF 无法走"可提取文本→declared 事实→语义映射→候选驱动"链；T04 的 P1（订单）、T06 的 A1（涉诉）在夹具级语义失效（CSV/PNG 夹具不受影响）。
- **修复建议（04路，一处）**：`makePdf` 最终编码 `'binary'` → `'utf8'`（ASCII 段字节不变，UTF-8 段完整落盘，xref 偏移随之一致），重新运行生成器更新夹具与 SHA256SUMS。
- **03路侧已就绪并验证**：解析器 `C/src/parse/adapters.mjs` 已修复 latin1→UTF-8 还原（带 U+FFFD 回退，PDFDocEncoding 兼容）；探针 `Back/C/evidence/takeoff-probe-pdf.mjs` 用 utf8 编码同构 PDF 实测：中文文本完整提取、`new_order_amount_declared=1860`、`litigation_pending_declared=true`、指令注入旗标全部正确。**04路修复生成器后，03路零代码变更即可全链消费新夹具。**
- **临时影响评估**：夹具 PDF 的垃圾键 declared 事实无害（无规则消费、authority=none）；处理任务照常 done；T02/T04/T05/T08 已用 CSV 真实字节+链内人工事实完成验证（TEST_EVIDENCE.md）。

## OBS-03-01（交01路）A 域枚举待扩展

A `POST /api/v2/customers/:id/analysis-runs/start` 的 domain 校验只收 `policy|credit|commerce|asset`，TAKEOFF 五列的 `business` 被 400 拒绝。03路已按协议诚实跳过（`a_domain_enum_pending` 留痕，本地结果+Gate 回执完整），01路候选/确认契约增量冻结时请一并扩枚举；03路侧接通=配置 `aRegisterDomains` 加 `'business'`，零代码变更。

## OBS-03-02（对02/04路的消费提示）

1. 材料 kind 词表、五域词表、taskKind、候选 v2 形状、收口读面以 **PROTOCOL.md v1.0** 为准；02路二十格"商机"列数据源=收口读面 `finalization` 的 business 域结果（`GET /api/connectors/analysis/finalization`，需04路在 Edge 加只读代理）。
2. 资产列并行语义（T03）：资产域就绪即评，不等待商务——投影时不要按列整行设门。
3. 冻结投影数据源=`amountCandidate.frozen/frozenReasons`+`gate.result`（HOLD_FOR_REVIEW/HARD_BLOCK）；解除只随新收口产生，前端不做"解除冻结"按钮。

## 03路遗留（如实）

- 真实模型 API、A 候选字段映射、confirm-preassessment 门：等 01路契约冻结与用户授权（NOT_RUN，非本路可解）。
- 四域时代的历史测试（four_domain_* taskKind 兼容别名）继续全绿；若01路契约扩展后四域别名语义与 A 新枚举冲突，再按变更流程升级。
