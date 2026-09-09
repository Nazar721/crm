import type { Metadata, Viewport } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import { AppProvider } from '@/context/AppContext';
import Sidebar from '@/components/layout/Sidebar';
import TabBar from '@/components/layout/TabBar';
import ToastContainer from '@/components/ui/Toast';
import { ToastProvider } from '@/components/ToastProvider';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-main',
  display: 'swap',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'WebAgency CRM',
  description: 'CRM система для веб-агентства — управління проєктами, клієнтами, фінансами',
  icons: { icon: '/favicon.ico' },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'WebCRM',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#070a0f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body>
        <AppProvider>
          <ToastProvider>
            <Sidebar />
            <TabBar />
            <main className="main-content">
              {children}
            </main>
          </ToastProvider>
        </AppProvider>
      </body>
    </html>
  );
}
