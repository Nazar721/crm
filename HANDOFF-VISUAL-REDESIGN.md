# HANDOFF — Візуальний редизайн WebCRM (ітерація 2)

Графітова робоча панель: графіт + **градієнтний** помаранчевий `#FF8A4C → #F45125`.

База: `6a8f9db` → ітерація 1 (`… → 2708cf4`) → **поточна ітерація 2**. Гілка `stage2-supabase`.
План: `PLAN-VISUAL-REDESIGN.md`, де **§6 — чинна композиція і палітра** (§1–§5 описують
ітерацію 1 і лишаються джерелом даних/заборон).
Обсяг: **32 файли, +1042/−541** (один коміт, без пушу).

---

## 1. Ітерація 1 → ітерація 2

Ітерацію 1 (коміти `9786cb5 … 2708cf4`) **відхилено**. Кожну вимогу власника
перетворено на структурну зміну, а не на підправку кольорів.

| Вимога | Що зроблено |
|---|---|
| «Перезібрати структуру, не чинити лише кольори» | `app/dashboard/page.tsx` переписано: три секції замість 8 плиткових блоків |
| Прибрати верхній ряд із трьох карток | Немає. Перший блок — секція **«Агенція»**: `.ov-hero` (5/12) + «Завершені проєкти» (7/12) |
| Перший ряд агенції ≈5/7, gap 16px | `.ov-row--lead { grid-template-columns: 5fr 7fr; gap: 16px }` |
| Помітні заголовки «Агенція» / «Мої фінанси» | `h2.ov-sec-title`, 1.3rem / 700, власний рядок над секцією |
| Підпис періоду в усіх KPI | Кожен `.ov-metric` має `.ov-metric-period` (`за весь час`, `на сьогодні`, `Жов 2026 · за поточний місяць`) |
| Прибрати `primary`-плитки, `moneyRows`, ряди обведених прямокутників, кольорові смуги зверху | Немає: `.ov-card` = 16px padding + тонка межа, **без смуги**; «Масштаб роботи» = `.ov-scale` з `·`-роздільниками |
| Прибрати режим «Сальдо» | `FinanceMode = 'both' \| 'in' \| 'out'` (`components/charts/FinanceBarChart.tsx`) |
| Витрати — лише чинний звіт | `monthExpenses = incomeForMonth(snap, monthKey).financeExpenses`, не `income − expenses` |
| Текст на акценті міряти в найгіршій точці градієнта | Гейт додає `#FF8A4C` і `#F45125`; ink `#21130D` на `#F45125` = **5.20:1** |
| «Занадто тьмяна» палітра | Градієнт `--g-accent-surface` на hero, primary-кнопки `.ov-hero-action`, суцільний `--g-accent #FF7A42`; поверхні заглиблено до `#0D0D0F/#131318/#19191F/#202027` |
| Одна зібрана ітерація | Один коміт (див. `git log -1`), без пушу до огляду |

---

## 2. Токени (чинна палітра)

`:root` у `app/globals.css`. Старі імена (`--accent-blue`, `--glass-*`, `--border`…)
перенаправлені — старі селектори продовжують працювати.

| Токен | Значення | Призначення |
|---|---|---|
| `--g-bg` | `#0D0D0F` | фон застосунку |
| `--g-nav` | `#131318` | sidebar / tabbar / topbar |
| `--g-surface` | `#19191F` | картки, панелі |
| `--g-elevated` | `#202027` | hover, інпут-фон, фон тултипів |
| `--g-border` | `#34343F` | **декоративні** межі (1.4:1, не для тексту) |
| `--g-border-strong` | `#70747C` | **функціональні** межі (3.28:1 до `#24242E`) |
| `--g-text` / `-dim` / `-muted` | `#F5F5F7` / `#ACACBB` / `#8E92A0` | текст |
| `--g-accent` | `#FF7A42` | єдиний акцент; на ньому суцільний фон primary-кнопок (білий `#F5F5F7` = **2.38:1** ❌ → `--g-accent-ink`; сам `--g-accent` на `--g-surface` = 6.76:1) |
| `--g-accent-ink` | `#21130D` | текст на акценті / градієнті: **5.20:1** на `#F45125`, **7.73:1** на `#FF8A4C`, **6.97:1** на `#FF7A42` |
| `--g-accent-ink-dim` | `#2E1B12` | другорядний текст на градієнті: **4.72:1** на `#F45125` |
| `--g-accent-start` / `-end` | `#FF8A4C` → `#F45125` | `--g-accent-surface: linear-gradient(135deg, …)`; білий на ньому = **2.34…3.47:1 → заборонений** |
| `--g-income` / `--g-expense` / `--g-warning` | `#65D6A1` / `#F48891` / `#E8BD69` | без змін |
| `--radius-sm/md/lg/xl` | 10 / 14 / 18 / 22 | без змін |
| `--ease` / `--transition` | `cubic-bezier(0.32,0.72,0,1)` / `0.18s` | без змін |

Перефарбовано поза головною: `components/charts/ChartSetup.tsx` (accent/fill/tooltip),
`lib/dashboard-view.ts` SOURCE_COLORS (Telegram `#FF7A42`, нейтральні `#7C8194`),
`lib/banks.ts` (cash EUR), `components/charts/SpecialistStatsModal.tsx`,
`themeColor` у `app/layout.tsx` → `#0D0D0F`. Старі `rgba(255,129,86,*)` замінені на
`rgba(255,122,66,*)`.

Гейт: `npm run check:contrast` → **44 пар, 0 порушень**.

---

## 3. Головна «Огляд» — чинна композиція

Джерело даних — **`lib/dashboard-view.ts`** (`buildDashboardView`). Сторінка лише рендерить.
Формули `lib/calc.ts`, `lib/income-report.ts`, `lib/dates.ts` **не змінювались**.

```
Огляд · вівторок, 20 жовтня 2026 р.
Агенція                                             [h2]
[ .ov-hero 5/12 — градієнтна картка ][ Завершені проєкти 7/12 · сег Оплати/Кількість ]
[ Фінанси агенції 7/12 — 5 KPI ][ Джерела клієнтів 5/12 ]
[ Масштаб роботи 12/12 — «·»-рядок, без плиток ]
Мої фінанси                                        [h2]  [ ⌄ Графік активів ]
[ Баланс 5/12 — сума + рахунки ][ Надходження/Витрати 7/12 · сег Разом/Надх/Вит ]
[ Надходження за місяць 6/12 ][ Витрати за місяць 6/12 ]
[ #ov-assets 12/12 — «Активи рахунків», лише при aria-expanded=true ]
[ Відкладення та цілі 6/12 ][ Особисті борги 6/12 ]
```

**Ряди:** `.ov-row--57` (5/12 ‖ 7/12), `.ov-row--75`, `.ov-row--even` (6/6), `.ov-row--full`,
`.ov-row--lead` (5/7), gap 16px. Усі стають одноколонковими ≤1100px.

**Рішення щодо «Графіку активів»:** це кнопка `.ov-sec-action` у шапці секції «Мої фінанси»
(`aria-expanded` → `#ov-assets`), рядок із `BankBalancesChart` розкривається **в кінці**
секції — щоб не зрушувати задані власником ряди.

**Дані:** `stats.monthIncome` для надходжень; `incomeForMonth(snap, monthKey).financeExpenses`
для витрат; `accountBalances(s)` (`lib/assistant/balance-report.ts`) дає `label`,
`native.amount/currency`, `displayEquivalent.amount/currency` — рахунки показують суму у
власній валюті, а «еквівалент …» лише коли валюти різні.

### Перевірка проти знімка

`npm test` + `tests/dashboard-view.test.ts` звіряє view-model із
`tests/fixtures/dashboard-metrics-baseline.json` (файл **не регенерувався**).
На засіяних локальних даних усі 15 KPI збігаються точно:

`net-profit 76500` · `month-income 50000` · `agencyMonthIncome 36000` ·
`total-budget 211000` · `avg-check 52750` · `balance 224244` · `savings 54650` ·
`client-debts 350500` · `specialist-debts 293650` · `debt-owed 15000` ·
`my-debts 32800` · `stat-active 2` · `stat-completed 4` · `stat-clients 6` ·
`stat-specialists 2` · `stat-partners 1`

Семантика не змішана: «дохід у фінансах» (`monthIncome`), «мій дохід від агенції»
(`incomeForMonth().agencyIncome`), «витрати за місяць» (`financeExpenses`) і
«оплати завершених» (`series.completedPaid`) — чотири різні серії, чотири підписи.

### Правила агрегації (не чіпати)

- підпис проєкту: `endDate → finishDate → createdAt`;
- транзакції: без `hidden`, без `source 'project_…'`, за `date || plannedDate`;
- дохід агенції: `incomeForMonth()` за чинною формулою;
- вікно 12 місяців: `monthKeyOf()` (**Europe/Kyiv**), не локальний пояс пристрою.

---

## 4. Доступність

- **Контраст:** див. §2. Текст на градієнті міряється на `#F45125` (найтемніший кінець).
  Білий на акценті/градієнті ніде не використовується.
- **axe (повна сторінка `/dashboard`): 1 порушення** — `meta-viewport`
  (`app/layout.tsx:34-41`, `userScalable: false`). **Pre-existing, на весь застосунок,
  поза скоупом цієї ітерації — не змінювати, але виправити окремо** (жест зуму на мобільному
  зараз вимкнено). `color-contrast` на `.ov-hero-*` повертається як *incomplete* (градієнт) —
  перевірено вручну гейтом 44/44.
- **`role-img-alt` усунуто:** глобальний плагін `canvas-a11y` у `ChartSetup.tsx`
  (`afterInit` → `aria-hidden` на `<canvas>` без `aria-label`). Сенс графіка дає текстовий
  підпис під ним; `<canvas>` не дублюється для скрінрідерів.
- **Діалоги:** `role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-label` на кнопці
  закриття. `components/ui/useDialogFocus.ts`: focus trap, Escape-стек, body-lock,
  повернення фокуса на тригер.
- **Перемикачі:** `role="group"` + `aria-pressed`; `.ov-sec-action` має `aria-expanded`
  і `aria-controls="ov-assets"` (**лише поки панель у DOM** — без «сиріт»).
- **Фокус:** глобальний `:focus-visible { outline: 2px solid var(--g-accent); outline-offset: 2px }`;
  окремо `.ov-hero-action` (ink, offset 3px — на помаранчевому) і `.ov-sec-action`.
  Перевірено Tab-проходом: фокус на «Деталізація →» має `2px solid #21130D`.
- **Рух:** `@media (prefers-reduced-motion: reduce)` — `.ov-card` отримує
  `transition-duration: 1e-05s`, правило для `.install-banner` наявне (перевірено `eval`).
- Один `h1` («Огляд»), далі `h2`/`h3` по порядку; немає `img` без `alt` і кнопок без імені.
- Touch-цілі ≥44×44; `main { padding-bottom: 100px }` при tabbar 61px — контент не ховається.

---

## 5. Оболонка

- **768–1199 px** мають `AppTopbar` + висувний sidebar з overlay; Escape і зміна маршруту
  його закривають.
- `Дашборд` / `Dashboard` → **`Огляд`** (sidebar і tabbar).
- Активний пункт: графіт + помаранчевий індикатор (смуга 3px у sidebar, риска 18×2 px у tabbar).

---

## 6. Графіки

`components/charts/ChartSetup.tsx` — спільна тема `CHART`, `CHART_X`, `CHART_Y`,
`CHART_LEGEND`, `CHART_TOOLTIP` + плагін `canvas-a11y`.

- Кольори за значенням: дохід `#65D6A1`, витрата `#F48891`, акцент `#FF7A42`,
  категорії — нейтральні `#7C8194`.
- `FinanceBarChart` отримав `mode?: 'both' | 'in' | 'out'`; **режим `'net'` («Сальдо»)
  видалено**, дефолт `'both'` — старі виклики не зламані.
- `IncomeChart`, `ProjectsBarChart`, `SavingsChart`, `SourcesChart`, `BankBalancesChart`,
  `AgencyIncomeChart` — API не змінювався.
- Висота діаграм: `.ov-card .chart-body { flex: 1 1 auto; height: auto; min-height: 210px }`
  (≥1101px), donut 175px, `.ov-card--lead` 130px.

---

## 7. Гейти (виконано на поточному стані)

| Гейт | Команда | Результат |
|---|---|---|
| Типи | `npm run typecheck` | **0** |
| Lint | `npm run lint` | **0 помилок / 10 попереджень** (усі попередні) |
| Контраст | `npm run check:contrast` | **44 пар PASS** (було 40) |
| Тести | `npm test` | **313 pass / 0 fail** (було 312 pass / 1 fail) |
| SQL | `npm run test:sql` | **3 / 3** |
| Збірка | `npm run build` | **Compiled successfully**, 20 static pages |

**Bundle (однакова методологія, `next build`):** `/dashboard` **8.26 kB /
First Load 211 kB**; спільний First Load **102 kB** (ітерація 1: 8.16 / 211 / 102;
≈107 kB до Етапа A — прибрано glass/glow CSS). Жодних нових залежностей.

### Час доби більше не ламає тести

Єдиний попередній фейл (`tests/tasks.test.ts`, «нагадування — лише явна дата+час») залежав
від поточного часу Kyiv. Виправлено **без зміни бізнес-логіки**:

- `tests/tasks.test.ts` тепер імпортує `todayKyiv` і рахує дати локальною
  `addKyivDays(kyivDate, days)` (через `Date.UTC`, без DST-помилок) замість фіксованих
  `2026-01-19/20`, `2026-10-19/20`, `2026-10-01`.
- `scripts/time-shift.cjs` — dev-інструмент (preload, `TIME_SHIFT_MS`), який доводить
  стабільність: той самий тест на 6 зсувах (0, −5h, −5г04, +1h, −24h, +30д) = 19/19 у кожному.
- Індивідуальний доказ причини: `snoozeReminderIso('2026-10-19','18:00')` = `true` до 18:00 Kyiv
  і `false` після.

Ні один файл `*task*` / `*remind*` **бізнес-логіки** не змінювався — лише тест.

---

## 8. Тестове середовище і зйомка скриншотів

Окремий порт і локальне сховище, **без зміни `.env.local`**:

```bash
NEXT_PUBLIC_CRM_STORAGE=local NEXT_PUBLIC_SUPABASE_URL= \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= npx next dev -p 3210
```

Дані: `npm run seed:local > /tmp/seed.json` → вставити в `localStorage` потрібного origin
(початковий стан порожній).

### Пастки, які реально спрацювали під час цієї ітерації

1. **`npm run build` під час запущеного `next dev` у тому самому каталозі ламає dev** —
   прод-збірка перезаписує `.next`, сторінка повертає `500` і рендерить порожній `#__next`
   (`body.scrollHeight = 0`). Лікування: `pkill -f "next dev"`, `rm -rf .next`, перезапуск.
2. **Next.js DevTools-індикатор** (`nextjs-portal`, чорне коло з «N» у лівому нижньому куті)
   потрапляє у скриншоти. Він у shadow-root, тому його не видно в звичайному DOM.
   Перед зйомкою вставляти в `head`: `nextjs-portal{display:none!important}`.
3. **Повні знімки:** `screenshot --full` (один позиційний аргумент = шлях). Фіксований
   tabbar/sidebar залишається на початку сторінки і перекриває контент; надійніше
   зробити в’юпорт рівним `document.documentElement.scrollHeight`, перезавантажити і
   знімати звичайний (не `--full`) знімок — тоді fixed-елементи стають у кінець сторінки.
   Після зміни в’юпорту **перезавантажувати**: інакше `Chart.js` лишається з очищеним canvas.
4. **Скрол із `scroll-behavior: smooth`** (на `html`) сам себе скасовує: послідовні
   `scrollIntoView` → `window.scrollBy` дають `scrollY = 0`. Використовувати один
   `window.scrollTo({ top: …, behavior: 'instant' })`.
5. `agent-browser open` створює новий контекст і localStorage зникає — використовувати
   `agent-browser goto`. Сесія зйомки: `AGENT_BROWSER_SESSION="vis2-4418a87c70d8"`.

### Знімки «після» — `docs/screenshots/` (19 файлів)

| Файл | Що |
|---|---|
| `overview-desktop-1440.png` | повна сторінка (1440×1804) |
| `overview-desktop-1440-first-screen.png` | перший екран 1440×900 |
| `overview-tablet-1024.png` | повна сторінка, одноколонковий режим |
| `overview-mobile-390.png` / `overview-mobile-360.png` | повні сторінки |
| `overview-mobile-390-first-screen.png` | перший екран 390×844 |
| `overview-mobile-390-finance.png` | межа секцій «Масштаб роботи» → «Мої фінанси» |
| `overview-mobile-390-bottom.png` | межа «Витрати за місяць» → «Відкладення» / «Борги» |
| `overview-assets-chart.png` | `#ov-assets` розкрито |
| `overview-agency-modal.png` | Modal «Мій дохід від агенції по місяцях» |
| `overview-empty-crm.png` | порожня CRM: нулі + «Руху по рахунках ще немає» / «Цілей ще не додано» |
| `mobile-more-sheet.png` | аркуш «Більше» |
| `page-projects/finance/clients/settings/assistant/planned-projects.png` | решта сторінок |

`overview-tablet-900.png` **видалено** (замінено на 1024 — задані ширини 1440/1024/390/360).

Додатково перевірено вручну: `scrollWidth == clientWidth` на
1440/1200/1100/1024/900/768/600/480/390/360 (горизонтального переповнення немає);
перемикачі Оплати/Кількість, Разом/Надходження/Витрати, По цілях/Загальний і
«Графік активів» працюють, `aria-pressed`/`aria-expanded` оновлюються, **0 помилок консолі**.

---

## 9. Обмеження — зафіксувати свідомо

1. **`meta-viewport` (`app/layout.tsx:34-41`, `userScalable: false`) — pre-existing,
   на весь застосунок.** Це єдине порушення axe. Поза скоупом цієї ітерації,
   **не змінено**; вимагає окремого рішення (дозволити зум і переписати розміри під 16px).
2. **Скриншотів «до» немає.** Спроба підняти базу `6a8f9db` у `git worktree` впала на
   клієнтському винятку (worktree ділить `node_modules`). Стан «до» реконструюється з
   `811deec` (CSS) і `2708cf4` (композиція, у `docs/screenshots/` до цього коміту).
3. Референси ТЗ на диску відсутні — макети були лише в чаті.
4. Не впроваджено (поза скоупом): Framer Motion / нові залежності, SQL-зміни, нові
   бізнес-функції, зміна `lib/actions.ts`. Не копіювались: банківські картки, rewards,
   бонуси, англійські тексти, Instagram UI, панель із кодом.
5. `scripts/time-shift.cjs` — dev-інструмент для доведення стабільності тестів;
   у `package.json` не зареєстрований і в CI не вмикається.

---

## 10. Що не чіпати при подальшому розвитку

- Формули в `lib/calc.ts`, `lib/income-report.ts`, `lib/dates.ts` і бізнес-логіка
  `lib/actions.ts`.
- `tests/fixtures/dashboard-metrics-baseline.json` — регенерувати лише свідомо:
  `npm run snapshot:dashboard`.
- Скоуп CSS — лише `ov-*` на головній. Глобальні `.page` / `.stat-card` / `.chart-card`
  зачіпають усі сторінки: змінювати обережно і проганяти всі гейти.
- `--g-border` (1.4:1) ніколи не піднімати до ролі функціональної межі — для неї
  є `--g-border-strong`.
- Білий текст на `--g-accent` і на `--g-accent-surface` заборонено (2.38:1 / 2.34–3.47:1);
  використовувати `--g-accent-ink` / `--g-accent-ink-dim`.
- Не запускати `npm run build` при живому `next dev` (див. §8, пастка 1).
