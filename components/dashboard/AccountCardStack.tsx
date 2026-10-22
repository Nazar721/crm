'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { formatMoney } from '@/lib/utils';
import { BANKS } from '@/lib/banks';
import type { accountBalances } from '@/lib/assistant/balance-report';

type Account = ReturnType<typeof accountBalances>[number];

type StackStyle = React.CSSProperties & {
  [key: `--${string}`]: string | number | undefined;
};

/** Макимум карток одночасно у візуальному стосі; решта доступна через перемикач. */
const STACK_LIMIT = 4;

/** Геометрія шарів назад → вперед: кожна наступна нижча й ширша. */
const RANKS = [
  { width: 210, height: 112, top: 0 },   // задня: вища, вужча
  { width: 270, height: 140, top: 22 },   // середня
  { width: 340, height: 184, top: 46 },   // передня: ще нижче, найширша
] as const;

function bankGradient(account: Account): string {
  const bank = BANKS.find((b) => b.id === account.id);
  const accent = bank?.borderColor ?? '#C0C8D5';

  // Явні кольори рахівок за реifenсом: Monobank — чорний, USDT — сірий, PrivatBank — зелений.
  const forced: Record<string, string> = {
    mono: '#0B0E11',          // Monobank — чорний
    crypto_usdt: '#8A939B',   // Крипта USDT — сіра
    privat: '#00A650',        // ПриватБанк — зелений
  };
  const color = forced[account.id] ?? accent;

  // Виразний градієнт на всю картку: темний тон → акцент → темний тон.
  return `linear-gradient(135deg, color-mix(in srgb, ${color} 30%, #12181E), ${color}, color-mix(in srgb, ${color} 30%, #0B1015))`;
}

export default function AccountCardStack({
  accounts,
  displayCurrency,
}: {
  accounts: Account[];
  displayCurrency: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    accounts[0]?.id ?? null
  );

  // Якщо обраний рахунок зник, повертаємося до першого доступного.
  useEffect(() => {
    if (
      selectedId != null &&
      !accounts.some((account) => account.id === selectedId)
    ) {
      setSelectedId(accounts[0]?.id ?? null);
    }
  }, [accounts, selectedId]);

  // Порядок назад → вперед; обрана картка завжди остання у масиві (передня).
  const ordered = useMemo(() => {
    if (!selectedId) return accounts.slice();
    return [...accounts].sort((a, b) =>
      a.id === selectedId ? 1 : b.id === selectedId ? -1 : 0
    );
  }, [accounts, selectedId]);

  const rendered = useMemo(() => {
    if (ordered.length <= STACK_LIMIT) return ordered;
    const front = ordered[ordered.length - 1];
    return [...ordered.slice(0, STACK_LIMIT - 1), front];
  }, [ordered]);

  const select = useCallback(
    (id: string) => {
      if (id === selectedId) return;
      setSelectedId(id);
    },
    [selectedId]
  );

  const selected = accounts.find((a) => a.id === selectedId) ?? null;
  const showEq = selected ? selected.native.currency !== displayCurrency : false;

  if (accounts.length === 0) {
    return <p className="ov-stack-empty">Рахунків ще немає</p>;
  }

  const stackHeight =
    RANKS[RANKS.length - 1].top + RANKS[RANKS.length - 1].height + 20;

  return (
    <div className="ov-wallet-stack">
      <div className="ov-card-list" style={{ height: stackHeight }}>
        {rendered.map((account, rank) => {
          const isFront = rank === rendered.length - 1;
          const r = RANKS[Math.min(rank, RANKS.length - 1)];
          const background = bankGradient(account);
          const native = formatMoney(
            account.native.amount,
            account.native.currency
          );
          const ariaLabel =
            `${account.label}. Баланс ${native}` +
            `. ${isFront ? 'Обрано — передня картка' : 'Натисніть, щоб вибрати цю картку'}`;

          return (
            <button
              key={account.id}
              type="button"
              aria-pressed={isFront}
              aria-label={ariaLabel}
              className="ov-wallet-card"
              style={{
                '--bg': background,
                width: `${r.width}px`,
                height: `${r.height}px`,
                top: `${r.top}px`,
                zIndex: rank + 1,
              } as StackStyle}
              onClick={() => select(account.id)}
            >
              <div className="ov-card-head">
                <div className="ov-chip" aria-hidden="true">
                  <span className="ov-chip-border" />
                  <span className="ov-chip-contact" style={{ '--i': 0 } as StackStyle} />
                  <span className="ov-chip-contact" style={{ '--i': 1 } as StackStyle} />
                  <span className="ov-chip-contact" style={{ '--i': 2 } as StackStyle} />
                  <span className="ov-chip-contact" style={{ '--i': 3 } as StackStyle} />
                </div>
                <div className="ov-card-info">
                  <span className="ov-card-name" title={account.label}>
                    {account.label}
                  </span>
                  <span className="ov-card-currency">{account.native.currency}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="ov-wallet-pocket" aria-hidden="true">
        <div className="ov-pocket-sheen" aria-hidden="true" />
        {selected && (
          <div className="ov-pocket-text">
            <span className="ov-pocket-name">{selected.label}</span>
            <span className="ov-pocket-currency">{selected.native.currency}</span>
            <span className="ov-pocket-value">
              {formatMoney(selected.native.amount, selected.native.currency)}
            </span>
            {showEq && (
              <span className="ov-pocket-eq">
                еквівалент {formatMoney(
                  selected.displayEquivalent.amount,
                  selected.displayEquivalent.currency
                )}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
