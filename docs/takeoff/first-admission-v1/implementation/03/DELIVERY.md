# 03路交付汇总 · 2026-09-20（TAKEOFF-FA-1.0.0 统一证据处理与受控分析链）

writer：ZCode 03路（ownership：Back/B/**、Back/C/**、Back/Connectors/**；本目录为本路记录）。
状态：**本路范围交付完成，全部适用项自验通过**；未 commit/push/切分支/worktree，未停任何进程。

## 一页结论

统一链"一次上传→可信客户绑定→原件/解析/事实→按需五域分析→A登记/候选"已按 TAKEOFF-FA-1.0.0
适配并在真实持久化（PG+HTTP+真实文件字节）上自验通过；候选方案具备期限/价格口径/修订引用/
冻结语义（可增可减可冻结可解除，全部确定性推导，authority=none）；材料 kind 词表、五域词表、
调用协议已冻结（PROTOCOL.md v1.1）供 02/04 消费。真实模型 API 0 调用（未获授权，如实 NOT_RUN）。

## 交付物索引

| 文件 | 内容 |
|---|---|
| `INVENTORY.md` | 开工盘点（三模块现状/缺口表/边界） |
| `PROTOCOL.md` | **冻结调用协议 v1.1**：材料 kind 词表、五域词表、事实键语义映射、候选 v2 形状+§5.1 A 字段映射、taskKind、读面、边界（02/04 消费唯一来源） |
| `INTERFACE_MAP.md` | 逐动作路由/权限/落点/回执 + 本轮代码变更清单 + 诚实边界（流式未接/A 域枚举未扩等） |
| `TEST_EVIDENCE.md` | T02–T08/T11/T12/T14 对照结果 + 输入样本说明 + 运行依赖 |
| `CLEANUP_LOG.md` | 删除清单（依赖检查+备份校验）与保留理由 |
| `DEFECTS_REPORT.md` | 交04路：夹具 PDF 生成器编码缺陷（附修复建议与验证探针）；交01路：A 域枚举扩展观察；对02/04消费提示 |
| `evidence-{b,c,connectors}-final.txt` | 收口全量回归输出（B 105 / C 113 / Connectors 93，全部 0 失败） |
| `takeoff-probe-pdf.mjs`（在 Back/C/evidence/） | 04路夹具修复验证探针 |

## 关键数字

- 基线（开工实测）：C 101/101、B 105/105、Connectors 88/88 —— 先测后改，回归底线。
- 交付后收口：C **113/113**（+12 五域定向）、B **105/105**、Connectors **93/93**（+5 真实链定向）。
- 新增文件 5（C×3 测试/规则包/语义模块、B×0、Connectors×1 测试；另有规则包 JSON）；修改全部在 ownership 内（git status 核对）。

## 接续与外部依赖

- 02/04：按 PROTOCOL v1.1 消费；04路在 Edge 加 finalization 只读代理与 takeoff 装配
  （rulePackPath+aRegisterDomains 配置位已留）。
- 01路：契约 §13 已登记；A analysis-runs 域枚举扩 'business' 后（OBS-03-01），03路改一个配置数组即全量接通。
- 04路：修复夹具生成器（DEF-03-01，一处 'binary'→'utf8'）重新生成 PDF 夹具后，03路零变更即可消费。
- 用户：真实模型提供方/数据范围/预算授权（当前 0 调用、NOT_RUN 如实）；整体验收由04装配、Codex 独立复核、用户视觉/业务验收分别进行。

## 缺陷响应承诺

本路交付后继续响应 04路装配中发现的 03路范围缺陷：在 ownership 内修复、定向复测（三套件
定向+全量）直至本路适用项全部 PASS 或出现具体外部阻塞。
