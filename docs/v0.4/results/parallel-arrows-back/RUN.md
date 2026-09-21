# 隔离运行与归属

在 C:\Users\22673\Desktop\JW 执行：

```powershell
./Back/A/scripts/start-parallel-arrows.ps1 -Port 62032
./Back/A/scripts/stop-parallel-arrows.ps1
```

入口 http://127.0.0.1:62032 ，实际 URL/PID/三客户 ID 读 RUNTIME.json。OWNERSHIP.json 保存自有 PID、容器完整 ID 和动态数据库端口。脚本验证标签 jw.owner=parallel-arrows-back；只停止匹配的自有 Node 进程和 jw-parallel-arrows-back 容器，保留数据库。若选定端口被占用会失败，不抢占或结束其他进程。启动在隐藏窗口中运行，stdout/stderr 在本目录。

数据库仅 loopback、数据库名/用户名 arrow_test、公开隔离测试密码 arrow_test_only；不得用于真实数据或生产。A 实例也仅本机端口。脚本不读取共享认证配置、不调用付费模型，不迁移或重启共享服务。迁移 015/016 和显式演示政策只落到该隔离数据库。

Front/dist 原样同源托管，源码/UI/构建由 Front writer 独占。默认 seed v1 只创建三例，重复启动复用原材料和业务历史，不清空。需要另一次全新演练可在自有实例停止后直接运行：

```powershell
node Back/A/scripts/parallel-arrows-runtime.mjs --db '<OWNERSHIP中对应隔离arrow_test连接串>' --port 62032 --seed-suffix '<新的唯一演练编号>'
```

该手动命令若用于常驻需另行记录 PID 归属；优先用已给启动/停止脚本维护默认三例。正在处理时强制停止会留下 unknown，重启只读恢复、不自动重发；待请求结束后停止更便于演示复用。

服务常驻仅为本轮授权的独立验收入口，不是后台自动实施、定时巡检或共享部署。是否通过视觉验收与用户接受另行记录。
