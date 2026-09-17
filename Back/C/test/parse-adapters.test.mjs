// goal-02 · B1 解析适配器单元测试（确定性、原始字节、格式白名单）。
// 支持一种格式必须用原始文件测试：本文件直接构造真实字节（CSV/TSV/文本/PDF 魔数/空字节）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArtifactBytes, parseCacheKey, detectFormat, PARSE_ADAPTERS_VERSION,
} from '../src/parse/adapters.mjs';

test('银行流水 CSV：原始字节 → 行级提取+聚合+source_supported 事实+口径注记', () => {
  const csv = [
    '交易日期,收入,支出,余额,摘要',
    '2026-01-05,0,12000.50,88000,购料',
    '2026-01-20,35000,0,123000,货款',
    '2026-02-10,41000,0,164000,货款',
  ].join('\n');
  const r = parseArtifactBytes(Buffer.from(csv, 'utf8'), { fileName: 'bank.csv' });
  assert.equal(r.ok, true);
  assert.equal(r.format, 'bank_statement_csv');
  assert.equal(r.aggregates.rowCount, 3);
  assert.equal(r.aggregates.inflowTotal, 76000);
  assert.equal(r.aggregates.outflowTotal, 12000.5);
  assert.equal(r.aggregates.monthCount, 2);
  assert.equal(r.declaredFacts.length, 2);
  for (const f of r.declaredFacts) {
    assert.equal(f.verificationLevel, 'source_supported', '机器从原件提取=source_supported');
    assert.equal(f.caliber, 'bank_receipts');
    assert.ok(f.caliberNote.includes('入账不直接当经营收入'), '口径注记强制');
  }
  assert.equal(r.declaredFacts[0].factKey, 'bank_inflow_total');
  assert.ok(!r.declaredFacts.some((f) => f.factKey === 'monthly_operating_cash_flow'), '流水聚合不冒充经营收入');
});

test('声明表 CSV 与文本：declared 级；期间错位只定位；不支持格式如实转人工；坏输入不编数', () => {
  const kv = parseArtifactBytes(Buffer.from('monthly_operating_cash_flow,46000\nmonthly_debt_service,18000'), { fileName: 'decl.csv' });
  assert.equal(kv.ok, true);
  assert.equal(kv.format, 'keyvalue_csv');
  assert.ok(kv.declaredFacts.every((f) => f.verificationLevel === 'declared'), 'key,value 表=申报级');

  const txt = parseArtifactBytes(Buffer.from('equipment_model = LX-105'), { fileName: 'decl.txt' });
  assert.equal(txt.format, 'keyvalue_text');
  assert.equal(txt.declaredFacts[0].value, 'LX-105');

  // 期间错位：只定位不改写
  const mis = parseArtifactBytes(Buffer.from('交易日期,收入,支出\n2026-01-05,10,0\n2026-02-05,10,0'), { fileName: 'b.csv', periodFrom: '2026-01-01', periodTo: '2026-12-31' });
  assert.ok(mis.qualityFlags.some((f) => f.flag === 'period_mismatch' && f.detail.includes('2026-12-31')));

  // 白名单外：PDF 魔数 → FORMAT_UNSUPPORTED + 人工入口
  const pdf = parseArtifactBytes(Buffer.from('%PDF-1.4 fake'), { fileName: 'a.pdf' });
  assert.equal(pdf.ok, false);
  assert.equal(pdf.code, 'FORMAT_UNSUPPORTED');
  assert.equal(pdf.manualEntry, true);

  // 空字节/坏编码：不编数（未知二进制=白名单外转人工，不猜测格式）
  assert.equal(parseArtifactBytes(Buffer.alloc(0), {}).code, 'PARSE_FAILED');
  const bin = parseArtifactBytes(Buffer.from([0xff, 0xfe, 0x00, 0xd8]), {});
  assert.equal(bin.code, 'FORMAT_UNSUPPORTED');
  assert.equal(bin.manualEntry, true);

  // ZIP 容器：交回协调层
  assert.equal(parseArtifactBytes(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), {}).code, 'IS_CONTAINER');
});

test('确定性：同字节同元数据恒同输出；缓存键含租户/客户/处理版本不跨客户', () => {
  const bytes = Buffer.from('交易日期,收入,支出\n2026-01-05,100,0\n2026-01-06,50,0');
  const a = parseArtifactBytes(bytes, { fileName: 'x.csv' });
  const b = parseArtifactBytes(bytes, { fileName: 'x.csv' });
  assert.deepEqual(a.aggregates, b.aggregates);
  assert.equal(a.parseId, b.parseId);
  assert.equal(parseCacheKey({ tenantId: 't', customerId: 'c1', sha256: 'abc', parserVersion: PARSE_ADAPTERS_VERSION }),
    parseCacheKey({ tenantId: 't', customerId: 'c1', sha256: 'abc', parserVersion: PARSE_ADAPTERS_VERSION }));
  assert.notEqual(parseCacheKey({ tenantId: 't', customerId: 'c1', sha256: 'abc', parserVersion: PARSE_ADAPTERS_VERSION }),
    parseCacheKey({ tenantId: 't', customerId: 'c2', sha256: 'abc', parserVersion: PARSE_ADAPTERS_VERSION }), '不同客户不共用缓存键');
  assert.throws(() => parseCacheKey({ tenantId: 't', customerId: 'c1', sha256: null, parserVersion: 'x' }), /缺 sha256/);
  assert.equal(detectFormat(Buffer.from('a,b,c'), {}).family, 'csv');
  assert.equal(detectFormat(Buffer.from('k = v'), {}).family, 'text');
});
