/** Translate known runtime terms for display only; keep facts and audit records intact. */
export function businessCopy(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/supersedes?/g, '更新原件')
    .replace(/新 attempt/g, '新一轮评估')
    .replace(/\bunverified\b/g, '待核验')
    .replace(/\bverified\b/g, '已核验')
    .replace(/\bunknown\b/g, '信息不足')
    .replace(/\basOf\b/g, '截至')
    .replace(/阈值包 sim-business@0\.3/g, '模拟演示规则');
}
