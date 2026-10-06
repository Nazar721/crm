# HANDOFF — Етап 1: підготовка коду Finance CRM

Гілка: **`stage1-prep`** (від `main` @ `1b23db3`).
Стек: Next.js App Router · React · TypeScript · Chart.js · localStorage (як і раніше).

Цей документ — передача інтеграційному агенту (етап 2). На етапі 1 **не** підключалися
хмарні сервіси, акаунти, API-ключі, БД і деплой.

---

## 0. Команди запуску та фактичні результати

| Команда | Результат |
|---|---|
| `npm run typecheck` | ✅ 0 помилок |
| `npm run lint` | ✅ 0 помилок, **10 попереджень** (усі — наявні до змін; перед змінами було ~30 у 14 файлах) |
| `npm test` | ✅ **39/39** тестів пройдено |
| `npm run build` | ✅ `Compiled successfully`, `Generating static pages (16/16)` |
| `npm run dev` + ручний smoke (agent-browser) | ✅ див. нижче |

Локальний запуск: `npm run dev` → `http://localhost:3000`.

### Ручні перевірки в браузері (синтетичні дані)

1. **Усі маршрути** `/dashboard /assistant /settings /finance /projects /clients /debts /savings /partners /specialists` відкриваються без помилок у консолі.
2. **AI-помічник (без підключення):** надіслано «створи клієнта Іван» → відповідь «Помічник ще не підключений» + підказка «Серверна функція буде підключена на етапі 2».
3. **AI-налаштування:** фіктивний ключ `sk-test-key-1234567890` → «Формат ключа виглядає коректним (перевірка локальна; ключ не збережено і не надсилався)»; у `localStorage` **немає** жодного значення, що містить ключ/tokен/secret (`eval`-скан → `[]`).
4. **Demo-режим:** увімкнено → чат → уточнення → чернетка «Створити · Клієнти» → «Підтвердити» → «Демо-режим: жодного запису не створено… Реальний запис не створено»; лічильник «Клієнти 0», ключ `clients` у сховищі — відсутній.
5. **Створення транзакції:** «+ Дохід» → 1500 → «Готівка ₴» → у таблиці `+₴1 500`, запис у `localStorage.transactions`.
6. **Валюта відображення ≠ символ рахунку:** виставлено `USD` → рядок гривневого рахунку досі `+₴1 500`, а баланс `$36,59` (1500/41).
7. **Курси зберігають displayCurrency:** USD-курс 41→50 → `crm_finance_settings = {"usdRate":50,...,"displayCurrency":"USD"}`, баланс перераховано на `$30`.
8. **Облікова дата Kyiv:** «Останнє збереження: `06.10.2026, 18:08`» при `2026-10-06T15:08:25.629Z` (UTC) → +3 год.
9. **Імпорт: сторонній JSON** (`{"foo":"bar"}`) → модалка «Імпорт неможливий — файл відхилено до будь-якого запису», кнопка «Імпортувати» заблокована, дані не змінені.
10. **Імпорт: битий JSON** → «Некоректний JSON: SyntaxError…», дані не змінені.
11. **Імпорт: валідний файл** (3 транзакції, 1 з невалідним типом) → попередній перегляд: «Приймано 2 / Пропущено 1», попередження «Некоректні записи (1) — буде пропущено», текст «Операція не є атомарною…», копія `crm_import_previous` створена → після підтвердження в базі `1 проєкт · 1 клієнт · 2 транзакції`.
12. **Резервування:** після імпорту створено `crm_backup_1…crm_backup_5`.
13. **Збереження фільтрів:** на «Проєкти» вибрано вкладку «Завершені» + пошук «тест» → перехід на Dashboard → повернення → вкладка «Завершені» активна, у полі «тест».

---

## 1. Що змінено і що лишилося незавершеним

### 1.1 Надійність

| # | Що зроблено | Файли |
|---|---|---|
| 1 | **Runtime-валідація backup** до будь-якого запису: ідентифікатор формату (`app === 'WebAgency CRM'`), версія, обов'язкові масиви (усі 8 колекцій), типи, ID, базові зв'язки. Невідомий JSON → відмова. Стара підтримка визначена **явно**: `legacy-flat` (усі 8 колекцій на верхньому рівні, без метаданих) + версія `1`; обидва перевіряються окремо (`lib/validate-backup.ts`) | `lib/validate-backup.ts` (новий) |
| 2 | **Попередній перегляд імпорту**: кількість записів по колекціях, пропущені/невалідні записи, попередження, повідомлення «операція не є атомарною», **копія попереднього стану** в `crm_import_previous`. Запис готується заздалегідь; при збої — відновлення (`recovered:true`) або явний стан помилки (`recovered:false`) | `lib/importer.ts`, `app/settings/page.tsx` |
| 3 | **`_suppressBackups` прибрано як глобальний брудний прапорець**; заміна — `withBackupsSuppressed()` з обов'язковим скиданням через `finally` (`lib/backup.ts`). Використовується під час запису імпорту. Після збою імпорту резервування **не вимикається** (тест) | `lib/backup.ts`, `lib/importer.ts` |
| 4 | **Помилки запису/переповнення та пошкоджений JSON показуються**: пошкоджений ключ **кварантується** в `crm_corrupt_<key>` (оригінал зберігається), фіксується `StorageIssue`, користувач бачить тост і список у «Налаштування → Стан збереження». Порожній масив повертається **лише для розрахунків**, ніколи мовчки | `lib/datasource/local.ts`, `context/AppContext.tsx`, `app/settings/page.tsx` |
| 5 | **Курси не скидають displayCurrency** (`saveRates` читає чинні налаштування й мержить), залежні підсумки інвалідуються через snapshot (тест + браузер) | `lib/actions.ts`, `app/finance/page.tsx`, `lib/store.ts` |
| 6 | **Символ гривневого рахунку**: сума показується у валюті самого рахунку (`formatMoney(v,'UAH')`), а не у валюті відображення | `app/finance/page.tsx` |
| 7 | **`hidden` узгоджено з балансом**: приховані записи виключені з балансу, місячного доходу, графіка «Дохід по місяцях», «Доходи/витрати» дашборду та підсумків фільтрів. **Експорт усіх записів зберігає hidden** | `lib/calc.ts`, `app/finance/page.tsx`, `app/dashboard/page.tsx` |
| 8 | **Перевірки в обробниках збереження** (а не лише HTML): суми, рахунки, дати, курси, відсотки, валюти, enum-и, обов'язкові поля → `ActionResult` з переліком помилок; форми показують їх тостом | `lib/validate.ts`, `lib/actions.ts` |
| 9 | **Облікова дата за Europe/Kyiv**: `today()`, `getMonthKey()`, `daysBetween()`, `formatDate()`/`formatDateTime()` | `lib/dates.ts` (новий), `lib/utils.ts` |
| 10 | **Міграції один раз на версію**: прибрано безумовне переписування проєктів/партнерів/фахівців (тепер `v21`/`v11` з прапорцем), `migrate()` став асинхронним і чекає записів | `lib/migrations.ts`, `lib/migration-flags.ts` (новий) |
| 11 | **Дані не редагуються до завершення ініціалізації**: `AppProvider` рендерить стан «Завантаження даних CRM…» / «Не вдалося відкрити локальне сховище» + «Спробувати ще»; після міграцій — `reloadStore()` і лише потім `ready` | `context/AppContext.tsx` |

### 1.2 Оптимізація

- **Один snapshot на обчислення**: `getStatsContext(snapshot)` будує індекси за `clientId`/`developerId`/`partnerId` **одним проходом** і кешується на час життя snapshot. `clientStats`/`specialistStats`/`partnerStats`/`dashboardStats` приймають контекст — повторне читання localStorage для кожного клієнта прибрано.
- **Чисті розрахунки з явними даними/курсами**: `toDisplay(amount, currency, settings)`, `rateForCurrency(currency, settings)`, `bankAmountToDisplay`, `summarizeTransactions`, `monthIncome`, `savingsSummary`, `personalDebtSummary`, `bankBalances` — усі приймають явні дані/налаштування. **Формули проєкту, курсова історія та система обліку платежів не змінювались** (захищено тестом).
- **Немає читання localStorage у конвертаціях/форматуванні**: кеш `lib/settings.ts` з інвалідацією після збереження.
- **Пагінація**: стартово 60 (фінанси/борги/відкладення/проєкти) і 50 (клієнти/партнери); підсумки, графіки та експорт рахуються **по повному відфільтрованому набору** (тест `пагінація не обрізає підсумки та експорт`).
- **Збереження UI-стану між переходами**: `sessionStorage`-хуки (`hooks/useUiState.ts`) для пошуку/фільтрів/вкладок + відновлення прокрутки. Розмітка карток/графіків не змінювалась.
- **`SpecialistStatsModal` вантажиться динамічно** лише при відкритті (`dynamic(..., {ssr:false})`).
- **`refreshKey` збережено** і тепер має коректне оновлення: дані йдуть через `snapshot` у контексті (попередження ESLint у змінених файлах зникли саме тому, а не вилученням залежності).
- **Важка повна копія відокремлена** від основного запису: `lib/backup.ts` (ротація `crm_backup_1…5`, throttle 30 с, прапорець `crm_backup_pending`, best-effort `pagehide`). Стан «є незбережені зміни / актуальна / остання помилка» показано в «Налаштування».
- **Стани завантаження/помилок**: глобальний шел застосунку + тости помилок сховища. Глобальний редизайн CSS/графіків **не робився** (додано лише нові класи AI та шел станів у кінець `globals.css`).

### 1.3 Підготовка до серверної бази

- **Інтерфейс асинхронного сховища** `CrmDataSource` + локальний адаптер `LocalDataSource` (`lib/datasource/`). Сторінки/форми не знають про бекенд: вони працюють зі snapshot у пам'яті (`lib/store.ts`) через фасад `lib/storage.ts`.
- **Завантаження та помилки явні** (`status: loading|ready|error` у контексті); **синхронні розрахунки працюють зі snapshot**, не з localStorage.
- **Читання браузерного сховища не є залежністю SSR**: сервер рендерить лише шел «Завантаження даних CRM…», усі сторінки монтуються на клієнті після `ready`.
- **Доменні дії відокремлено від React**: `lib/actions.ts` (валідація → запис → `ActionResult`). Створення клієнтської картки реалізовано в цьому ж шарі (`createClient`/`updateClient`/`resolveClient`) і використовується формою проєкту, сторінкою клієнтів та (надалі) AI.
- Контракт операцій/помилок/версії/експорту — розділ 3 цього документа.

### 1.4 AI-помічник

Сторінка `/assistant`, пункт у desktop-навігації (розділ «AI») і в мобільному меню (аркуш «Більше»).
Реалізовано: чат, надсилання, скасування очікування, історія (`sessionStorage`); чернетка дії
(сутність, поля, суми, «що зміниться», підтвердження/скасування); уточнення та виправлення
чернетки; результат із переходом до запису; активний провайдер+модель у шапці чату; екран
налаштувань (провайдер/ключ/модель/перевірка/demo); повідомлення про недійсний ключ, квоту,
кредити, таймаут, несумісну модель, недоступність і скасування; перемикання провайдера без
втрати незавершеної команди; голосовий ввід (запис/зупинка, перегляд транскрипції, вставка,
відмова доступу мікрофона, відсутність підтримки браузера).

### 1.5 Незавершені пункти (свідомо залишені)

1. **Підключення серверної функції AI** та зберігання API-ключів у захищеному сховищі — етап 2.
2. **Inline-підсвітка помилок у формах**: зараз помилки показуються тостом після спроби збереження (валідація вже в шарі дій); підсвітка конкретних полів — покращення UX, не блокер.
3. **Транскрипція голосу** залежить від Web Speech API браузера; без неї записується лише аудіо, а текст вводиться вручну (UI це явно повідомляє).
4. **Пагінація карток фахівців** не додавалась (список малий, зафільтрований пошуком).
5. `hooks/useLocalStorage.ts` залишився невикористаним (не видаляв, щоб не розширювати диф).
6. Наявні 10 попереджень ESLint у файлах, які я не переписував (`layout`, `charts`, `forms`, `Sidebar <img>`) — свідомо **не** масово виправлялись.

---

## 2. Контракти

### 2.1 Сховище — `lib/datasource/types.ts`

```ts
interface CrmDataSource {
  readonly kind: 'local' | 'remote';
  load(): Promise<{ data: DataSnapshot; issues: StorageIssue[] }>;
  saveCollection(key: CollectionKey, value: unknown[]): Promise<WriteOutcome>;
  saveSettings(settings: FinanceSettings): Promise<WriteOutcome>;
  saveMeta(patch: Partial<BackupInfo>): Promise<WriteOutcome>;
  saveBackupCopy(serialized: string): Promise<WriteOutcome>;
  listIssues(): StorageIssue[];
  clearIssues(): void;
}
type CollectionKey = 'projectsActive' | 'projectsCompleted' | 'clients' | 'specialists'
                   | 'partners' | 'transactions' | 'personalDebts' | 'savings';
type WriteOutcome = { ok: true } | { ok: false; issue: StorageIssue };
```

**Гарантії локального адаптера (і їх межі):**
- `load()` не кидає виняток на непридатному JSON: сирий вміст ізольовується в `crm_corrupt_<key>`, фіксується issue.
- `saveCollection` **НЕ атомарний** щодо інших колекцій; окремий запис може впасти після успішних попередніх.
- **Не гарантується локально**: атомарність, ідемпотентність, захист від паралельних змін (дві вкладки), TTL/версіонування рядків. Це фіналізує **етап 2 на сервері**.

**Життєвий цикл сторінки:** `idle → loading → (ready | error)`; дані стають доступними лише після `initStore()` → `migrate()` → `reloadStore()`.

### 2.2 Бізнес-операції — `lib/actions.ts`

```ts
type ActionResult<T = void> = { ok: true; value?: T } | { ok: false; errors: { field: string; message: string }[] };
```

| Група | Функції |
|---|---|
| Клієнти | `createClient`, `updateClient`, `deleteClient`, `toggleClientRegular`, `resolveClient` |
| Проєкти | `saveProject(input, editId?)`, `completeProject`, `deleteProject`, `resolveDeadlineTracking` |
| Транзакції | `saveTransaction(input, editId?)`, `deleteTransaction`, `convertCurrency` |
| Фахівці/партнери | `saveSpecialist`, `deleteSpecialist`, `savePartner`, `deletePartner` |
| Борги/відкладення | `saveDebt`, `deleteDebt`, `saveSaving`, `deleteSaving` |
| Налаштування | `saveRates` (зберігає `displayCurrency`), `setDisplayCurrency` |
| Валідація | `validateProjectInput`, `validateTransactionInput`, `validateDebtInput`, `validateSavingInput`, `validatePartnerInput`, `validateClientInput` |

Однакові перевірки використовуються формами сторінок і (надалі) AI.

### 2.3 Запис, версія, повний експорт — `lib/export.ts`, `types/index.ts`

```ts
EXPORT_FORMAT_ID   = 'WebAgency CRM'
EXPORT_SCHEMA_VERSION = 2          // старі файли мали version: 1
```

`buildExportPayload(snapshot, { includeMeta, exportedAt })` повертає:
`app`, `version`, `exportedAt`, `data` (усі 8 колекцій **повністю**, незалежно від пагінації/фільтрів),
`financeSettings`, `meta` (lastSavedAt / lastManualBackupAt / backupSnoozedUntil).
**Секрети виключаються** глибоким `stripSecrets()` (`apiKey`, `secret`, `token`, `password`,
`authorization`, `credential`, `private_key` — за назвою поля, на будь-якій вкладеності).

**Прийом файлів** (`lib/validate-backup.ts`):
- `version > 2` → відмова («Оновіть CRM»);
- `version 1/2` з `data` → основний формат;
- `legacy-flat` (усі 8 колекцій на верхньому рівні, без `app`) → **явно визначений** старий формат, попередження у перегляді;
- усе інше → «Невідомий формат файлу», жодного запису;
- обов'язкові масиви: відсутність/не-масив → блокуюча помилка;
- окремий запис без `id`, з невалідним типом/сумою/датою → **пропускається** з явною помилкою у перегляді;
- биті зв'язки (проєкт → неіснуючий клієнт) → зв'язок очищується, попередження; клієнт відновлюється з назви після міграції.

### 2.4 AI-транспорт — `lib/assistant/contract.ts`

```ts
interface AssistantTransport {
  readonly id: 'not-connected' | 'demo';
  send(req, signal?): Promise<AssistantReply>;
  clarify(req, signal?): Promise<AssistantReply>;
  confirm(req, signal?): Promise<AssistantConfirmResult>;
  cancel(requestId): void;
}
type AssistantReply =
  | { kind: 'text'; text } | { kind: 'draft'; draft: AssistantDraft }
  | { kind: 'clarify'; text; questions } | { kind: 'error'; error: AssistantError };
type AssistantConfirmResult =
  | { kind: 'applied'; domain; recordId; route?; summary }
  | { kind: 'demo'; domain; summary }          // жодного запису
  | { kind: 'error'; error };
type AssistantErrorCode =
  'not_connected' | 'invalid_key' | 'quota_exceeded' | 'insufficient_credits'
  | 'timeout' | 'model_incompatible' | 'unavailable' | 'cancelled'
  | 'invalid_response' | 'demo_only';
```

Чернетка: `AssistantDraft { id, domain, action, title, fields[], changes[], questions[], amount?, recordId?, route? }`.
Домени: `finance, projects, payments, clients, specialists, partners, debts, savings, settings, reports`.

**Ключі:** `ProviderSettings { provider, model, baseUrl?, demo }` — зберігається в `crm_assistant_provider`.
`ProviderKeyInput` передається **лише в пам'яті**; `checkKeyFormat()` — локальна перевірка формату
з фіктивним значенням (`persisted: false` завжди). Ніякого запису ключа в
`localStorage`/`sessionStorage`/URL/логи/backup **немає** (перевірено тестом і в браузері).

### 2.5 Голос — `lib/assistant/contract.ts` + `hooks/useVoiceInput.ts`

```ts
type VoiceStatus = 'idle' | 'unsupported' | 'requesting' | 'recording'
                 | 'processing' | 'ready' | 'denied' | 'error';
interface VoiceState { status; transcript; audioUrl?; message? }
```

`getUserMedia` + `MediaRecorder` (аудіо-попередній перегляд) + Web Speech API
(перегляд транскрипції, якщо браузер підтримує). Відмова доступу → `denied`,
відсутність підтримки → `unsupported`; обидва випадки мають явне повідомлення.

---

## 3. Mock / demo і непідключені функції (явно)

**Не підключено на етапі 1:**
- реальний AI-провайдер і серверні функції (типова реалізація транспорту — `not-connected`, UI показує «Помічник ще не підключений»);
- збереження API-ключів (до захищеного серверного сховища етапу 2 — взагалі не зберігаються);
- реальна база даних, таблиці, RLS, SQL-міграції на сервері;
- хостинг/деплой/CI.

**Mock/demo, що існують свідомо:**
- `createDemoTransport()` — вмикається **лише** явним прапорцем «Demo-режим» у налаштуваннях.
  Повертає ілюстрацію чернетки/уточнення; `confirm()` → `{kind:'demo'}` із формулюванням
  «жодного запису не створено». **Ніколи** не пише в сховище (тест + перевірка в браузері).
  Виробничий UI ніде не повідомляє «створено», якщо запису немає.
- Синтетичні дані у тестах (`tests/helpers.ts`) — жодних реальних даних користувача.

**Тести:** `npm test` → 39 тестів, зокрема:
сторонній/битий JSON не змінює дані · збій імпорту не вимикає резервування ·
відновлення/явний стан помилки · курси не скидають валюту · hidden узгоджений ·
пагінація не обрізає підсумки й експорт · статистика оновлюється після зміни даних ·
demo не створює записів · секрети не потрапляють у сховище чи backup · міграції один раз ·
облікова дата Europe/Kyiv · пошкоджений JSON кварантується.

---

## 4. Відомі обмеження та рішення для етапу 2

### 4.1 Обмеження, які **не можна** лишити на виробництві
1. **localStorage не має транзакцій** — імпорт НЕ атомарний. Реальна атомарність, ідемпотентність (`PUT` за `id`), захист від паралельних змін (версія рядка/ETag) — **етап 2, сервер**.
2. **Дві вкладки** можуть перезаписати одна одну (останній запис перемагає). Потрібен серверний синхронізатор.
3. **Пошкоджений ключ**: розрахунки бачать порожній список, поки користувач не відновить імпортом. Це **не** мовчазна підміна (є issue, кварантина, індикатор), але дії користувача на цій колекції можуть «підтвердити» порожній стан — на етапі 2 варто блокувати запис у колекцію з активним `corrupt_json`.
4. **Важка копія** при закритті вкладки — best-effort: якщо браузер убив вкладку, залишається `crm_backup_pending`, і копія робиться при наступному старті.
5. **Ключі AI** не зберігаються ніяк — це свідомо до етапу 2 (потрібен серверний secret store).

### 4.2 Спірні формули/розбіжності — **не змінював**, потребують згоди на етапі 2
| Місце | Що так як є | Коментар |
|---|---|---|
| `dashboardStats.totalBudget` | рахується **лише по завершених** проєктах | «Загальний бюджет» на дашборді — історичний оборот; `clientDebts`/`specialistDebts` рахуються по **всіх** |
| `project().specialistCost` | `budgetAfterDeductions - projectProfit` | тобто фахівцю «дістається» все, що не мій відсоток; не переглядав |
| `project().receivedProfit` / `paidAmount` | використовуються лише в графіку «Закрито замовлень» | `paidAmount = min(budget, max(prepayment,0))` |
| `monthIncome` vs `Доходи/витрати` | обидва виключають `hidden` і `source: project_*`, але різні набори місяців | узгоджено щодо `hidden`; самі правила — як були |
| Курсова історія | `rateForCurrency` — один поточний курс, історичних курсів немає | зафіксовано, не змінював |
| Облік платежів | `incomeStatus: earned | incoming`, транзакції `project_*` не входять у дохід | зафіксовано, не змінював |
| Конвертація | transfer: `amount` списується у валюті джерела, `targetAmount` — у валюті призначення | зафіксовано |

### 4.3 Що етап 2 має реалізувати поверх цього
- Реальний `CrmDataSource` (`kind: 'remote'`): ті самі сигнатури, додати транзакції/версії/ідемпотентність.
- Міграції даних на сервері (локальні `crm_migrated_*` — тимчасові).
- AI-ендпоінт, що реалізує `AssistantTransport`; секрети — у серверному `process.env` (див. `.env.example`: `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `AI_BASE_URL`, `AI_TIMEOUT_MS` — **лише назви/пояснення**, значень немає).
- Захист від паралельних змін і блокування колекцій зі статусом `corrupt_json`.
- Браузерне приймання (service worker), security-оновлення, реальні API, хостинг.

---

## 5. Структура змін

**Нові файли:** `lib/dates.ts`, `lib/settings.ts`, `lib/validate.ts`, `lib/validate-backup.ts`,
`lib/importer.ts`, `lib/export.ts`, `lib/backup.ts`, `lib/store.ts`, `lib/actions.ts`,
`lib/migration-flags.ts`, `lib/toast-bus.ts`, `lib/datasource/{types,local}.ts`,
`lib/assistant/{contract,transport,prefs}.ts`, `hooks/{useUiState,useVoiceInput}.ts`,
`app/assistant/page.tsx`, `components/assistant/{ChatPanel,ProviderSettingsCard}.tsx`,
`tests/*` (10 файлів), `scripts/{run-tests.mjs,test-env.cjs,test-alias.cjs}`,
`tsconfig.test.json`, `.env.example`, `HANDOFF-STAGE-1.md`.

**Переписано/істово змінено:** `lib/storage.ts` (фасад), `lib/calc.ts` (snapshot+індекси),
`lib/migrations.ts` (версійність), `lib/utils.ts` (Kyiv+кеш), `context/AppContext.tsx`
(стан ініціалізації), усі 9 сторінок, `components/ToastProvider.tsx`, `ClientForm`,
`Sidebar`, `TabBar`, `types/index.ts`, `app/globals.css` (лише доповнення).

**Пакети не оновлювались** — зміни лише у `scripts` (`test`), `.gitignore` (`.test-dist/`).

---

## 6. Підтвердження

- ❌ **Деплой не виконувався** (жодних `vercel`/`fly`/`gh-pages`, конфіг хостингу не чіпав).
- ❌ **Реальні сервіси не підключалися**: жодних API-викликів до AI-провайдерів, БД, хмарних сховищ; жодних акаунтів/ключів створено.
- ❌ **`.env.local` не читався і не комітився**; у репозиторії немає відстежуваних env-файлів (`git ls-files | grep env` → порожньо), `.env.local` у `.gitignore`.
- ❌ **Дані користувача не змінювались**: усі перевірки виконувались у окремому браузерному профілі з **синтетичними** записами; робочий профіль браузера не відкривався.
- ✅ Дизайн, графіки та спосіб внесення записів збережені: компоненти карток/таблиць/графіків/форм не перероблялись, змінювалась лише логіка даних і нові класи AI-сторінки.
- ✅ Стара лідогенерація не відновлювалась (Google-пошук/Chromium/сканування сайтів/старий AI-модуль відсутні; міграція `v19` лише видаляє їхні ключі).
