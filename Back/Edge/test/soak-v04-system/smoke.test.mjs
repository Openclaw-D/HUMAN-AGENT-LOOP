// soak-v04-system 冒烟测试：压缩时间轴跑通全部矩阵路径，验证 harness 本身正确（不是产品回归——
// 产品回归见 ../v04-message-*.test.mjs）。覆盖：基线发送/重放、跨作用域负例、旧回执失败关闭、
// crash_before/crash_after/error/SIGKILL/断连/跨进程争抢恢复、租约收敛、裁剪保护、受众门、
// 分页游标、出站对账。全部端口系统分配、绑定 127.0.0.1、替身外发零真实出站。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = path.resolve(HERE, '..', '..', '..', '..', '.local', 'soak-v04-system', 'snapshot', 'src');

test('soak harness 冒烟：driver pilot 计划全矩阵走通，周期全过、零CRITICAL发现', { timeout: 900_000 }, async () => {
  // 现场固定在 .local（Git排除），断言失败时保留证据；成功后由本测试清理上一轮。
  const dir = path.join(SNAPSHOT, '..', '..', `smoke-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const driverCode = `
    process.argv.push('--plan', 'pilot', '--seed', '99', '--run-dir', ${JSON.stringify(path.join(dir, 'run'))}, '--snapshot', ${JSON.stringify(SNAPSHOT)}, '--lease-ms', '3000');
    await import(${JSON.stringify(new URL('file:///' + path.join(HERE, 'driver.mjs').replace(/\\/g, '/')).href)});
  `;
  const file = path.join(dir, 'smoke-driver.mjs');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, driverCode);
  const proc = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (d) => { stdout += d; });
  proc.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((resolve) => proc.on('exit', (c) => resolve(c)));
  try {
    assert.equal(code, 0, `driver 应 exit0；stderr=${stderr.slice(-2000)}`);
    const runDir = path.join(dir, 'run');
    const results = JSON.parse(readFileSync(path.join(runDir, 'RESULTS.json'), 'utf8'));
    // 周期：pilot 计划 3 个（crash_before/crash_after/twoprocess）
    assert.ok(results.cycleCount >= 3, `周期数=${results.cycleCount}`);
    const critical = results.findings.filter((f) => f.severity === 'CRITICAL');
    assert.deepEqual(critical, [], `不应有CRITICAL发现：${JSON.stringify(critical.slice(0, 3))}`);
    // 硬不变量
    assert.equal(results.recon.hardInvariants.noDuplicateExternalSend, true, '同requestId出站必须≤1');
    assert.equal(results.recon.hardInvariants.noLostConfirmedData, true, '已确认数据不得丢失');
    assert.equal(results.recon.confirmedDataMissing, 0);
    // 各相位有流量且无非预期错误堆积
    for (const p of results.phases) {
      const total = Object.values(p.counts ?? {}).reduce((s, n) => s + n, 0);
      assert.ok(total > 20, `${p.name} 流量不足：${total}`);
      const bad = (p.counts?.unexpected ?? 0);
      assert.ok(bad <= 2, `${p.name} 非预期错误过多：${bad}`);
    }
    // 每个周期都有恢复时间戳
    for (const c of results.cycles) assert.ok(c.recoveredAt, `周期 ${c.type} 未记录恢复时间`);
    assert.ok(existsSync(path.join(runDir, 'metrics.jsonl')), '指标文件应存在');
    assert.ok(existsSync(path.join(runDir, 'sink-journal.jsonl')), '出站日志应存在');
    console.log(`[smoke] PASS；现场：${runDir}`);
  } catch (e) {
    console.error(`[smoke] FAIL，现场保留：${path.join(dir, 'run')}；stderr尾=${stderr.slice(-800)}`);
    throw e;
  }
});
