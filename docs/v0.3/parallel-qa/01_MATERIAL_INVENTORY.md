/goal

任务：V0.3-Z1 材料清单核对。工作区 C:/Users/22673/Desktop/JW。

输入只读：docs/materials/kashgar-demo-v1/各案例material-manifest.json、case-index.json、INTEGRATION.md、对应原件；.local/v03-recovery/case-upload-receipts.json与case-runtime-map.json。
唯一写入范围：C:/Users/22673/Desktop/JW/docs/v0.3/parallel-qa/results/material-inventory/。其他任务同时工作，不覆盖或撤销其修改。

完成一个可重跑的离线核对脚本及结果：
1. 检查三个manifest逐件路径、文件存在、SHA256、bytes、sourceMode和客户归属；禁止目录逃逸。
2. 只对uploadByDefault=true生成候选接入清单，按客户/原件哈希/来源组区分同源表示，不能把PDF/MD及CSV/XLSX算作多份独立证据。
3. 对已有上传回执比对文件哈希，区分已记录上传、尚未记录、类别或来源组不一致；回执不是当前服务授权或数据库状态证明。
4. 输出每客户待接入清单JSON，保留文件名、kind、sourceGroup、单位/期间原始值、哈希及缺失说明。不要猜缺失字段，不输出预判评级。

不上传、不写数据库、不改manifest/原件、不调用模型、不启动服务、不安装依赖、不commit/push/worktree。发现错误只列具体文件和证据，不扩大任务。
验收：一条命令可复现；原件不变；三例结果完整；没有重复表示被当成新增材料。交REPORT.md、脚本、清单、输入哈希和退出码；完成后集中回报一次，不反复通知CTRL。
