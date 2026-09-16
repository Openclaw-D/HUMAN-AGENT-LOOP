import type { Metadata } from 'next';
import './globals.css';
import './jw-front.css';

export const metadata: Metadata = {
  title: '见微 · 融资租赁协同',
  description: '以人类专业判断与可追溯协同为边界的融资租赁协同界面。',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
