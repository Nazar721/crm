import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = name => path.join(root, 'node_modules', '.bin', name);

const compile = spawnSync(bin('tsc'), ['-p', 'tsconfig.test.json'], { cwd: root, stdio: 'inherit' });
if (compile.status !== 0) process.exit(compile.status ?? 1);

const testDir = path.join(root, '.test-dist', 'tests');
const files = fs.existsSync(testDir)
  ? fs.readdirSync(testDir).filter(f => f.endsWith('.test.js')).map(f => path.join(testDir, f)).sort()
  : [];

if (!files.length) {
  console.error('Тести не знайдено в .test-dist/tests');
  process.exit(1);
}

const run = spawnSync(process.execPath, [
  '--require', './scripts/test-env.cjs',
  '--require', './scripts/test-alias.cjs',
  '--test',
  ...files,
], { cwd: root, stdio: 'inherit' });

process.exit(run.status ?? 1);
