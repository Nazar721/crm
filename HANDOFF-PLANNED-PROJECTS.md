# HANDOFF — Пакет 06: Заплановані проєкти (заміна «Завдання»)

- **База:** `0a5aeb5`
- **Дата:** 18.10.2026
- **Статус:** код готовий; усі локальні гейти зелені. Не виконано: production SQL, публікація, скриншоти.

## Що зроблено

Розділ «Завдання» (`/tasks`) замінено на «Заплановані проєкти» (`/planned-projects`) за вимогою Назара від 18.10.2026. Сутність: `id`, `name`, `category` (IT/Design/Video), `clientName`, `clientId?`, `description`, `createdAt`, `updatedAt`. Жодних фінансових полів, статусів, нагадувань, автоперенесення в активні проєкти.

### Клієнтський код

| Область | Файли | Деталі |
|---|---|---|
| Типи | `types/index.ts` | `PlannedProject`; `'plannedProjects'` у `ExportData` |
| Datasource | `lib/datasource/{types,local,supabase}.ts` | ключ колекції, мапа `planned_projects`, blocked-перевірка |
| Store | `lib/store.ts`, `context/AppContext.tsx` | `plannedProjects: []`; прибрано tasks-badge і весь delivery-цикл нагадувань |
| Дії | `lib/actions.ts` | `savePlannedProject` / `deletePlannedProject` через `atomicAction`; `clientId` зберігається лише за явного вибору з `Storage.getClients()` |
| Сторінка | `app/planned-projects/page.tsx` | пошук, фільтр категорії, таблиця, mobile «Детальніше», ConfirmModal |
| Форма | `components/planned/PlannedProjectForm.tsx` | Modal + AutocompleteInput клієнтів; ручне ім'я не створює картку і не лінкується |
| Редірект | `app/tasks/page.tsx` | `redirect('/planned-projects')` |
| Навігація | `components/layout/{Sidebar,TabBar}.tsx` | пункт «Заплановані проєкти» / «Заплановані» |
| CSS | `app/globals.css` | блок «Пакет 06»: `.planned-more` / `.planned-desc` для mobile |
| Settings | `lib/settings-tabs.ts`, `app/settings/page.tsx` | tab «Нагадування» прибрано; `plannedProjects: 0` в emptyCounts |
| Видалено | `components/settings/RemindersSettingsSection.tsx`, `components/tasks/` | разом з `TaskForm.tsx` |

### Історія, експорт, імпорт, валідація

- `lib/history/types.ts` / `engine.ts`: секція `'planned'`; залежність `plannedProjects.clientId → clients` (створення клієнта і restore проєкту).
- **Критичний фікс:** `normalizeHistoryEvent` фільтрував події жорстким списком секцій без `'planned'` → події історії не з'являлися; замінено на `HISTORY_SECTIONS as readonly HistorySection[]`.
- `lib/export.ts`, `lib/importer.ts`, `lib/validate-backup.ts`, `lib/storage.ts`: повна підтримка колекції; імпорт-семантика: **відсутність ключа `plannedProjects` = зберегти наявне; явний порожній масив = перезапис**.

### Помічник (assistant)

- `contract.ts`: домен `plannedProjects` замість `tasks`.
- `plan.ts`: схеми/дефолти/`missingQuestions ['name','category','clientName']`; `modelContext` з `PLANNED_PROJECTS_LIMIT = 200`, `{list,total,truncated}`.
- `executor.ts`, `transport.ts`, `applyAssistantPlan`: кейс `'plannedProjects'`.
- `instructions.ts` + `ASSISTANT-INSTRUCTIONS.md`: політика «Заплановані проєкти», truncated-рядок, матриця доменів; згадок tasks-домену — 0.

## SQL-міграція

`supabase/006-planned-projects.sql` (транзакція, ідемпотентна):

1. `crm_collection` CHECK: +`plannedProjects`; `crm_history_section` CHECK: +`planned`; label для колекції; мапа `plannedProjects → planned`.
2. `crm_read` / `crm_apply_collections` / `crm_commit`: 12 колекцій; у `crm_commit` стара колекція обов'язкова, нова опційна (`continue`), щоб старі клієнти не ламалися.
3. `crm_history_undo`: `v_planned` + дві перевірки залежностей (`CRM_UNDO_DEPENDENCY`) для `clientId`.
4. Legacy-колекція `tasks` лишається чинною; жодних DROP/DELETE для production даних.

**Застосування на production:** виконати файл `supabase/006-planned-projects.sql` у SQL Editor Supabase (або migration-пайплайном), потім перевірити read/commit/undo на живих даних. SETUP.sql перев створювати не потрібно.

## Тести

- `tests/planned-projects-sql.test.ts` (новий, PGlite): read, секція planned, legacy-клієнт без ключа не стирає проєкти, порожній масив перезаписує, undo create/delete, `CRM_UNDO_DEPENDENCY` ×2, legacy-секція tasks для старих подій.
- `tests/tasks.test.ts`: legacy-тести tasks лишені; AI- і perf-тести переписані на plannedProjects (контекст 10k → list 200/total/truncated).
- Фікстури оновлено (`plannedProjects: []`): `helpers.ts`, `backup-validation`, `import-incident` (12), `import-recovery` (2), `my-share`, `stage1-review` (5), `settings-tabs` (очікуваний набір табів).

## Перевірки (усі зелені, станом на повторний огляд 18.10)

| Команда | Результат |
|---|---|
| `npm run typecheck` | 0 помилок |
| `npm run lint` | exit 0, лише 10 наявних warning (у т.ч. `PlannedProjectForm` exhaustive-deps — аналогічний патерн `ProjectForm`) |
| `npm test` | 304/304 pass, 0 skipped (297 базових + 3 «06-рев'ю» + 4 «імпорт-ID») |
| `npm run test:sql` | 3/3 pass (включно «SQL-інтеграція 06») |
| `npm run build` | успішно: `/planned-projects` 5.31 kB, `/tasks` redirect 136 B |

## Рев'ю 18.10 (після `91c4e4b`): три блоки — одним комітом

Незалежний огляд відтворив три блоки; виправлені разом, SQL 006 лишається підготовленим і НЕ застосованим на production.

### P1 — backup мовчки обрізав опис (виправлено)

`lib/validate-backup.ts:validatePlannedProjectRecord` більше НЕ усікає `description` до 2000 (і `name`/`clientName` до 300/200) — власний експорт проходить export → validate → import без втрати вмісту. Обмеження 300/200 на записі лишаються у формі/діях (`validateRequiredText`) — відмова до запису, без тихого обрізання.

### P2 — AI partial update (виправлено)

`applyAssistantPlan` для `plannedProjects` тепер застосовує merged-запис (`{...old,...fields}`) з явною семантикою полів клієнта (див. нижче), а не сирі `fields`. Окремі зміни опису/назви/категорії працюють; не передані поля зберігаються; порожній опис — явне очищення; stale base → відмова без дубля; створення як і раніше вимагає повних обов'язкових полів.

### P3 — clientId: канонічні правила (виправлено, узгоджено форма ↔ AI ↔ запис)

1. **Явний непорожній `clientId`** → картка має існувати (інакше зрозуміла відмова до запису, без тихого переходу в ручне ім'я) і є джерелом канонічного `clientName` (mismatch ім'я/ID зберігає ім'я картки).
2. **Лише `clientName`** → ручний режим: без автопідбору за збігом імені, без створення картки; в AI-чернетці явний перехід показується як `clientId: null`.
3. **Без полів клієнта (partial edit)** → чинний зв'язок зберігається; застарілий ID (картку видалено) скидається без відмови редагування.
4. `normalizePlan` канонізує відомий ID → ім'я картки і відхиляє невідомий ID ще на етапі чернетки — draft і confirm не розходяться.

Реалізовано в `lib/actions.ts` (`validatePlannedProjectInput`, `_savePlannedProject`, гілка `applyAssistantPlan`) і `lib/assistant/plan.ts` (блок `plannedProjects`).

### Regression-тести (усі в `tests/tasks.test.ts`, зелені)

- **backup round-trip**: опис >2000 символів → export → validate (без warnings/issues) → import → повна рівність опису/назви/клієнта/категорії.
- **AI partial update**: окремо опис/назва/категорія/очищення опису; зв'язок клієнта не втрачається; stale base → відмова без змін; 5 успішних підтверджень = 5 груп журналу.
- **клієнт**: mismatch ім'я/ID → канонічне ім'я картки; невідомий ID → відмова, snapshot/історія без змін; неправильний тип ID → відмова; два клієнти з однаковими іменами → вибір за ID; AI-чернетка канонізує ім'я і відхиляє ghost ID; partial edit зберігає зв'язок; перехід на ручне ім'я відв'язує без створення картки.

## Повторний огляд 18.10: блокер — імпорт стирав ID (виправлено, одним комітом)

Незалежний повторний огляд відтворив: `validateHostingServiceRecord`, `validateHostingPaymentRecord`, `validateTaskRecord`, `validatePlannedProjectRecord` не викликали `baseRecordChecks` — `ctx.id` лишався `''`, тож import зберігав порожні ID (редагування за ID після імпорту не знаходило запис; два записи → «дублікат id «»»; числовий `42` приймався як `''`).

**Виправлення** (`lib/validate-backup.ts`): усі чотири валідатори тепер починаються з `baseRecordChecks` — спільна перевірка об'єкта та `rec.id` (`validId`); початковий ID зберігається як є; відсутній/порожній/null/числовий ID → recordIssue «відсутній або некоректний id» і пропуск запису (чинний механізм помилок, як у clients/projects), без генерації нових ID і без маскування. Зв'язок `hostingPayments.serviceId` (невідома картка → блокуюча помилка), семантика missing/empty колекцій і legacy-формат — без змін.

**Регресії** (`tests/import-ids.test.ts`, 4 тести):
1. export → validate → applyImport для 2+ записів кожної з чотирьох колекцій: ID, кількість, `serviceId` без змін, довгий опис (>2000) без втрат; після імпорту planned редагується і UI-дією, і AI-ланцюжком за початковим ID.
2. Биті ID (відсутній/порожній/null/числовий) у всіх чотирьох колекціях → по 4 recordIssue, 0 прийнятих, без підробленого `id: ''`.
3. Дублікат ID → блокуюча помилка, імпорт відхилено.
4. Хостинг: послуга з оплатою — serviceId незмінний.

## Не виконано (основному агенту після огляду)

1. Застосувати `supabase/006-planned-projects.sql` на production Supabase і перевірити історію/undo (підготовлена, НЕ застосована).
2. Публікація Vercel.
3. Скриншоти desktop + 390px — пропущено за вибором Назара (потрібен вхід у Supabase).
4. Ручна перевірка мобільного UI (44px цілі, 16px інпути, «Детальніше») на реальному пристрої — CSS реалізовано, пристрій не перевірявся.
5. Видалення production-даних задач не запускати (legacy лишається).
