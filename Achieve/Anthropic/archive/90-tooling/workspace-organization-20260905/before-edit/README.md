# JW｜见微唯一入口

状态：`CURRENT WORKSPACE INDEX`

当前工作区固定为 `C:\Users\22673\Desktop\Anthropic`，唯一活动代码仓库是 `jianwei-v3/site/`。

## 当前权威

按顺序只读这些文件：

1. [NORTH_STAR.md](./NORTH_STAR.md)：产品边界与绝对底线；
2. [DECISIONS.md](./DECISIONS.md)：当前冻结决定和近期开放决定；
3. [CHALLENGE_LOG.md](./CHALLENGE_LOG.md)：仍需解决的宏观风险；
4. [ROADMAP.md](./ROADMAP.md)：当前阶段、owner 和 Gate；
5. [versions/V4/P0_PRODUCT_CHARTER.md](./versions/V4/P0_PRODUCT_CHARTER.md)：P0 宪章；
6. [versions/V4/P1_GOLDEN_CASE_CONTRACT.md](./versions/V4/P1_GOLDEN_CASE_CONTRACT.md)：新客回租 Golden Case 当前内容契约；
7. [versions/V4/COMPETITION_DELIVERY.md](./versions/V4/COMPETITION_DELIVERY.md)：比赛约束；
8. [jianwei-v3/site/docs/v4/CONTRACT.md](./jianwei-v3/site/docs/v4/CONTRACT.md) 与 [ACCEPTANCE.md](./jianwei-v3/site/docs/v4/ACCEPTANCE.md)：项目实现契约与验收。

本版本对话只追加到 [versions/V4/CONTEXT_LOG.md](./versions/V4/CONTEXT_LOG.md)。Context Log 保存事实和演进，不覆盖上述 authority。

## 默认协作

- Codex：与用户讨论、收敛产品、生成冻结任务书、做审美/高风险判断和最终复核；
- 用户：把任务书复制到 ZCode，并在需要时带回结果；
- ZCode：在明确 ownership 内执行中大型工程，可用其原生 Harness 和 subagent；
- 双方共享本地 Markdown，不依赖彼此的 Context Window；同一文件或共享状态同一时间只能有一个 writer。

## 目录

- `jianwei-v3/site/`：唯一活动代码仓库；
- `versions/V4/`：当前版本入口、宪章、比赛约束和 Context Log；
- `materials/`：调研、学习、展示和输出，不拥有 authority；
- `archive/`：可恢复历史，不参与默认检索；
- `.codex-remote-attachments/`：Remote 缓存，不整理、不作为产品资料。

除非当前任务明确需要，禁止宽扫 `archive/`、恢复旧契约或从材料反向定义当前产品。
