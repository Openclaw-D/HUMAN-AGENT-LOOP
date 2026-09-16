# MANIFEST｜R2_MAIN_20260913 夜间批次

生成：2026-09-13 05:55。所有命令在 `jianwei-v3/site` 执行（Git HEAD 63c41c3，dirty 92 项，v5-preview 全部未跟踪——继承既有状态，无 Git 写操作）。

## 修改/新增文件与 hash

见 `evidence/post-manifest-sha256.txt`（本轮全部产品写面 + runtime 副本逐一核对）。要点：

| 文件 | 状态 |
| --- | --- |
| app/v5-preview/page.tsx | 改（总览五行：生命周期行/视频入口卡/移动布局） |
| app/v5-preview/preview.module.css | 改（追加五行/点阵/全屏/相机样式） |
| app/v5-preview/remote-session/page.tsx | 重写（访谈竖屏优先+注册表+全屏模式） |
| app/v5-preview/remote-session/camera-panel.tsx | 上轮新增，本轮未改 |
| lib/v5-preview/remote-timeline.ts | 上轮夜间批次（B1）新增，本轮未改 |
| lib/v5-preview/remote-service.ts | 上轮 B2 改（adapter 再判定）+ 本轮未再改 |
| lib/v5-preview/remote-store.ts | 上轮 B2 改（legacy 兼容）+ 本轮未再改 |
| lib/v5-preview/remote-request-registry.ts | 新增（多请求注册表） |
| test/v5-preview*.test.mjs（9 文件） | 改/增（registry 新增；其余断言适配） |

注：`test/v5-preview.test.mjs` 隔离断言按文件细分存储白名单（rows 主页=请求恢复记录；chat-panel=仅 chat-open UI 态）。

## 验证命令与退出码

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `node --experimental-strip-types --test --experimental-test-isolation=none test/v5-preview.test.mjs test/v5-preview-v6fix.test.mjs test/v5-preview-rework1.test.mjs test/v5-preview-rework2.test.mjs test/v5-preview-remote.test.mjs test/v5-preview-remote-repair.test.mjs test/v5-preview-remote-timeline.test.mjs test/v5-preview-remote-compat.test.mjs test/v5-preview-remote-registry.test.mjs` | exit 0，**108/108** | gate-all-tests.txt |
| `npm.cmd run typecheck` | exit 0 | gate-typecheck.txt |
| `npm.cmd run lint -- --ignore-pattern ".v6-runtime/"` | exit 0（0 error） | gate-lint.txt |
| `next build`（.v6-runtime，生产数据目录） | exit 0 | gate-build.txt |
| 故障矩阵（rows 域 6 项） | 6/6 | 继承上轮 verification/ |
| 远程 store 重启恢复 | before v9/1/1 = after | 对话记录 + STATUS |

## 运行实例（当前）

- 3321 dev（rework 数据目录→见 STATUS 历次记录；最终一轮为 R2_MAIN runtime-data）
- 3399 生产：**本轮修复后构建** `next start`（production-data），interview/overview 均 200、无开发按钮
- 3311 现场：只读未动（PID 28568 不变）
