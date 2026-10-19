// Заповнює локальне сховище браузера синтетичними даними для
// скриншотів/перевірки візуального редизайну. НЕ чіпає .env.local
// і НЕ працює з production-даними: дані пишуться лише в localStorage
// того origin, який відкрив браузер.
//
// Запуск: node --require ./scripts/test-env.cjs --require ./scripts/test-alias.cjs \
//           scripts/seed-local-storage.cjs > /tmp/seed.json
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const dist = p => path.join(ROOT, '.test-dist', p);

const { dashboardFixture, SNAPSHOT_REF } = require(dist('tests/fixtures/dashboard-fixture.js'));
const { normalizeSettings } = require(dist('lib/settings.js'));

const snapshot = dashboardFixture();
const day = (n) => `2026-10-${String(n).padStart(2, '0')}`;

// Дрібні записи для інших розділів, щоб сторінки не були порожніми на скриншотах.
snapshot.tasks = [
  {
    id: 't-1', title: 'Підготувати пропозицію для Nova Lab',
    description: 'Стислий огляд обсягу і термінів',
    status: 'todo', priority: 'high', dueDate: day(21),
    createdAt: day(12), updatedAt: day(12),
  },
  {
    id: 't-2', title: 'Зібрати макети лендингу',
    description: '', status: 'doing', priority: 'medium', dueDate: day(24),
    createdAt: day(10), updatedAt: day(14),
  },
  {
    id: 't-3', title: 'Закрити рахунок за хостинг',
    description: '', status: 'done', priority: 'low', dueDate: day(8),
    createdAt: day(1), updatedAt: day(8), completedAt: day(8),
  },
];

snapshot.plannedProjects = [
  {
    id: 'pp-1', name: 'Каталог для мережі кав\'ярень', category: 'IT',
    clientName: 'Кав\'ярні міста', description: 'Очікуємо бриф',
    createdAt: day(9), updatedAt: day(9),
  },
  {
    id: 'pp-2', name: 'Особистий кабінет клієнта', category: 'Design',
    clientName: 'Nova Lab', description: 'Потрібна оцінка фронтенду',
    createdAt: day(5), updatedAt: day(11),
  },
];

snapshot.hostingServices = [
  {
    id: 'hs-1', name: 'VPS для клієнтських сайтів', site: 'vps.webagency.ua',
    provider: 'Hetzner', plan: 'CX22', currency: 'UAH', expectedPrice: 3200,
    note: '', createdAt: day(2),
  },
  {
    id: 'hs-2', name: 'Домени агенції', site: 'webagency.ua',
    provider: 'Reg.ru', plan: 'річна', currency: 'USD', expectedPrice: 120,
    note: '', createdAt: day(2),
  },
];

snapshot.hostingPayments = [
  {
    id: 'hp-1', serviceId: 'hs-1', date: day(3), amount: 3200, currency: 'UAH',
    periodStart: day(3), periodEnd: day(28), note: '', createdAt: day(3),
  },
];

snapshot.financeSettings = snapshot.financeSettings ?? normalizeSettings(null);
snapshot.meta = { lastSavedAt: new Date().toISOString(), lastManualBackupAt: '', backupSnoozedUntil: '' };

const keyOf = {
  projectsActive: 'projects_active',
  projectsCompleted: 'projects_completed',
  clients: 'clients',
  specialists: 'specialists',
  partners: 'partners',
  transactions: 'transactions',
  personalDebts: 'personal_debts',
  savings: 'savings',
  hostingServices: 'hosting_services',
  hostingPayments: 'hosting_payments',
  tasks: 'tasks',
  plannedProjects: 'planned_projects',
};

const payload = {};
for (const [field, key] of Object.entries(keyOf)) {
  payload[key] = JSON.stringify(snapshot[field] ?? []);
}
payload.crm_finance_settings = JSON.stringify(snapshot.financeSettings);
payload.crm_last_saved_at = snapshot.meta.lastSavedAt;

process.stdout.write(JSON.stringify(payload));
