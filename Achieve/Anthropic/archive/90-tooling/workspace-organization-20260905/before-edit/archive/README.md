# JW 历史归档索引

状态：`READ-ONLY HISTORY / NOT CURRENT AUTHORITY`

归档内容不得自动恢复成当前产品决定。需要复用时，先与根部 `NORTH_STAR.md` 和 `DECISIONS.md` 做冲突检查。

## 阶段目录

| 当前目录 | 原路径/来源 | 含义 |
| --- | --- | --- |
| `00-pre-financing-leasing-mvp/` | `C:\Users\22673\Desktop\Anthropic-history-20260828-before-financing-leasing-mvp` | 融资租赁 MVP 收敛前的完整历史快照，约 706 MB |
| `10-v2z-experiments/` | `C:\Users\22673\Desktop\Anthropic-V2Z` | V2Z 隔离实验 Candidate |
| `20-p2-discovery/` | 原工作区根部 `P2_*` | P2 产品发现、冻结与交接 |
| `30-v3-materials/` | 原工作区根部 `V3_*`、`prototype/`、`jianwei-v3` 旧静态壳与 Unity 候选 | V3 契约、Evidence、视觉资产、旧原型和历史上下文 |
| `40-v4-life-convergence/` | 旧 V4-LIFE 入口、早期 P0 问题稿与 2026-09-03 权威全文快照 | 当前 authority 极简化前的可恢复历史 |
| `90-tooling/` | 原 `codex-route-v1-fixture/`、`EYE - 快捷方式.lnk` | 非产品工具夹具和旧快捷入口 |

2026-09-04 增量归档：

- `30-v3-materials/legacy-static-shell-20260828/`：原 `jianwei-v3/` 根部旧静态项目；
- `30-v3-materials/eye-unity/`：退出活动路径的 Unity 候选；
- `30-v3-materials/site-evidence-before-v4/`：V2/V3 浏览器与 runner Evidence；
- `90-tooling/site-hidden-runner-artifacts-20260904/`：活动仓库根部旧 `.glm53-*` 与旧 Z 路由记录。

## 恢复方法

所有归档操作都是移动，没有删除。若确需恢复旧绝对路径：

1. 先停止使用对应归档目录；
2. 将目标目录或文件移回上表记录的原路径；
3. 检查根部 `README.md`、项目 `AGENTS.md` 和引用该路径的文档；
4. 不得仅因路径恢复就把旧内容重新声明为当前 authority。
