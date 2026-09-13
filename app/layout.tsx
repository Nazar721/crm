import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppProvider } from '@/context/AppContext';
import Sidebar from '@/components/layout/Sidebar';
import TabBar from '@/components/layout/TabBar';
import ToastContainer from '@/components/ui/Toast';
import { ToastProvider } from '@/components/ToastProvider';
import InstallBanner from '@/components/ui/InstallBanner';
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
  themeColor: '#000000',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body>
        {/* Тимчасовий дебаг-хук: пише JS-помилки і стан canvas у DOM та на сервер */}
        <script
          dangerouslySetInnerHTML={{ __html: `
            (function () {
              var errors = [];
              function log(msg) {
                errors.push(msg);
                try {
                  var el = document.getElementById('crm-debug-log');
                  if (!el) {
                    el = document.createElement('pre');
                    el.id = 'crm-debug-log';
                    el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#200;color:#f88;font-size:11px;max-height:40vh;overflow:auto;white-space:pre-wrap;pointer-events:none;';
                    document.body.appendChild(el);
                  }
                  el.textContent += msg + '\\n';
                } catch (e) {}
              }
              window.addEventListener('error', function (e) {
                log('ERROR: ' + e.message + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno);
              });
              window.addEventListener('unhandledrejection', function (e) {
                var r = e.reason;
                log('REJECTION: ' + (r && r.stack ? r.stack : String(r)));
              });
              function sample() {
                var out = { path: location.pathname, canvases: [], errors: errors.slice() };
                try {
                  var cs = document.querySelectorAll('canvas');
                  for (var i = 0; i < cs.length; i++) {
                    var c = cs[i], painted = -1;
                    try {
                      var ctx = c.getContext('2d');
                      if (!ctx) { out.canvases.push('ctx-null'); continue; }
                      var img = ctx.getImageData(0, 0, Math.min(c.width, 400), Math.min(c.height, 200)).data;
                      painted = 0;
                      for (var j = 3; j < img.length; j += 4) if (img[j] > 0) painted++;
                    } catch (e) { painted = 'err:' + e.message; }
                    out.canvases.push(c.width + 'x' + c.height + ':' + painted);
                  }
                } catch (e) {}
                return out;
              }
              var lastPath = null, lastSig = '';
              setInterval(function () {
                var s = sample();
                var sig = JSON.stringify(s);
                if (s.path === lastPath && sig === lastSig) return;
                lastPath = s.path; lastSig = sig;
                try {
                  fetch('/api/debug-log', { method: 'POST', body: sig, keepalive: true });
                } catch (e) {}
              }, 2000);
            })();
          ` }}
        />
        <Script src="/sw-register.js" strategy="afterInteractive" />
        <AppProvider>
          <ToastProvider>
            <div className="orb-bg" aria-hidden="true">
              <div className="orb orb--blue" />
              <div className="orb orb--purple" />
              <div className="orb orb--teal" />
              <div className="orb orb--green" />
              <div className="orb orb--pink" />
            </div>
            <Sidebar />
            <TabBar />
            <main className="main-content">
              {children}
            </main>
            <InstallBanner />
          </ToastProvider>
        </AppProvider>
      </body>
    </html>
  );
}
