// V5 ROWS · 最重要待办卡："补充说明"展开补充说明表单（不含文件上传能力） → POST /api/v5-preview/notes。
// 409 VERSION_CONFLICT / 网络错误 / 业务错误（NO_OPEN_TODO 等）一律保留草稿；
// 只有提交成功（outcome === 'ok'）才清空输入。提交是"补充说明"，不是审批通过：
// 界面不提供任何批准/放款/结清按钮。
import { useState, type FormEvent } from 'react';
import type { TodoItem } from '../../lib/v5-preview/shared-types';
import type { SubmitOutcome } from './rows-logic';
import styles from './preview.module.css';

interface TodoCardProps {
  todo: TodoItem | null;
  onSubmitNote: (todoId: string, text: string) => Promise<SubmitOutcome>;
}

export default function TodoCard({ todo, onSubmitNote }: TodoCardProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictHint, setConflictHint] = useState<string | null>(null);

  if (todo === null) {
    return (
      <section className={styles.todoCard} aria-label="当前待办">
        <p className={styles.todoKicker}>当前待办</p>
        <p className={styles.todoEmpty}>当前演示情景无开放待办；项目沟通仍可留言留档（合成演示）。</p>
      </section>
    );
  }

  // 判空后立即捕获 todoId：提交闭包不依赖可空属性（TS 收窄不跨函数边界）。
  const todoId = todo.id;
  // 只有"待补充"才提供提交入口；待复核不再提供注定 404 的表单；
  // 已完成/已结清维持标题/说明/状态徽标展示，不加提交入口。
  const canSubmit = todo.status === '待补充';
  const pendingReview = todo.status === '待复核';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (busy || text === '') return;
    setBusy(true);
    setError(null);
    setConflictHint(null);
    const result = await onSubmitNote(todoId, text);
    setBusy(false);
    if (result.outcome === 'ok') {
      // 成功反馈 = 服务端返回的最新状态（待办转"待复核"后卡片显示复核中说明），无需本地成功横幅。
      setDraft('');
      setFormOpen(false);
      return;
    }
    if (result.outcome === 'conflict') {
      // 409：草稿保留；页面级横幅全局告知，表单旁内联提示就近告知"可直接再次提交"。
      setConflictHint(`版本已更新至 v${result.toVersion}，可直接再次提交`);
      return;
    }
    // 业务错误与网络错误：草稿保留，可修改后重试。NOT_FOUND 不透传内部 todoId（P2-4）。
    setError(result.code === 'NOT_FOUND' ? '该待办已不在可提交状态，请刷新后查看最新状态' : result.message);
  }

  return (
    <section className={styles.todoCard} aria-label="当前待办">
      <p className={styles.todoKicker}>当前待办</p>
      <div className={styles.todoHead}>
        <div>
          <h2 className={styles.todoTitle}>{todo.title}</h2>
          <p className={styles.todoDetail}>{todo.detail}</p>
        </div>
        <div className={styles.todoActions}>
          <span className={styles.todoStatus}>{todo.status}</span>
          {canSubmit ? (
            <button
              type="button"
              className={styles.primaryBtn}
              aria-expanded={formOpen}
              aria-controls="v5-rows-note-form"
              onClick={() => {
                setFormOpen((v) => !v);
                setError(null);
                setConflictHint(null);
              }}
            >
              补充说明
            </button>
          ) : null}
        </div>
      </div>
      {pendingReview ? (
        <p className={styles.todoReviewNote} role="status">已提交补充说明，信审复核中（合成）</p>
      ) : null}
      {canSubmit && formOpen ? (
        <form id="v5-rows-note-form" className={styles.todoForm} onSubmit={handleSubmit}>
          <label className={styles.fieldLabel} htmlFor="v5-rows-note-text">
            补充说明（合成演示；提交后相关专业域转入待复核）
          </label>
          <textarea
            id="v5-rows-note-text"
            className={styles.textarea}
            value={draft}
            maxLength={2000}
            rows={4}
            placeholder="例：设备清单与报价要点说明（合成演示内容）。"
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className={styles.formRow}>
            <span className={styles.fieldHint}>{draft.trim().length}/2000 字符</span>
            <button type="submit" className={styles.primaryBtn} disabled={busy || draft.trim() === ''}>
              {busy ? '提交中…' : '提交说明'}
            </button>
          </div>
          {error !== null ? <p className={styles.formError} role="alert">提交失败：{error}（草稿已保留，可修改后重试）</p> : null}
          {conflictHint !== null ? <p className={styles.formConflict} role="status">{conflictHint}</p> : null}
        </form>
      ) : null}
    </section>
  );
}
