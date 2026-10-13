import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// ============================================================
// Обов'язковий SQL-прогін пакетів 03–05 (усі *-sql.test.js):
// history-sql (001+003) і hosting-sql (001+003+004+005).
// На відміну від npm test цей гейт НІКОЛИ не «пропускає» відсутність
// runtime: без @electric-sql/pglite (закріпленого devDependency) або
// без файлів тестів команда завершується помилкою — skip ≠ PASS.
// Використання: npm run test:sql (гейт перед прийманням/релізом).
// ============================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const bin = name => path.join(root, 'node_modules', '.bin', name);

try {
  require.resolve('@electric-sql/pglite');
} catch {
  console.error(
    'ПОМИЛКА: @electric-sql/pglite не встановлено.\n' +
    'SQL-інтеграції пакетів 03–05 обов’язкові для приймання/релізу: виконай `npm ci` (пакет закріплено у package.json/lock).',
  );
  process.exit(1);
}

const compile = spawnSync(bin('tsc'), ['-p', 'tsconfig.test.json'], { cwd: root, stdio: 'inherit' });
if (compile.status !== 0) process.exit(compile.status ?? 1);

const testDir = path.join(root, '.test-dist', 'tests');
const sqlFiles = fs.existsSync(testDir)
  ? fs.readdirSync(testDir).filter(f => f.endsWith('-sql.test.js')).sort().map(f => path.join('.test-dist', 'tests', f))
  : [];
if (!sqlFiles.length) {
  console.error('ПОМИЛКА: SQL-інтеграційні тести (*.test-dist/tests/*-sql.test.js) не знайдено — приймання неможливе.');
  process.exit(1);
}
console.log(`SQL-інтеграційні файли: ${sqlFiles.map(f => path.basename(f)).join(', ')}`);

const run = spawnSync(process.execPath, [
  '--require', './scripts/test-env.cjs',
  '--require', './scripts/test-alias.cjs',
  '--test',
  ...sqlFiles,
], { cwd: root, stdio: 'inherit' });
process.exit(run.status ?? 1);
