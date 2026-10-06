// Резолвер аlias `@/...` для скомпільованих тестів (.test-dist).
const Module = require('module');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, '.test-dist');
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function (request, parent, isMain, options) {
  if (typeof request === 'string' && request.startsWith('@/')) {
    const base = path.join(DIST, request.slice(2));
    const candidates = [base, `${base}.js`, path.join(base, 'index.js')];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return originalResolve.call(this, candidate, parent, isMain, options);
      }
    }
    return originalResolve.call(this, `${base}.js`, parent, isMain, options);
  }
  return originalResolve.call(this, request, parent, isMain, options);
};
