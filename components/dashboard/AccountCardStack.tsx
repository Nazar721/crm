'use client';

import { useId, useState, type CSSProperties } from 'react';

import { BANKS } from '@/lib/banks';
import { formatMoney } from '@/lib/utils';
import type { accountBalances } from '@/lib/assistant/balance-report';

type Account = ReturnType<typeof accountBalances>[number];
type StackStyle = CSSProperties & {
  [key: `--${string}`]: string | number;
};

const VISIBLE_CARDS = 3;
const CARD_STEP = 44;

function bankColor(account: Account): string {
  const colors: Record<string, string> = {
    mono: '#0B0E11',
    crypto_usdt: '#8A939B',
    privat: '#00A650',
  };
  return colors[account.id] ?? BANKS.find((bank) => bank.id === account.id)?.borderColor ?? '#8A939B';
}

export default function AccountCardStack({
  accounts,
  displayCurrency,
}: {
  accounts: Account[];
  displayCurrency: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pocketId = useId();
  // Also covers async account loading and deletion of the selected account.
  const selected = accounts.find((account) => account.id === selectedId) ?? accounts[0];

  if (!selected) return <p className="ov-stack-empty">Рахунків ще немає</p>;

  const visible = [
    ...accounts.filter((account) => account.id !== selected.id).slice(0, VISIBLE_CARDS - 1),
    selected,
  ];
  const showEquivalent = selected.native.currency !== displayCurrency;

  return (
    <div className="ov-wallet-accounts">
      <div
        className="ov-wallet-stack"
        style={{
          '--stack-rise': `${(visible.length - 1) * CARD_STEP}px`,
          '--wallet-tint': bankColor(selected),
        } as StackStyle}
      >
        <div className="ov-card-list" aria-label="Картки рахунків">
          {/* Keep DOM order stable; only each card's position changes on selection. */}
          {accounts.map((account) => {
            const rank = visible.findIndex((item) => item.id === account.id);
            if (rank === -1) return null;
            const depth = visible.length - rank - 1;
            const isSelected = account.id === selected.id;
            return (
              <button
                key={account.id}
                type="button"
                aria-pressed={isSelected}
                aria-controls={pocketId}
                aria-label={`${account.label}. Баланс ${formatMoney(account.native.amount, account.native.currency)}`}
                className="ov-wallet-card"
                style={{
                  '--bank-color': bankColor(account),
                  '--card-width': `${100 - depth * 12}%`,
                  '--card-y': `${rank * CARD_STEP}px`,
                  zIndex: rank + 1,
                } as StackStyle}
                onClick={() => setSelectedId(account.id)}
              >
                <span className="ov-bank-card-head">
                  <span className="ov-chip" aria-hidden="true">
                    <span className="ov-chip-border" />
                    {[0, 1, 2, 3].map((index) => (
                      <span key={index} className="ov-chip-contact" style={{ '--i': index } as StackStyle} />
                    ))}
                  </span>
                  <span className="ov-card-info">
                    <span className="ov-card-name" title={account.label}>{account.label}</span>
                    <span className="ov-card-currency">{account.native.currency}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Explicit selected tint replaces live backdrop sampling of moving cards.
            WebKit can retain an old blur surface when the cards swap z-order. */}
        <div className="ov-wallet-pocket" id={pocketId} role="status" aria-live="polite" aria-atomic="true">
          <div className="ov-pocket-text">
            <span className="ov-pocket-name">{selected.label}</span>
            <span className="ov-pocket-value">{formatMoney(selected.native.amount, selected.native.currency)}</span>
            <span className="ov-pocket-eq">
              {showEquivalent
                ? `еквівалент ${formatMoney(selected.displayEquivalent.amount, selected.displayEquivalent.currency)}`
                : selected.native.currency}
            </span>
          </div>
        </div>
      </div>

      {accounts.length > VISIBLE_CARDS && (
        <div className="ov-account-choices" aria-label="Усі рахунки">
          {accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              className="ov-account-choice"
              aria-pressed={account.id === selected.id}
              aria-controls={pocketId}
              onClick={() => setSelectedId(account.id)}
            >
              {account.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
