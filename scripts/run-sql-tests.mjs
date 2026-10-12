import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// ============================================================
// Обов'язковий SQL-прогін пакета 03 (tests/history-sql.test.ts).
// На відміну від npm test цей гейт НІКОЛИ не «пропускає» відсутність
// runtime: без @electric-sql/pglite (devDependency, закріплений у
// package.json/lock) команда завершується помилкою.
// Використання: npm run test:sql (окремо або перед прийманням/релізом).
// ============================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const bin = name => path.join(root, 'node_modules', '.bin', name);

try {
  require.resolve('@electric-sql/pglite');
} catch {
  console.error(
    'ПОМИЛКА: @electric-sql/pglite не встановлено.\n' +
    'SQL-інтеграція пакета 03 обов’язкова для приймання/релізу: виконай `npm ci` (пакет закріплено у package.json/lock).',
  );
  process.exit(1);
}

const compile = spawnSync(bin('tsc'), ['-p', 'tsconfig.test.json'], { cwd: root, stdio: 'inherit' });
if (compile.status !== 0) process.exit(compile.status ?? 1);

const run = spawnSync(process.execPath, [
  '--require', './scripts/test-env.cjs',
  '--require', './scripts/test-alias.cjs',
  '--test',
  '.test-dist/tests/history-sql.test.js',
], { cwd: root, stdio: 'inherit' });
process.exit(run.status ?? 1);
