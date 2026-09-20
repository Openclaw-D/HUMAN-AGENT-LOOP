import io
p='site-mirror/app/workbench/proposal-panel.tsx'
s=io.open(p,encoding='utf-8').read()

# 1) onSubmit signature and payload
old = '''              onSubmit={(tendency, amount, rationale) => runAction(
                tendency === 'skip' ? 'assessment.decide' : 'assessment.candidate',
                tendency === 'skip'
                  ? `/api/jw/v2/actions/assessments/${encodeURIComponent(String(a.assessmentId))}/submit-review`
                  : `/api/jw/v2/actions/assessments/${encodeURIComponent(String(a.assessmentId))}/candidate`,
                tendency === 'skip' ? {} : {
                  candidate: {
                    tendency,
                    ...(amount != null ? { supportableAmountMinor: amount } : {}),
                    currency: 'CNY',
                    rationale,
                    producedBy: `page:${wb.session?.principalId ?? 'credit'}(synthetic)`,
                    conditions: [], warnings: [],
                  },
                },
                tendency === 'skip'
                  ? ['提交信审复核：进入送审记录。']
                  : [`候选倾向：${tendency}`, amount != null ? `支撑金额：${fmtAmount(amount)}（未知则留空）` : '支撑金额：不填（如实未知）', '候选 authority=none（服务端强制）：正式性仍属人。'],
              )}'''
new = '''              onSubmit={(tendency, amount, term, price, rationale) => runAction(
                tendency === 'skip' ? 'assessment.decide' : 'assessment.candidate',
                tendency === 'skip'
                  ? `/api/jw/v2/actions/assessments/${encodeURIComponent(String(a.assessmentId))}/submit-review`
                  : `/api/jw/v2/actions/assessments/${encodeURIComponent(String(a.assessmentId))}/candidate`,
                tendency === 'skip' ? {} : {
                  candidate: {
                    tendency,
                    ...(amount != null ? { supportableAmountMinor: amount } : {}),
                    ...(term != null ? { suggestedTermMonths: term } : {}),
                    ...(price != null ? { referencePriceMinor: price.minor, priceUnit: price.unit, priceBasis: price.basis } : {}),
                    currency: 'CNY',
                    rationale,
                    producedBy: `page:${wb.session?.principalId ?? 'credit'}(synthetic)`,
                    conditions: [], warnings: [],
                  },
                },
                tendency === 'skip'
                  ? ['提交信审复核：进入送审记录（正/附条件预评估确认的前置）。']
                  : [`候选倾向：${tendency}`,
                     amount != null ? `支撑金额：${fmtAmount(amount)}（未知则留空）` : '支撑金额：不填（如实未知）',
                     term != null ? `建议期限：${term} 个月（融资期限，非授信有效期）` : '建议期限：不填（待评估）',
                     price != null ? `参考价格：${fmtAmount(price.minor)} / ${price.unit}（口径：${price.basis}）` : '参考价格：不填（口径未配置，不编造利率）',
                     '金额/期限/价格绑定同一候选版本（§13.2）；候选 authority=none（服务端强制）：正式性仍属人。'],
              )}'''
assert old in s, 'onSubmit block'
s = s.replace(old, new)

# 2) form head with new state + price precheck
old = '''function CandidateForm({ assessmentId, status, onSubmit }: {
  assessmentId: string;
  status: string;
  onSubmit: (tendency: string, amountMinor: number | null, rationale: string) => void;
}) {
  const [tendency, setTendency] = useState('do');
  const [amount, setAmount] = useState('');
  const [rationale, setRationale] = useState('');'''
new = '''function CandidateForm({ assessmentId, status, onSubmit }: {
  assessmentId: string;
  status: string;
  onSubmit: (tendency: string, amountMinor: number | null, termMonths: number | null, price: { minor: number; unit: string; basis: string } | null, rationale: string) => void;
}) {
  const [tendency, setTendency] = useState('do');
  const [amount, setAmount] = useState('');
  const [term, setTerm] = useState('');
  const [priceMinor, setPriceMinor] = useState('');
  const [priceUnit, setPriceUnit] = useState('');
  const [priceBasis, setPriceBasis] = useState('');
  const [rationale, setRationale] = useState('');
  // §13.2：价格三字段一体——提供价格时单位与口径必填（客户端先按与 Edge 相同规则预检，不触网）。
  const buildPrice = (): { minor: number; unit: string; basis: string } | null | 'invalid' => {
    if (!priceMinor.trim() && !priceUnit.trim() && !priceBasis.trim()) return null;
    const minor = Number(priceMinor);
    if (!Number.isFinite(minor) || minor < 0 || !priceUnit.trim() || !priceBasis.trim()) return 'invalid';
    return { minor, unit: priceUnit.trim(), basis: priceBasis.trim() };
  };'''
assert old in s, 'form head'
s = s.replace(old, new)

# 3) fields + actions
old = '''            <div className="wb-field" style={{ flex: 1 }}><label>理由（业务语言）</label>
              <input className="wb-input" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="依据哪些材料/事实（正式性仍属人）" />
            </div>
          </div>
          <div className="wb-actions">
            <button className="wb-btn small" disabled={!rationale.trim()} onClick={() => onSubmit(tendency, amount.trim() ? Number(amount) : null, rationale.trim())}>登记候选意见</button>
            <button className="wb-btn small ghost" onClick={() => onSubmit('skip', null, '')}>直接提交复核</button>
          </div>'''
new = '''            <div className="wb-field" style={{ width: 120 }}><label>建议期限（月，可空）</label>
              <input className="wb-input" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="如 36" aria-label="建议期限（月）" />
            </div>
            <div className="wb-field" style={{ width: 150 }}><label>参考价格（数值，可空）</label>
              <input className="wb-input" value={priceMinor} onChange={(e) => setPriceMinor(e.target.value)} placeholder="如 78000000（分）" aria-label="参考价格数值" />
            </div>
            <div className="wb-field" style={{ width: 110 }}><label>价格单位</label>
              <input className="wb-input" value={priceUnit} onChange={(e) => setPriceUnit(e.target.value)} placeholder="如 元/年" aria-label="价格单位" />
            </div>
            <div className="wb-field" style={{ width: 160 }}><label>价格口径</label>
              <input className="wb-input" value={priceBasis} onChange={(e) => setPriceBasis(e.target.value)} placeholder="如 固定租金口径" aria-label="价格口径" />
            </div>
            <div className="wb-field" style={{ flex: 1 }}><label>理由（业务语言）</label>
              <input className="wb-input" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="依据哪些材料/事实（正式性仍属人）" />
            </div>
          </div>
          <div className="wb-actions">
            <button className="wb-btn small" disabled={!rationale.trim()} onClick={() => {
              const t = term.trim() ? Number(term) : null;
              if (t != null && (!Number.isInteger(t) || t < 1 || t > 240)) { setRationale(''); return; }
              const pr = buildPrice();
              if (pr === 'invalid') { setRationale(''); return; }
              onSubmit(tendency, amount.trim() ? Number(amount) : null, t, pr, rationale.trim());
            }}>登记候选意见（同版金额/期限/价格）</button>
            <button className="wb-btn small ghost" onClick={() => onSubmit('skip', null, null, null, '')}>直接提交复核</button>
          </div>'''
assert old in s, 'form actions'
s = s.replace(old, new)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('candidate form ok')
