# V0.3 决赛任务板

2026-09-20。共同入口：[00_AUTHORITY.md](00_AUTHORITY.md)。所有任务共享现有 JW 目录，每文件只有一个 writer。

| 可见任务 | 状态 | 独占写入 | 交付与依赖 |
|---|---|---|---|
| V0.3-CTRL | 运行中 | docs/v0.3 根文件、根部入口、DECISIONS/CHANGELOG | 评分、范围、公共契约、证据裁决、十小时执行顺序 |
| V0.3-MATIRAIL | 已接续运行 | docs/materials/kashgar-demo-v1/**、docs/v0.3/material/** | 三客户合成原材料、hash、标准答案/变体、解析兼容性说明；不改业务代码 |
| V0.3-SHOW | 已接续运行 | docs/v0.3/show/** | 15分钟展示上限：12分钟固定+3分钟预留，另备5分钟问答；短片/系统/PPT、评分证据位置与降级方案 |
| V0.3-TEC | 已创建运行 | docs/v0.3/tec/** | 按钮→接口→数据→恢复架构核对，全周期缺口，算力/人力区间，ZCode任务包 |
| V0.3-EVAL | 已创建运行 | docs/v0.3/eval/**、.local/v03-eval/** | 现有离线测试独立复核、三臂对照设计、基线表、风险门、原始结果；不改产品源码 |
| V0.3-FRONT | 已创建运行 | Front/**、docs/v0.3/front/** | 先核查现有契约，补需求登记和受控模型观察页面入口及必要错误态；界面不创造后端业务能力 |

执行注意：TEC 只读后端；EVAL 不跑正在由 FRONT 修改的前端套件，冻结后再接手。各任务不得改公共根文件或彼此报告。接口变更要求写到各自目录，由 CTRL 串行裁决。不要创建进一步任务或 subagent。

任务ID：CTRL=01a0be7c-762e-75f2-9777-7243d16b5fe8；MATIRAIL=01a0be67-613c-7471-ad9e-6a91c343a5a8；SHOW=01a0bdb9-7775-7332-b2af-b519d9e08bf2；TEC=01a0be8e-f00e-7033-b307-42fa2860e24b；EVAL=01a0be8f-87e3-7571-b64f-a122d3bf8748；FRONT=01a0be8f-8b95-7123-ac7f-44ede78e18ac。
