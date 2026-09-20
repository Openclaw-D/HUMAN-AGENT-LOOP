/** Displays the returned support score on a ten-step scale without changing it. */
export function ConfidenceMeter({ confidence, tied = false }: { confidence: number | null; tied?: boolean }) {
  const percent = confidence === null ? null : Math.round(confidence * 100);
  return <div className="tk-confidence-meter">
    <div className="tk-confidence-caption"><span>置信度{tied ? ' · 并列' : ''}</span><strong>{percent === null ? '待评估' : `${percent}%`}</strong></div>
    <div className="tk-confidence-track" role="meter" aria-label="证据支持把握，未校准" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={percent === null ? '待评估' : `${percent}%，未校准`}>
      <span className="tk-confidence-fill" style={{ width: `${percent ?? 0}%` }}/>
    </div>
  </div>;
}
