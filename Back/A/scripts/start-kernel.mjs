#!/usr/bin/env node
// start-kernel.mjs — A 路标准启动入口（供 B/C/D 消费与人工介入）。
// 用法：node scripts/start-kernel.mjs [--port 48080] [--fresh-data] 
//   默认连隔离容器 PG（127.0.0.1:15432/v7next_a），启用 outbox dispatcher。
//   合成 principal 目录（仅存 sha256；B/C/D/人工测试统一用这套凭据，头 X-Principal-Credential）：
//     tok-admin(管理员) tok-business(业务,可supersede/创建) tok-agent/tok-agent2(agent执行)
//     tok-approver(验收) tok-jianwei/tok-policy/tok-credit/tok-commerce/tok-asset(C模板六角色)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def;
};
const port = arg('port', '48080');

const SPEC = [
  'tok-admin=alice:human:admin:all',
  'tok-business=bob:human:business+config:all',
  'tok-agent=worker1:agent:business:all',
  'tok-agent2=worker2:agent:business:all',
  'tok-approver=carol:human:approver:all',
  'tok-jianwei=jane:human:jianwei:all',
  'tok-policy=paul:human:policy:all',
  'tok-credit=cindy:human:credit:all',
  'tok-commerce=connor:human:commerce:all',
  'tok-asset=adam:human:asset:all',
].join(',');

const child = spawn('node', [
  path.join(__dirname, '..', 'src', 'index.ts'),
  '--port', port, '--dispatch', '--principal-tokens', SPEC,
], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
child.on('exit', (code) => process.exit(code ?? 0));
