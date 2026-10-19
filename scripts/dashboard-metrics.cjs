// Генерує tests/fixtures/dashboard-metrics-baseline.json — початковий snapshot
// усіх 15 KPI і 7 графічних наборів на синтетичному фікстурі.
//
// Запуск: npm run snapshot:dashboard
// Файл оновлюється ЛИШЕ свідомо, коли змінюється сам набір показників.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const dist = p => path.join(ROOT, '.test-dist', p);

const { dashboardFixture, SNAPSHOT_REF } = require(dist('tests/fixtures/dashboard-fixture.js'));
const { viewMetrics, referenceMetrics, KPI_IDS } = require(dist('tests/fixtures/dashboard-metrics.js'));
const { buildDashboardView } = require(dist('lib/dashboard-view.js'));

const snapshot = dashboardFixture();
const view = viewMetrics(snapshot, SNAPSHOT_REF);
const reference = referenceMetrics(snapshot, SNAPSHOT_REF);

if (JSON.stringify(view) !== JSON.stringify(reference)) {
  console.error('Відмова: view-model не збігається з незалежним розрахунком.');
  process.exit(1);
}
if (Object.keys(view.kpi).length !== KPI_IDS.length) {
  console.error(`Відмова: очікувалося ${KPI_IDS.length} KPI, отримано ${Object.keys(view.kpi).length}.`);
  process.exit(1);
}
// 7 чинних панелей графіків + 1 модальний графік агенції.
const seriesCount = Object.keys(view.series).length;
if (seriesCount !== 8) {
  console.error(`Відмова: очікувалося 8 наборів (7 панелей + агенція), отримано ${seriesCount}.`);
  process.exit(1);
}

const out = path.join(ROOT, 'tests', 'fixtures', 'dashboard-metrics-baseline.json');
fs.writeFileSync(out, JSON.stringify(view, null, 2) + '\n');

const cash = buildDashboardView(snapshot, SNAPSHOT_REF);
console.log(`Записано ${path.relative(ROOT, out)}`);
console.log(`  KPI: ${Object.keys(view.kpi).length}, наборів серій: ${seriesCount} (7 панелей + агенція), місяців: ${cash.monthKeys.length}`);
