# 当前状态与模型协作评估

检查日期：2026-09-14晚间。Codex独自完成本次读取、源码核对与HTTP读取；未重跑全部测试、未重新浏览器全流程验收。此前误启Codex子代理已停止，结果不作为本报告证据。

## 本地证据

- 旧交付 main/RESULT 上午续轮：自动推进、人工动作门、现场画面、桌面侧栏和PendingBar合并已记录。声称71项测试通过为执行者报告，不是本轮复跑。
- ui/RESULT 10:05实页证据仍报dock304px约占首屏46%，问题主要呈现三处；F1折叠和F2标题候选尚未采用。
- story/RESULT保留旧引用拒绝、意见作废未入产品，以及提交待办说明后签名脱离固定路线的问题；v3候选是否采用需新A按实际hash确认。
- qa/RESULT第二轮七项缺陷关闭；同时把部分并行线性化、证据升版仅文案列为演示差异。该结论只适用于旧演示，不代表共享状态完成。“退回仅一次”的业务正当性论证无用户制度依据，应撤销其权威性。
- 当前源码仍有首页两块calc((100dvh - 22px)/2)、合成演示控制；demo-story-service明确不触碰remote-store。故白天最新需求仍有实质缺口。
- 当前远程尽调HTTP返回200，不代表视觉已接受；ZCode原生窗口实时执行状态未核实。
- Git最近提交63c41c3是旧归档，存在大量未提交/删除差异。不得无声全量提交；新大版本产品写入前A准备精确baseline清单与恢复方案待授权。

## 模型证据与判断

1. 官方模型卡：https://huggingface.co/zai-org/GLM-5.3-Flash/raw/main/README.md 。最高reasoning_effort为max，支持low/high/max；官方使用max复现评测。官方coding领先/接近其他模型的说法属于厂商报告，不能转换成本项目完成率。
2. 独立评测：https://artificialanalysis.ai/models/glm-5-3-flash/ 。本次读取Intelligence Index为42，页面称速度较快且输出较冗长；速度值动态变化，不写入长期规则。API价格/吞吐不等于ZCode订阅额度或Harness体验。
3. OpenAI Docs：https://developers.openai.com/api/docs/guides/latest-model 。推理强度应按任务和评估使用，未据此替用户更换模型。日常low、综合medium、特别复杂high作为用户偏好落档；用户“Ultra”指代未明确，不自动映射。

推论：继续用户选择的Flash最高thinking合理；重点应提升明确接口、一次交付、短证据和有限纠错质量，不靠扩大并发或增加输出长度。现有项目证据不足以把所有失败归因于某一模型：报告未逐次证明执行模型身份，且旧任务契约本身允许了演示降级。

## 新拆分

四个ZCode目标：A共享状态与集成、B首页、C远程尽调、D独立验收。A为产品唯一writer，B/C隔离候选，D只读验收。B/C必须在A实际采用后复核，A不能以“未采用”掩盖未满足用户批注。最多四个活动执行单元，内部代理计入预算；Codex绝不使用代理。

首次完整交付+最多两轮缺陷修复；无截止倒计时。R2后仍有阻断必须停本轮并交真实剩余项。新包已生成，未代发/启动，产品未改。

## 指令更新与恢复

已更新全局AGENTS、TOOL_EXECUTION和项目AGENTS；Memory仅新增20260914-2215-codex-no-subagents-frozen.md，不编辑注册表/历史。全局旧文件副本及hash在C:/Users/22673/.codex/instructions/backups/20260914-221409/。没有改模型、provider、认证或应用历史。恢复旧文件会撤回本次明确规则，不应自动执行。
