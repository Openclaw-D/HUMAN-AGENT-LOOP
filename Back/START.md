# Back · V0.1迁移后的启动

A业务事实HTTP/PG，B执行器，C合成模板/mock，D验收脚本。字母目录保持来源相邻关系。旧lane README保留历史口径，涉及当前能力以JW根README和迁移验证为准。

在A、B执行`npm ci --no-audit --no-fund`；C零运行依赖。Node22.23.1。

独立数据库示例（仅本机开发、演示密码，不能用于生产；先核对15442未占用）。从仓库根目录打开PowerShell执行；如果此前已创建同名容器，先核实是本项目容器，再用`docker start jw-v01-pg`恢复，不重复docker run、不删除原数据：

```powershell
docker run -d --name jw-v01-pg -e POSTGRES_USER=jw -e POSTGRES_PASSWORD=jw-local-demo -e POSTGRES_DB=jw -p 127.0.0.1:15442:5432 -v jw_v01_pgdata:/var/lib/postgresql/data postgres:16
cd .\Back\A
$env:V7NEXT_A_DB_URL='postgres://jw:jw-local-demo@127.0.0.1:15442/jw'
node src/db/migrate-cli.ts
node src/index.ts --port 48180 --dispatch
```

默认未配置可信身份，敏感动作失败关闭。需要合成身份的本地演示可在相同环境执行`node scripts/start-kernel.mjs --port 48180`；其tok-*只是公开合成测试值。

C：`cd ../C; node scripts/start-mock.mjs --port 3730`。B应复制config/b-config.http-sample.json到被Git排除的config/b-config.json，将contract.baseUrl改为新A端口48180，mock.baseUrl匹配C端口，再`node src/cli.mjs worker`。真实model key不复制、不默认读取。CLI参数和恢复边界看B/HANDOFF-D.md。

Edge（任务04新增，登记入口）：`cd Back\Edge; node scripts/edge-start.mjs`（默认127.0.0.1:48200，readiness探测A@48180/PG@15442，可用`--kernel-port/--db-port`覆盖）；停止`node scripts/edge-stop.mjs`。端口被占自动拒绝不抢占，停止前按启动标识复核PID。版本封存`node scripts/version-seal.mjs --probe`。详见Back/Edge/README.md。

**数据库数据范围**：只移植migrations和可重建模板，不拷贝旧PG数据。旧容器/卷/服务原样保留；不要直接运行历史文档中的清库或重启命令。
