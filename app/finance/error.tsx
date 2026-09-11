'use client';

export default function FinanceError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section className="page active" style={{ padding: 32, textAlign: 'center' }}>
      <h2 style={{ marginBottom: 12, color: 'var(--text-primary)' }}>Помилка на сторінці фінансів</h2>
      <p style={{ marginBottom: 20, color: 'var(--text-secondary)', fontSize: 14 }}>
        {error.message || 'Невідома помилка'}
      </p>
      <button className="btn btn-primary" onClick={reset}>Спробувати знову</button>
    </section>
  );
}
