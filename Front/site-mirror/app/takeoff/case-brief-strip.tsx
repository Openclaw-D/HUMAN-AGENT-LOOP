// V0.6-R3-02 · 四页统一业务简报条（收敛版）：顶部默认仅“当前状态＋一个明确下一步”，
// 必看警示（缺件/冲突/红线/无权/基于旧材料）保持常驻不折叠；客户背景、完整现状分列、
// 原因/依据与口径说明收进“背景与依据”展开区，按需查看（不以缩小字体或裁切减负）。
// 同客户同版本解释；跨页面（平台/材料/决策/流程）常驻显示；只读、不推进业务。
import { useMemo } from 'react';
import { deriveCaseBrief, type CaseBriefSource } from '../../lib/workbench/case-brief';
import { UiIcon } from './ui-icons';

export function CaseBriefStrip({ source, customerName, planBlock, separateAmounts = false }: { source: CaseBriefSource; customerName: string | null; planBlock?: CaseBriefSource['planBlock']; separateAmounts?: boolean }) {
  const brief = useMemo(() => deriveCaseBrief({ ...source, customerName, planBlock }), [source, customerName, planBlock]);
  const attention = brief.situation.some((s) => s.attention);
  // 顶部状态行：主状态（首行）＋候选金额/期间（必看项，不折叠）＋全部 attention 行
  // （关键缺件/冲突/红线/无权不藏进展开区）。
  const primary = brief.situation[0];
  const keyInfo = brief.situation.filter((s) => s.key === 'candidate');
  const warnings = brief.situation.slice(1).filter((s) => s.attention && s.key !== 'candidate');
  const folded = brief.situation.slice(1).filter((s) => !s.attention && s.key !== 'candidate');
  return (
    <section className={`tk-case-brief${attention ? ' has-attention' : ''}`} aria-label="客户业务简报（现在怎么样、下一步谁做什么；背景与依据可展开）">
      <p className="tk-brief-row">
        <span className="tk-brief-label"><UiIcon name="info" size={18}/>现在怎么样</span>
        {primary && (
          <span key={primary.key} className={primary.attention ? 'tk-brief-chip attention' : 'tk-brief-chip'}>
            <b>{primary.label}</b> {primary.text}
          </span>
        )}
        {keyInfo.map((s) => (
          <span key={s.key} className={s.attention ? 'tk-brief-chip attention' : 'tk-brief-chip'}>
            <b>{s.label}</b> {separateAmounts ? s.text.split(' · ')[0] : s.text}
          </span>
        ))}
        {warnings.map((s) => (
          <span key={s.key} className="tk-brief-chip attention">
            <b>{s.label}</b> {s.text}
          </span>
        ))}
      </p>
      {/* LT-02 UI-B：顶部首显=原因+责任人+一项动作（short）；核验/原件/版本/不自动采信等
          完整依据句不删，收进“背景与依据”展开区保持可达。 */}
      <p className="tk-brief-row"><span className="tk-brief-label"><UiIcon name="arrow" size={18}/>下一步</span><span className="tk-brief-text"><b>{brief.nextStep.who}</b>：{brief.nextStep.short ?? brief.nextStep.what}</span></p>
      <details className="tk-brief-more">
        <summary>背景与依据</summary>
        <p className="tk-brief-row"><span className="tk-brief-label">客户背景</span><span className="tk-brief-text">{brief.background}</span></p>
        {brief.nextStep.short && <p className="tk-brief-row"><span className="tk-brief-label">下一步依据</span><span className="tk-brief-text"><b>{brief.nextStep.who}</b>：{brief.nextStep.what}</span></p>}
        {folded.length > 0 && (
          <p className="tk-brief-row">
            <span className="tk-brief-label">其他现状</span>
            {folded.map((s) => (
              <span key={s.key} className="tk-brief-chip"><b>{s.label}</b> {s.text}</span>
            ))}
          </p>
        )}
        <p className="tk-brief-row"><span className="tk-brief-label">为什么</span><span className="tk-brief-text">{brief.reasons.join(' ')}</span></p>
        <p className="tk-brief-row tk-brief-caution">{brief.caution}</p>
      </details>
    </section>
  );
}
