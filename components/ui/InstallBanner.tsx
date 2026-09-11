'use client';
import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed) {
      setIsDismissed(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    window.addEventListener('appinstalled', () => {
      setShowBanner(false);
      setDeferredPrompt(null);
      localStorage.setItem('pwa-installed', 'true');
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    setIsInstalling(true);
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowBanner(false);
    }
    setDeferredPrompt(null);
    setIsInstalling(false);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    setIsDismissed(true);
    localStorage.setItem('pwa-install-dismissed', 'true');
  };

  if (!showBanner || isDismissed || !deferredPrompt) return null;

  return (
    <div className="install-banner">
      <div className="install-banner__content">
        <div className="install-banner__icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div className="install-banner__text">
          <span className="install-banner__title">Встановити WebCRM</span>
          <span className="install-banner__subtitle">Додаток на головний екран</span>
        </div>
        <div className="install-banner__actions">
          <button
            className="install-banner__btn install-banner__btn--primary"
            onClick={handleInstall}
            disabled={isInstalling}
          >
            {isInstalling ? 'Встановлення...' : 'Встановити'}
          </button>
          <button
            className="install-banner__btn install-banner__btn--close"
            onClick={handleDismiss}
            aria-label="Закрити"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2"/>
              <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </button>
        </div>
      </div>

      <style jsx>{`
        .install-banner {
          position: fixed;
          bottom: 80px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 1000;
          width: calc(100% - 32px);
          max-width: 420px;
          animation: bannerSlideUp 0.4s cubic-bezier(0.22, 1, 0.36, 1);
        }

        @keyframes bannerSlideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(20px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }

        .install-banner__content {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 16px;
          background: linear-gradient(135deg, rgba(37, 99, 235, 0.15), rgba(20, 184, 166, 0.1));
          border: 1px solid rgba(96, 165, 250, 0.25);
          border-radius: 16px;
          backdrop-filter: blur(20px);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(96, 165, 250, 0.08);
        }

        .install-banner__icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: linear-gradient(135deg, #0A84FF, #5E5CE6);
          color: white;
          flex-shrink: 0;
        }

        .install-banner__text {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
          min-width: 0;
        }

        .install-banner__title {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .install-banner__subtitle {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .install-banner__actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }

        .install-banner__btn {
          border: none;
          border-radius: 999px;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.2s;
        }

        .install-banner__btn--primary {
          padding: 8px 16px;
          font-size: 13px;
          font-weight: 600;
          color: white;
          background: linear-gradient(135deg, #0A84FF, #5E5CE6);
          box-shadow: 0 4px 12px rgba(10, 132, 255, 0.3);
        }

        .install-banner__btn--primary:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(10, 132, 255, 0.4);
        }

        .install-banner__btn--primary:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none;
        }

        .install-banner__btn--close {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: transparent;
          color: var(--text-muted);
        }

        .install-banner__btn--close:hover {
          background: rgba(255, 255, 255, 0.08);
          color: var(--text-secondary);
        }

        @media (max-width: 480px) {
          .install-banner {
            bottom: 72px;
            width: calc(100% - 24px);
          }

          .install-banner__content {
            padding: 12px 14px;
          }

          .install-banner__btn--primary {
            padding: 7px 14px;
            font-size: 12px;
          }
        }
      `}</style>
    </div>
  );
}
