import './globals.css';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '示例应用',
  description: '一个使用 Next.js 的中文基础布局示例',
  icons: [{ rel: 'icon', url: '/favicon.ico' }]
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="container">
          <nav className="navbar">
            <Link href="/" className="navlink">
              首页
            </Link>
            <div className="navlinks">
              <Link href="/upload" className="navlink">
                上传
              </Link>
              <Link href="/results" className="navlink">
                结果
              </Link>
              <Link href="/faq" className="navlink">
                FAQ
              </Link>
            </div>
          </nav>

          <main>{children}</main>

          <footer className="footer">
            <span>© {new Date().getFullYear()} 示例应用</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
