# HANDOFF — Візуальний редизайн WebCRM

Графітова робоча панель: графіт + помаранчевий `#FF8156`.

База: `6a8f9db` → поточний HEAD. Гілка `stage2-supabase`.
План: `PLAN-VISUAL-REDESIGN.md` (mapping 15 KPI + 7 панелей, токени, етапи A–F).

---

## 1. Що змінилось

**Було:** 15 однакових плиток з кольоровими іконками, 7 графіків без пояснень, скляні
картки з `backdrop-filter` і світіннями, блакитні/фіолетові градієнти, іконки-орбіти.

**Стало:** єдина графітова панель з одним акцентом.

| Етап | Коміт | Що |
|---|---|---|
| 0 | `9786cb5` | Замороження логіки: view-model, фікстура, знімок 15 KPI / 8 серій |
| A | `811deec` | Графітові токени, motion-база, чистка glass/glow/orb |
| B | `961f631` | Оболонка: sidebar, tabbar, focus trap діалогів, drawer на вузькому desktop |
| C | `ab036df` | Нова головна «Огляд» на `lib/dashboard-view.ts`, scoped `ov-*` |
| D | `4374053` | Графіт поза головною: фінанси, графіки, банки, PWA-банер |
| E | `e8da0ca` | Семантика перемикачів, reduced motion, `aria-controls` без «сиріт» |

40 файлів, +2683 / −992. `app/globals.css`: 800 вставок / 579 видалень.

---

## 2. Токени

`:root` у `app/globals.css`. Старі імена (`--accent-blue`, `--glass-*`, `--border`,
`--text-muted`, `--danger`…) перенаправлені на нові — старі селектори продовжують працювати.

| Токен | Значення | Призначення |
|---|---|---|
| `--g-bg` | `#101014` | фон застосунку |
| `--g-nav` | `#15151B` | sidebar / tabbar / topbar |
| `--g-surface` | `#1B1B23` | картки, панелі |
| `--g-elevated` | `#24242E` | hover, інпут-фон |
| `--g-border` | `#34343F` | **декоративні** межі (1.4:1, не для тексту) |
| `--g-border-strong` | `#70747C` | **функціональні** межі інпутів (3.28:1) |
| `--g-text` | `#F5F5F7` | основний текст |
| `--g-text-dim` | `#ACACBB` | другорядний |
| `--g-text-muted` | `#8E92A0` | підписи |
| `--g-accent` | `#FF8156` | єдиний акцент |
| `--g-accent-ink` | `#21130D` | текст на акценті (**7.33:1**; білий = 2.46 ❌) |
| `--g-income` | `#65D6A1` | надходження / прибуток |
| `--g-expense` | `#F48891` | витрати / борги |
| `--g-warning` | `#E8BD69` | увага |
| `--radius-sm/md/lg/xl` | 10 / 14 / 18 / 22 | |
| `--ease` / `--transition` | `cubic-bezier(0.32,0.72,0,1)` / `0.18s` | |

Гейт контрасту: `npm run check:contrast` → **40 пар, 0 порушень**.

---

## 3. Головна «Огляд»

Джерело даних — **`lib/dashboard-view.ts`** (`buildDashboardView`). Сторінка лише
рендерить; жодної агрегації в JSX. Формули `lib/calc.ts`, `lib/income-report.ts`,
`lib/dates.ts` не змінювались.

Композиція (desktop ≥ 1200):

1. Шапка: «Огляд» + повна дата.
2. **3 ключові показники**: Чистий прибуток (за весь час), Дохід у фінансах
   (за поточний місяць), Мій дохід від агенції (за поточний місяць → діалог з деталізацією).
3. **Обсяг роботи** — 5 комірок: Активні, Завершені, Клієнти, Фахівці, Партнери.
4. **Гроші та зобов'язання** — 8 комірок: Загальний бюджет, Середній чек, Баланс,
   Відкладення, Борг клієнтів, Борг фахівцям, Борг мені, Мої борги.
5. **Рух коштів** — перемикач Надходження / Витрати / Обидва / Сальдо.
6. Закриті замовлення · Кількість проєктів.
7. Джерела клієнтів · Активи по банках.
8. **Відкладення** — перемикач По цілях / Загальний.

### Перевірка проти знімка

`npm run test` + `tests/dashboard-view.test.ts` звіряє view-model із
`tests/fixtures/dashboard-metrics-baseline.json`. На засіяних локальних даних
усі 15 KPI збігаються точно:

`net-profit 76500` · `month-income 50000` · `agencyMonthIncome 36000` ·
`total-budget 211000` · `avg-check 52750` · `balance 224244` · `savings 54650` ·
`client-debts 350500` · `specialist-debts 293650` · `debt-owed 15000` ·
`my-debts 32800` · `stat-active 2` · `stat-completed 4` · `stat-clients 6` ·
`stat-specialists 2` · `stat-partners 1`

Критерій «показники не змішувались» дотримано: «дохід у фінансах» (`monthIncome`),
«мій дохід від агенції» (`incomeForMonth().agencyIncome`) і «закрито замовлень»
(`series.completedPaid`) — три різні серії, три різні підписи.

### Правила агрегації (не чіпати)

- підпис проєкту: `endDate → finishDate → createdAt`;
- транзакції: без `hidden`, без `source 'project_…'`, за `date || plannedDate`;
- дохід агенції: `incomeForMonth()` за чинною формулою;
- вікно 12 місяців: `monthKeyOf()` (**Europe/Kyiv**), не локальний пояс пристрою.

---

## 4. Доступність

- **Контраст:** `#21130D` на `#FF8156` = 7.33:1. Білий на помаранчевому ніде не
  використовується (2.46:1). `--g-border-strong: #70747C` = 3.28:1 — для інпутів
  і фокус-меж; `--g-border` (1.4:1) — лише декоративний.
- **Діалоги:** `role="dialog"`, `aria-modal`, `aria-labelledby`, кнопка закриття
  з `aria-label`. `components/ui/useDialogFocus.ts`: focus trap, Escape-стек
  (закривається лише найглибший), body-lock з лічильником. Focus повертається
  на тригер.
- **Оболонка:** `aria-current="page"` на активних пунктах; «Більше» має
  `aria-haspopup/aria-expanded/aria-controls` (останній — лише поки аркуш у DOM);
  бургер посилається на `#app-sidebar`, який завжди присутній.
- **Перемикачі:** `role="group"` + `aria-pressed` (не `tablist` — панелей немає).
- **Заголовки:** один `h1`, далі `h2` по порядку. Немає `img` без `alt`,
  кнопок без імені та полів без підпису.
- **Рух:** `@media (prefers-reduced-motion: reduce)` глобально + окремо
  `.install-banner`, `.tabbar-sheet`, `.modal`, `.anim-chart`.
- Кожний `<canvas>` має `role="img"` + `aria-label`, що саме він показує;
  під графіками — текстовий підпис (сенс не залежить від canvas).

---

## 5. Оболонка

- **768–1199 px раніше не мали навігації вообще** (sidebar ховається ≤768, tabbar
  лише ≤767). Додано `AppTopbar` + висувний sidebar з overlay у цьому діапазоні;
  Escape і зміна маршруту його закривають.
- `Дашборд` / `Dashboard` → **`Огляд`** (sidebar і tabbar).
- Активний пункт: графіт + помаранчевий індикатор (смуга 3px у sidebar,
  риска 18×2 px у tabbar).

---

## 6. Графіки

`components/charts/ChartSetup.tsx` — спільна тема `CHART`, `CHART_X`, `CHART_Y`,
`CHART_LEGEND`, `CHART_TOOLTIP`. Усі графіки переведені на неї (включно з
`SpecialistStatsModal`, `WeeklyFinanceChart`, `DebtsChart`).

- Кольори за **значенням**: дохід `#65D6A1`, витрата `#F48891`, акцент `#FF8156`,
  категорії — нейтральні. Банки (`lib/banks.ts`) перефарбовані в графітовий набір.
- `FinanceBarChart` отримав `mode?: 'both' | 'in' | 'out' | 'net'`;
  дефолт `'both'` — **старі виклики не зламані**.
- `IncomeChart`, `ProjectsBarChart`, `SavingsChart`, `SourcesChart`,
  `BankBalancesChart`, `AgencyIncomeChart` — API не змінювався.

---

## 7. Гейти (виконати перед публікацією)

| Гейт | Команда | Результат |
|---|---|---|
| Типи | `npm run typecheck` | **0** |
| Lint | `npm run lint` | **0 помилок / 10 попереджень** |
| Контраст | `npm run check:contrast` | **40 пар PASS** |
| Тести | `npm test` | **312 pass / 1 fail** |
| SQL | `npm run test:sql` | **3 / 3** |
| Збірка | `npm run build` | **Compiled successfully** |

- `/dashboard` **8.16 kB / First Load 211 kB**; спільний First Load **102 kB**
  (було ≈107 kB до Етапа A — прибрано glass/glow CSS).
- **Єдиний фейл тесту — попередній і не пов'язаний з редизайном:**
  `дії: нагадування — лише явна дата+час; перенесення не змінює дедлайн`
  (`tests/tasks.test.ts`) — залежить від поточного часу доби.
  Жоден файл `*task*` / `*remind*` редизайном не змінювався (перевірено
  `git diff --name-only 6a8f9db HEAD`). Той самий фейл був на базі `6a8f9db`.
- 10 попереджень lint — усі попередні (`ToastContainer`, `_` у `BankBalancesChart`,
  `img` у `Sidebar`, `useMemo` deps у формах), не з редизайну.

---

## 8. Тестове середовище

Окремий порт і локальне сховище, **без зміни `.env.local`**:

```bash
NEXT_PUBLIC_CRM_STORAGE=local NEXT_PUBLIC_SUPABASE_URL= \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= npx next dev -p 3210
```

Дані для скриншотів:

```bash
npm run seed:local > /tmp/seed.json
```

14 ключів (`projects_completed`, `transactions`, `clients`, `specialists`,
`partners`, `savings`, `personal_debts`, `hosting_*`, `tasks`, `planned_projects`,
`crm_finance_settings`, `crm_last_saved_at`) — вставити в `localStorage`
потрібного origin, бо початковий стан порожній.

> **Пастка:** `agent-browser open` створює новий контекст і localStorage зникає —
> тоді сторінка зависає на «Завантаження даних CRM…». Використовувати
> `agent-browser goto` для переходів; після декількох повних перезавантажень
> варто перезапустити dev-сервер.

---

## 9. Обмеження — зафіксувати свідомо

1. **Референси ТЗ на диску відсутні** — макети були лише в чаті. Редизайн зроблено
   за текстовим описом «графітової робочої панелі» в `PLAN-VISUAL-REDESIGN.md`.
2. **Скриншотів «до» немає.** Спроба підняти базу `6a8f9db` у `git worktree`
   на окремому порті впала на клієнтському винятку (worktree ділить
   `node_modules` з поточним деревом; це не пов'язано з редизайном).
   Стан «до» реконструюється з коміту `811deec` — це **лише CSS** (diff
   `app/globals.css`, 800/579), переглянутий рядок за рядком.
3. Скриншоти «після» у `docs/screenshots/` (10 файлів): desktop 1440,
   tablet 900 (з перевіркою відсутності горизонтального переповнення),
   mobile 390, діалог агенції, аркуш «Більше», і шість сторінок.
4. Не впроваджено (поза скоупом за ТЗ): Framer Motion / нові залежності,
   SQL-зміни, нові бізнес-функції, публікація проміжних макетів.
   Не копіювались: банківські картки, rewards, бонуси, англійські тексти,
   Instagram UI, панель із кодом.

---

## 10. Що не чіпати при подальшому розвитку

- Формули в `lib/calc.ts`, `lib/income-report.ts`, `lib/dates.ts`.
- `tests/fixtures/dashboard-metrics-baseline.json` — регенерувати лише свідомо:
  `npm run snapshot:dashboard`.
- Скоуп CSS Етапа C — лише `ov-*`. Глобальні `.page` / `.stat-card` / `.chart-card`
  зачіпають усі сторінки: змінювати обережно і проганяти всі гейти.
- `--g-border` (1.4:1) ніколи не піднімати до ролі функціональної межі —
  це зламає візуальну ієрархію; для неї є `--g-border-strong`.
- Білий текст на `--g-accent` заборонено (2.46:1); використовувати
  `--g-accent-ink`.
