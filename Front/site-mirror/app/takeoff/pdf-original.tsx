import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';

/** Render authorized original bytes locally; no external viewer or blob iframe. */
export function PdfOriginal({ bytes, name }: { bytes: Uint8Array; name: string }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [text, setText] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    let task: PDFDocumentLoadingTask | undefined;
    setDocument(null); setPage(1); setError(''); setBusy(true);
    void Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?worker&url')]).then(async ([pdf, worker]) => {
      if (!alive) return;
      pdf.GlobalWorkerOptions.workerSrc = worker.default;
      task = pdf.getDocument({ data: bytes.slice(), disableFontFace: true, useWasm: false });
      const doc = await task.promise;
      if (alive) setDocument(doc);
    }).catch(() => { if (alive) { setError('这份 PDF 暂时无法显示，可下载原件查看。'); setBusy(false); } });
    return () => { alive = false; void task?.destroy(); };
  }, [bytes]);

  useEffect(() => {
    if (!document) return;
    let alive = true;
    let render: RenderTask | undefined;
    setBusy(true); setText(''); setError('');
    void document.getPage(page).then(async (pdfPage) => {
      if (!alive || !canvas.current) return;
      const viewport = pdfPage.getViewport({ scale: 1.6 });
      const target = canvas.current;
      target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height);
      target.style.width = `${viewport.width}px`;
      render = pdfPage.render({ canvas: target, viewport });
      const content = await pdfPage.getTextContent();
      if (alive) setText(content.items.map((item) => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join(''));
      await render.promise;
      if (alive) setBusy(false);
    }).catch(() => { if (alive) { setError('这一页暂时无法显示，可下载原件查看。'); setBusy(false); } });
    return () => { alive = false; render?.cancel(); };
  }, [document, page]);

  return <div className="tk-pdf-original">
    {document && <nav className="tk-canvas-controls" aria-label="原件页码">
      <button disabled={page === 1 || busy} onClick={() => setPage((n) => n - 1)}>上一页</button>
      <output>第 {page} 页 / 共 {document.numPages} 页</output>
      <button disabled={page === document.numPages || busy} onClick={() => setPage((n) => n + 1)}>下一页</button>
    </nav>}
    {busy && <p role="status">正在显示原件…</p>}
    {error && <p role="alert">{error}</p>}
    <canvas ref={canvas} aria-label={`${name}，第 ${page} 页`} hidden={busy || !!error} />
    {text && <details><summary>查看本页文字</summary><pre>{text}</pre></details>}
  </div>;
}
