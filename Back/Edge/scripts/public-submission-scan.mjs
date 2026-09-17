// D25 提交前公开提交扫描（任务04 S4）：对"将进入公开仓库的文件集"做分类扫描。
// 文件集 = git ls-files（已跟踪）+ git ls-files --others --exclude-standard（未忽略的未跟踪），
// 即严格遵守 .gitignore 后真正会被提交的集合。
// 分级：HARD=密钥/私钥/JWT/数据库文件/视频音频/.env（命中即 exit 1，不得提交）；
//       REVIEW=需人工签核（Achieve 之外的图片/办公文档/大文件/压缩包/.log）；
//       INFO=用户已明确决定公开的历史资料（Achieve/**）与已知合成演示值。
// 输出 JSON 证据；退出码：0=无 HARD（REVIEW 需人工签核后才能提交）、1=有 HARD、2=执行错误。
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function git(args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: REPO_ROOT, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`git ${args.join(' ')}: ${String(stderr || err.message).slice(0, 200)}`));
      resolve(stdout.split(/\r?\n/).filter(Boolean));
    });
  });
}

const HARD_EXT = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4a', '.mp3', '.wav', '.flac', '.ogg', '.sqlite', '.sqlite3', '.dump', '.bak']);
const REVIEW_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic', '.pdf', '.pptx', '.docx', '.xlsx', '.zip', '.7z', '.rar', '.tar', '.gz', '.log']);
const TEXT_LIKE = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.txt', '.yml', '.yaml', '.sql', '.html', '.css', '.svg', '.csv', '.xml', '.cmd', '.ps1', '.sh', '.gitignore', '.gitattributes', '.env']);
const KNOWN_SYNTHETIC = new Set(['v7next', 'jw-local-demo', 'harness-demo-cred']);
const MAX_SCAN_BYTES = 5 * 1024 * 1024;

const SECRET_PATTERNS = [
  { re: /BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY/g, severity: 'HARD', kind: 'private_key', excerpt: 'omit' },
  { re: /gsk_[A-Za-z0-9]{16,}/g, severity: 'HARD', kind: 'zhipu_api_key', excerpt: 'omit' },
  { re: /sk-[A-Za-z0-9]{20,}/g, severity: 'HARD', kind: 'openai_style_key', excerpt: 'omit' },
  { re: /AKIA[0-9A-Z]{16}/g, severity: 'HARD', kind: 'aws_access_key', excerpt: 'omit' },
  { re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./g, severity: 'HARD', kind: 'jwt', excerpt: 'omit' },
  {
    re: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['"]([^'"\n]{3,})['"]/gi,
    severity: 'REVIEW', kind: 'credential_assignment', excerpt: 'redact-value',
    classify: (m, value) => (KNOWN_SYNTHETIC.has(value) || /^\$\{.*\}$/.test(value)) ? 'INFO' : 'REVIEW',
  },
  {
    re: /postgres(?:ql)?:\/\/[^\s'"]*:([^\s'"/@]+)@[^\s'"]+/gi,
    severity: 'REVIEW', kind: 'db_uri_with_password', excerpt: 'redact-password',
    classify: (m, value) => (KNOWN_SYNTHETIC.has(value) || /^\$\{.*\}$/.test(value)) ? 'INFO' : 'REVIEW',
  },
];

// 命中报告只存脱敏位置与类型，不复制秘密（D25 判据）：真实秘密若被原样摘录，
// 会在 exit 1 阻断提交的同时把秘密复制进已跟踪的报告文件，制造二次泄漏。
function redactExcerpt(pattern, matched) {
  if (pattern.excerpt === 'omit') return undefined;
  if (pattern.excerpt === 'redact-value') return matched.replace(/(['"])[^'"\n]{3,}(['"])/, '$1***$2').slice(0, 80);
  if (pattern.excerpt === 'redact-password') return matched.replace(/:\/\/([^:/\s'"]+):[^@/\s'"]+@/, '://$1:***@').slice(0, 80);
  return matched.slice(0, 60);
}

async function main() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const outArgIdx = process.argv.indexOf('--out');
  const out = outArgIdx >= 0 ? process.argv[outArgIdx + 1]
    : path.join(REPO_ROOT, 'docs', 'customer-next', 'acceptance', 'evidence', `d25-scan-${stamp}`, 'report.json');

  const tracked = await git(['ls-files']);
  const untracked = await git(['ls-files', '--others', '--exclude-standard']);
  const files = [...new Set([...tracked, ...untracked])].sort();

  const hard = [];
  const review = [];
  const info = [];
  const counts = { files: files.length, tracked: tracked.length, untrackedAdded: untracked.length, scannedText: 0 };

  for (const rel of files) {
    const abs = path.join(REPO_ROOT, rel);
    const ext = path.extname(rel).toLowerCase();
    const relPosix = rel.split(path.sep).join('/');
    let st;
    try { st = statSync(abs); } catch { continue; }

    if (relPosix.includes('node_modules/')) {
      hard.push({ file: relPosix, kind: 'node_modules_in_commit_set' });
      continue;
    }
    if (HARD_EXT.has(ext)) {
      hard.push({ file: relPosix, kind: `media_or_db_file${ext}` });
      continue;
    }
    if (ext === '.env' && !relPosix.endsWith('.env.example') && !relPosix.endsWith('.env.sample')) {
      hard.push({ file: relPosix, kind: 'env_file' });
      continue;
    }
    const inAchieve = relPosix.startsWith('Achieve/');
    if (REVIEW_EXT.has(ext)) {
      const entry = { file: relPosix, kind: `review_file${ext}`, bytes: st.size, note: inAchieve ? 'Achieve 历史资料：用户已明确决定公开（INFO）' : 'Achieve 之外：需人工确认非真实材料后方可提交' };
      (inAchieve ? info : review).push(entry);
      continue;
    }
    if (st.size > 10 * 1024 * 1024) review.push({ file: relPosix, kind: 'large_file', bytes: st.size });

    // 自排除（已知盲区，显式登记）：扫描报告自身（按 schemaVersion 识别，不依赖文件名）
    // 内含命中摘录行，重扫会递归自指放大。报告的人工签核在生成时完成，不在此重复计数。
    if (ext === '.json' && st.size < 20 * 1024 * 1024) {
      try {
        const preview = readFileSync(abs, 'utf8').slice(0, 200);
        if (preview.includes('"schemaVersion": "jw.d25-scan.v1"')) continue;
      } catch { /* 不可读则按普通文件扫 */ }
    }

    let buf;
    try { buf = readFileSync(abs); } catch { continue; }
    if (buf.length === 0) continue;
    if (buf.length > MAX_SCAN_BYTES) buf = buf.subarray(0, MAX_SCAN_BYTES);
    const isBinary = buf.subarray(0, 8192).includes(0);
    if (isBinary) {
      info.push({ file: relPosix, kind: 'binary_without_media_ext', bytes: st.size });
      continue;
    }
    counts.scannedText += 1;
    const text = buf.toString('utf8');
    for (const p of SECRET_PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(text)) !== null) {
        const line = text.slice(0, m.index).split('\n').length;
        const severity = p.classify ? p.classify(m[0], m[1]) : p.severity;
        const excerpt = redactExcerpt(p, m[0]);
        const entry = { file: relPosix, kind: p.kind, line, ...(excerpt ? { excerpt } : { excerptRedacted: true }) };
        if (severity === 'HARD') hard.push(entry);
        else if (severity === 'REVIEW') review.push(entry);
        else info.push({ ...entry, note: '已知合成演示值（公开）' });
        if (m.index === p.re.lastIndex) p.re.lastIndex += 1;
      }
    }
  }

  const report = {
    schemaVersion: 'jw.d25-scan.v1',
    scannedAt: new Date().toISOString(),
    counts,
    verdict: hard.length === 0 ? 'NO_HARD_FINDING' : 'HARD_FINDING',
    note: 'verdict 仅覆盖 HARD；REVIEW 项须人工签核后才可提交（D25：无客户视频、真实材料、密钥、令牌、数据库和日志）',
    hardFindings: hard,
    reviewFindings: review,
    infoNotes: info.slice(0, 500),
    infoCount: info.length,
  };
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');

  console.log(`[d25] 文件集=${counts.files}（跟踪${counts.tracked} + 新增${counts.untrackedAdded}），文本扫描=${counts.scannedText}`);
  console.log(`[d25] HARD=${hard.length} REVIEW=${review.length} INFO=${info.length}`);
  for (const h of hard.slice(0, 20)) console.log(`  HARD ${h.kind}: ${h.file}${h.line ? ':' + h.line : ''}`);
  for (const r of review.slice(0, 20)) console.log(`  REVIEW ${r.kind}: ${r.file}`);
  console.log(`  报告: ${path.relative(REPO_ROOT, out)}`);
  process.exit(hard.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`[d25] 执行错误: ${e.message}`);
  process.exit(2);
});
