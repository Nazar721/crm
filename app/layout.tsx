import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppProvider, StorageWriteBanner } from '@/context/AppContext';
import Sidebar from '@/components/layout/Sidebar';
import TabBar from '@/components/layout/TabBar';
import AppTopbar from '@/components/layout/AppTopbar';
import ToastContainer from '@/components/ui/Toast';
import { ToastProvider } from '@/components/ToastProvider';
import InstallBanner from '@/components/ui/InstallBanner';
import CloudAccess from '@/components/CloudAccess';
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'WebAgency CRM',
  description: 'CRM система для веб-агентства — управління проєктами, клієнтами, фінансами',
  icons: {
    icon: '/favicon.png',
    apple: '/apple-touch-icon.png',
    other: [
      { rel: 'icon', type: 'image/png', sizes: '32x32', url: '/favicon.png' },
      { rel: 'icon', type: 'image/png', sizes: '192x192', url: '/icon-192x192.png' },
      { rel: 'icon', type: 'image/png', sizes: '512x512', url: '/icon-512x512.png' },
      { rel: 'apple-touch-icon', sizes: '180x180', url: '/apple-touch-icon.png' },
    ],
  },
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
  themeColor: '#101014',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body>
                <Script src="/sw-register.js" strategy="afterInteractive" />
        <CloudAccess><AppProvider>
          <ToastProvider>
            <Sidebar />
            <TabBar />
            <main className="main-content">
              <AppTopbar />
              <StorageWriteBanner />
              {children}
            </main>
            <InstallBanner />
          </ToastProvider>
        </AppProvider></CloudAccess>
      </body>
    </html>
  );
}
