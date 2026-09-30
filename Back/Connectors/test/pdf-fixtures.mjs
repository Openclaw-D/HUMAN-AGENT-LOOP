// 合法的一页 PDF；空页面模拟无文本层，损坏文件另用 malformed 用例覆盖。
export function makePdf(lines = []) {
  const escaped = lines.map(line => String(line).replace(/([()\\])/g, '\\$1'));
  const content = ['BT', '/F1 12 Tf', '16 TL', '72 740 Td', ...escaped.map(line => `(${line}) Tj T*`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let raw = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(raw, 'latin1')); raw += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(raw, 'latin1');
  raw += `xref\n0 6\n0000000000 65535 f \n${offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(raw, 'latin1');
}
