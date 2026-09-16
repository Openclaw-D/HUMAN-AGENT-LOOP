import { notFound } from 'next/navigation';
import { JwIcon, MODULES, ProgressDisc, VinextSafeAnchor, type JwModuleId } from '../jw-front';

const moduleIds = Object.keys(MODULES) as JwModuleId[];
export function generateStaticParams() { return moduleIds.filter((id) => id !== 'collaboration').map((module) => ({ module })); }

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  if (!moduleIds.includes(module as JwModuleId) || module === 'collaboration') notFound();
  const item = MODULES[module as JwModuleId];
  return <main className="jw-module-page"><header><VinextSafeAnchor href="/" aria-label="返回见微总入口">见微</VinextSafeAnchor><span>{item.stage}</span><small>当前模块</small></header><section className="jw-module-card"><JwIcon name={item.icon} size={52} /><p>{item.en}</p><h1>{item.name}</h1><ProgressDisc filled={item.progress} /><p className="jw-module-copy">{item.description}</p><p className="jw-skeleton-copy">本轮只建立可识别、可进入、可返回总入口的页面骨架；未在此扩写业务内容或深层交互。</p><VinextSafeAnchor href="/">返回总入口</VinextSafeAnchor></section></main>;
}
