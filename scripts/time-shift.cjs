/**
 * Тимчасовий доказ стабільності тесту нагадувань: підміняє глобальний Date
 * на зсунутий у часі, щоб прогнати ту саму тестову добу в різні години.
 * Тільки для локальної перевірки, у CI не додається.
 *
 *   node -r ./scripts/time-shift.cjs --require ./scripts/test-env.cjs \
 *        --require ./scripts/test-alias.cjs --test .test-dist/tests/tasks.test.js
 *
 * Зсув задається змінною TIME_SHIFT_MS (година = 3600000).
 */
'use strict';

const shift = Number(process.env.TIME_SHIFT_MS || 0);
if (shift) {
  const RealDate = Date;
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + shift);
      else super(...args);
    }
    static now() { return RealDate.now() + shift; }
  }
  global.Date = ShiftedDate;
}
