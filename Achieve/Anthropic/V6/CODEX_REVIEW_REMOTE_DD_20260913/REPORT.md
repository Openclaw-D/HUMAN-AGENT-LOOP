# Codex独立验收｜远程尽调长程交付

日期：2026-09-13。结论：**PARTIAL / CHANGES_REQUIRED，不接受“本轮DoD全部达成”。**

## 检查范围与实际证据

- 已读长程任务、当前契约、执行者STATUS/REPORT/BASELINE/INTERFACE/METRICS及实际代码。
- 独立执行原五个聚焦测试文件：75/75通过，exit 0。此为已有用例通过，不等于新增故障全部覆盖。
- 独立探针 `probe.mjs` 直接调用产品服务，并抽取实际页面的runWrite函数在受控网络故障下执行；全部数据在系统临时目录，不改现有演示状态。探针断言用于确认缺陷仍存在，退出0不是产品通过。
- 实际浏览器从总览入口进入会议页成功；当前360×640截图可见未接入/合成标识。手机真机、软键盘和触控拖拽本轮未实际验证。
- 3321和3399监听仍在；未重启/停止服务，未调用模型、视频、摄像头或外部业务接口，未改产品代码。未独立重跑typecheck/lint/build或完整HTTP故障矩阵。

## 为什么提前结束

ZCode报告记录23:31开始、01:40收口、01:55最终状态；停止理由是其认为可实现增量已达DoD。长程任务确实允许提前完成，不要求凑8–10小时，因此不能仅按时长判错。但如下可本地修复的问题未关闭，不能把剩余工作全部归因于缺模型凭证。

## 返修发现

### F1 P1｜原样重试没有接通，草稿/请求恢复缺失

位置：`app/v5-preview/remote-session/page.tsx:158` 及所有runWrite调用点。

所有界面调用均传retry=false；失败后只留requestId，不保存完整path/body/owner，下一次操作生成新ID。独立抽取实际函数，连续两次NETWORK后实际ID为fe-1、fe-2，不是同请求。页面“当前实现保留原请求”的提示不属实。刷新/离开丢失ref；done直接清空草稿也没有修订归属门。提交已落盘但回执丢失时，重试不能可靠查询原结果；刷新再操作可能重复创建。

### F2 P1｜暂停不是执行门

位置：`lib/v5-preview/remote-service.ts:539`、`:457`。

隔离复现pause_round使session.status=paused，随后新标注与simulateFollowUps仍成功（simulated=true）。暂停可允许补充资料，但应阻止新的判断/模型推进，不能只有抬头文字。

### F3 P1｜重拍/取代没有完整撤销当前确认资格

位置：`remote-service.ts:210`、`:495`。

先confirm再request_retake，投影仍human_verified；证据被supersede后，createReview仍接受对旧证据的新confirm（ok=true、expired=true同时存在）。应保留历史确认，但不得呈现为当前有效确认；旧证据关联问题/回复/复核也应显式过期。

### F4 P1｜核算幂等摘要遗漏输入

位置：`remote-service.ts:604`。

payload没有mode或inputs。同requestId、同旧expectedVersion将现金流测试输入从200改成1，服务端仍返回原ready_for_review结果，而不是REQUEST_MISMATCH。仅合成算术已复现，不涉及实际金融定价；但该错误不能带入真实核算。CalculationRecord也未绑定证据/规则/方案版本，页面声称变化会失效，代码没有相应完整实现。

### F5 P1待真机复验｜移动端关键圈选仅实现鼠标事件

位置：`page.tsx:299`。只有onMouseDown/Move/Up，无Pointer/Touch处理、取消或捕获；不能用窄屏截图证明手机触控可操作。当前窄屏首屏几乎全为参会人和协议角色英文，关键证据/问题在下方。布局可用性仍需收口，不要求重做整个视觉。

### F6 P2｜证据sha256不是实际原图字节摘要

位置：`remote-service.ts:293`、`:338`。

摘要来自fixture元信息拼串，独立计算实际renderFixtureSvg字节SHA256不一致；重拍相同图形还掺入旧ID。不能用于验证实际返回原图完整性。修复需保留旧记录可恢复，明确旧摘要语义，不覆盖历史伪称原件hash。

### F7 P2｜交付/接入声明超前

- BASELINE只在外层目录运行git后写“非Git仓库”；独立 `git rev-parse --show-toplevel` 确认活动site是Git仓库，且dirty，不能据外层结果跳过精确变更核验。未认定所有当前dirty来自本轮。
- 所谓六角色链路当前是五组固定问句中按标注序号选两组，没有真实推理或可执行模型adapter/DSL。无密钥可解释未调用，不能解释契约/适配器故障测试全部缺失。
- GET返回演示全部状态，写接口没有可信用户身份校验；仅硬编码projectId不能称真实跨用户权限失败关闭。本期可保持本机合成单用户演示，但不可对真实客户开放。
- READY_FOR_INTEGRATION建议真实模型失败写model_simulation，会混淆真实失败与模拟；应独立失败状态，不生成冒充结果的替代回复。

## 接受与不接受

接受为已有候选资产：一套响应式Web入口、会议页面、合成证据/提问/复核基础、未配置视频/核算的明确提示。

不接受：稳定闭环完成、真实AI协作完成、真实会议完成、手机原相机已接通、只需填密钥即全部可用。三维/持续采集原本不在实现范围，不计本轮缺陷。

下一执行入口：[定向返修与相机准备任务](../ZCODE_REMOTE_DD_REPAIR_20260913.md)。未代发或启动。

复现：在Anthropic目录执行 `node --experimental-strip-types V6/CODEX_REVIEW_REMOTE_DD_20260913/probe.mjs`；真实组件和HTTP回归必须由返修者补齐，不能仅将此探针的断言反转就宣布验收。
