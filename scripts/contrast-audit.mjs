#!/usr/bin/env node
/**
 * Аудит контрасту графітової палітри (WCAG 2.1).
 *  - звичайний текст:      >= 4.5:1
 *  - великий текст/фокус:  >= 3:1
 *  - функціональні межі:   >= 3:1
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'app/globals.css'), 'utf8');

const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/);
if (!rootBlock) throw new Error(':root block not found');

const vars = {};
for (const [, name, value] of rootBlock[1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
  vars[name.trim()] = value.trim();
}

/** Розв'язує ланцюжок var(--x) до hex. */
function resolve(token, depth = 0) {
  if (depth > 8) throw new Error(`var cycle at ${token}`);
  const raw = vars[token];
  if (!raw) throw new Error(`unknown token ${token}`);
  const ref = raw.match(/^var\((--[a-z0-9-]+)\)$/);
  if (ref) return resolve(ref[1], depth + 1);
  const hex = raw.match(/^#([0-9a-f]{3,8})$/i);
  if (!hex) throw new Error(`token ${token} is not a hex color: ${raw}`);
  let h = hex[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  return `#${h.toUpperCase()}`;
}

const lum = (hex) => {
  const c = hex.slice(1).match(/../g).map((x) => parseInt(x, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const SURFACES = ['--g-bg', '--g-nav', '--g-surface', '--g-elevated'];
const TEXT = [
  ['--g-text', '--g-text', 4.5],
  ['--g-text-dim', '--g-text-dim', 4.5],
  ['--g-text-muted', '--g-text-muted', 4.5],
  ['--g-accent (текст)', '--g-accent', 4.5],
  ['--g-income (текст)', '--g-income', 4.5],
  ['--g-expense (текст)', '--g-expense', 4.5],
  ['--g-warning (текст)', '--g-warning', 4.5],
];

const INK = [
  ['--g-accent-ink on --g-accent', '--g-accent-ink', '--g-accent', 4.5],
  ['--g-accent-ink on --g-income', '--g-accent-ink', '--g-income', 4.5],
  ['--g-accent-ink on --g-expense', '--g-accent-ink', '--g-expense', 4.5],
  ['--g-accent-ink on --g-warning', '--g-accent-ink', '--g-warning', 4.5],
];

const CHROME = [
  ['--g-border-strong (межа)', '--g-border-strong', 3],
  ['--g-accent (фокус)', '--g-accent', 3],
];

const failures = [];
const rows = [];

function check(label, fg, bg, min) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  rows.push({ ok, label, fg, bg, r: r.toFixed(2), min });
  if (!ok) failures.push(`${label}: ${r.toFixed(2)} < ${min}`);
}

for (const [name, token, min] of TEXT) {
  const fg = resolve(token);
  for (const surface of SURFACES) {
    check(`${name} на ${surface}`, fg, resolve(surface), min);
  }
}
for (const [label, fgTok, bgTok, min] of INK) {
  check(label, resolve(fgTok), resolve(bgTok), min);
}
for (const [name, token, min] of CHROME) {
  const fg = resolve(token);
  for (const surface of SURFACES) {
    check(`${name} на ${surface}`, fg, resolve(surface), min);
  }
}

const width = Math.max(...rows.map((r) => r.label.length));
for (const r of rows) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label.padEnd(width)}  ${r.r.padStart(6)} (min ${r.min})  ${r.fg} / ${r.bg}`);
}

if (failures.length) {
  console.error(`\n${failures.length} порушень контрасту:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nOK: ${rows.length} пар, жодної порушення.`);
