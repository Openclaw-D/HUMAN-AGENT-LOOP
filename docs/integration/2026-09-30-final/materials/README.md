# 十案例材料包（02-back 唯一材料 writer；2026-09-30 收尾轮）

**模拟声明**：本目录全部材料为合成演示材料（来源注"合成"），不读取、不影射任何真实客户数据。模拟的只是客户与输入材料；解析、规则、依赖执行、状态、权限、审计全部走真实后端。

## 结构

- `case-01/ … case-10/`：每例 2–3 个常见格式 CSV（`financial_summary.csv` 财务事实、`equipment_list.csv` 设备事实；case-05 另有 `purchase_invoice.csv` 冲突来源件）。每行 `fact_key,value,unit,grade,source_note`——grade 即核验等级（confirmed=已核验 / source_supported=有据申报 / unverified=未核验申报）。
- `MANIFEST.json`：全部文件 SHA256 与字节长度（生成脚本 `Back/A/scripts/generate-ten-case-materials.mjs` 确定性产出，同 fixtures 必同字节）。
- `EXPECTED.json`：**独立期望**（手工从规则口径推导，含算术依据），供测试与验收对照——不是引擎输出的复制。

## 案例差异一览（从差到好）

| # | 案例 | 差异机制 | 预期检查点 |
|---|------|----------|------------|
| 01 | 喀什河谷新材料加工厂 | 收入 56,000,000 超红线 | blocked_redline |
| 02 | 天山南麓农机装备公司 | 权属申报 source_supported + 核验登记 false | blocked_hard |
| 03 | 准噶尔包装制品厂 | 覆盖率 0.55 < 1.0 | risk_decision |
| 04 | 伊犁河谷食品加工合作社 | 现金流 grade=unverified | awaiting_evidence |
| 05 | 阿克苏果业冷链公司 | 设备对价双来源冲突（298万/335万） | conflict_review |
| 06 | 吐鲁番纺织印染厂 | 收入/主体/权属仅申报 | verification_pending |
| 07 | 塔城农机维修连锁 | 采用后补证（对价 280万→320万） | stale_review |
| 08 | 昌吉精密模具制造 | 全好材料+五区采用+Gate CLEAR | preassessment_review |
| 09 | 克拉玛依建材租赁 | 周期 fulfill 后停待回执 | awaiting_external |
| 10 | 博乐葡萄酒庄设备回租 | 周期走完 closed | closed_reorderable |

登记到 A 的每条事实材料 `content.originFile` 指向本目录文件名+行号，`content.fileText` 携带全文，sha256 与 MANIFEST 一致——"看收入原件"即可回溯到 CSV 行与 hash。
