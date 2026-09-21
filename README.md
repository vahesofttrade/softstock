# SoftStock — на Supabase + Netlify

Это переработанная core-версия SoftStock: Dashboard, Stock Entry, Stock Levels,
History, Forecast, Orders, Deliveries, плюс Products/Suppliers для управления
справочниками. Вместо Google Sheets + Apps Script — база Postgres в Supabase,
вместо веб-приложения Apps Script — статический сайт на Netlify.

Никакого отдельного backend-сервера не нужен: браузер обращается к Supabase
прямо через `supabase-js`, а безопасность обеспечивают политики Row Level
Security (RLS) в базе — они уже описаны в `supabase/schema.sql`.

## 1. Создать проект Supabase

1. Зайдите на https://supabase.com → **New project**.
2. Придумайте пароль для базы (сохраните его — он для прямого доступа к Postgres,
   в самом приложении он не используется).
3. Дождитесь, пока проект поднимется (1–2 минуты).

## 2. Применить схему базы

1. В панели проекта откройте **SQL Editor → New query**.
2. Скопируйте содержимое `supabase/schema.sql` целиком и нажмите **Run**.
   Это создаст таблицы `profiles`, `products`, `stock_log`, `suppliers`,
   `deliveries`, триггеры и политики RLS.

## 3. Включить вход по email/паролю

1. **Authentication → Providers → Email** — убедитесь, что включено (по
   умолчанию включено).
2. Если не хотите, чтобы пользователи подтверждали email перед входом (удобно
   для внутреннего инструмента на несколько человек): **Authentication →
   Settings → Email → отключите "Confirm email"**.

## 4. Получить ключи проекта

**Project Settings → API**:
- `Project URL` → это `SUPABASE_URL`
- `anon public` key → это `SUPABASE_ANON_KEY`

Откройте `public/config.js` и вставьте оба значения:

```js
const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

`anon` ключ можно спокойно публиковать в открытом фронтенде — он не даёт
прямого доступа к данным, всё ограничивается через RLS-политики из schema.sql.

## 5. Проверить локально (необязательно)

Откройте `public/index.html` любым локальным веб-сервером, например:

```bash
cd public && npx serve .
```

(Открывать `index.html` напрямую через `file://` не будет работать — браузер
блокирует некоторые запросы. Нужен http-сервер, хоть локальный.)

## 6. Первый вход и назначение администратора

1. На сайте нажмите **«Зарегистрироваться»**, создайте аккаунт (имя, email,
   пароль).
2. По умолчанию новый пользователь получает роль `user` (может всё, кроме
   удаления товаров/поставщиков). Чтобы сделать его администратором —
   в Supabase **SQL Editor** выполните:

   ```sql
   update profiles set role = 'admin'
   where id = (select id from auth.users where email = 'you@example.com');
   ```

3. Роли: `admin` — полный доступ, включая удаление; `user` — добавляет
   приход/расход, товары, поставки; `restricted` — только просмотр (задаётся
   тоже через SQL, поле `role` в таблице `profiles`).

## 7. Деплой на Netlify

**Вариант A — через Git (обязателен, если нужен AI-сканер накладных):**
1. Залейте всю эту папку (включая `netlify/functions/`, не только `public/`) в репозиторий на GitHub/GitLab.
2. На https://app.netlify.com → **Add new site → Import an existing project**.
3. Выберите репозиторий. Netlify сам подхватит `netlify.toml`
   (`publish = "public"`, функции из `netlify/functions/`, без команды сборки).
4. Deploy.

**Вариант B — быстрый, без Git (но без сканера накладных):**
1. На https://app.netlify.com → **Add new site → Deploy manually**.
2. Перетащите папку `public/` в окно загрузки.
3. Готово — сайт сразу доступен по адресу вида `random-name.netlify.app`.

⚠️ При Варианте B (drag-and-drop одной папки `public/`) серверная функция
`netlify/functions/scan-invoice.js` не публикуется — Invoice Scanner работать
не будет (кнопка Scan вернёт ошибку сети). Если сканер нужен — используйте
Вариант A (Git) или деплой через `netlify deploy --prod` из корня проекта
(Netlify CLI: `npm install -g netlify-cli`, затем `netlify deploy --prod` в
папке проекта — CLI подхватит и `public/`, и `netlify/functions/`).

После любого изменения `public/config.js` (например, при смене проекта
Supabase) нужно передеплоить сайт.

## 8. Настройка AI-сканера накладных (опционально)

Сканер работает через отдельную серверную функцию Netlify — она держит ваш
ключ Anthropic API на сервере и никогда не отдаёт его в браузер.

1. Получите API-ключ на https://console.anthropic.com (Account → API Keys).
2. В Netlify: **Site configuration → Environment variables → Add a variable**.
   - Key: `ANTHROPIC_API_KEY`
   - Value: ваш ключ (начинается на `sk-ant-...`)
   - Scopes: оставьте по умолчанию (все контексты сборки).
3. Передеплойте сайт (**Deploys → Trigger deploy → Deploy site**), чтобы
   функция подхватила переменную окружения.
4. Готово — страницы **Scanner** и кнопка **«📷 Scan document»** в
   Reservations теперь смогут распознавать накладные.

Без этого ключа сканер просто покажет понятную ошибку — остальное
приложение продолжит работать как обычно.

## Структура проекта

```
supabase/schema.sql   — таблицы, триггеры, RLS-политики (выполнить один раз)
netlify.toml          — конфигурация деплоя (publish dir = public/)
public/index.html     — разметка приложения
public/style.css      — стили
public/app.js         — вся логика (auth, CRUD, рендеринг)
public/config.js      — SUPABASE_URL и SUPABASE_ANON_KEY (заполнить)
```

## Как считаются метрики

- **Остаток товара** (`products.balance`) обновляется автоматически триггером
  при каждой записи в `stock_log`: `add` → +qty, `deduct` → −qty,
  `update` → устанавливает как есть.
- **Расход/день** (Forecast, Dashboard) — сумма операций `deduct` за последние
  30 дней ÷ 30, по товару.
- **MTD usage** (Dashboard) — сумма `deduct` с 1 числа текущего месяца.
- **Заказать** (Orders) — `цель_в_месяцах × расход/мес − остаток − ожидаемые
  поставки`, не меньше 0. Цель в месяцах задаётся на карточке товара
  (`target_months`, по умолчанию 2).

## Что не перенесено (можно добавить позже)

Costing/CostCalc, Production (учёт смен на линиях), Machines/EquipPark,
Substitute Groups, Scanner, PDF-экспорт заказов, много­язычность интерфейса.
Структура (Supabase-таблицы + отдельные "панели" в `app.js`) сделана так,
чтобы эти модули можно было добавлять по одному, без переписывания core.

## Известный баг из старой версии, который тут уже не воспроизводится

В Google Apps Script-версии автосписание сырья при логировании производства
переводило кг→метры только для Spunlace; для Facial Tissue и остальных
рулонных типов килограммы записывались в лог как метры без пересчёта. В этой
версии модуль производства (auto-deduct) не перенесён вообще — весь расход
вводится вручную на **Stock Entry** в метрах, поэтому такой путаницы единиц
измерения здесь не может возникнуть. Если будете переносить производственный
модуль позже — конвертацию кг→м нужно реализовать явно для каждого типа с
учётом ширины, gsm и ply (мы разбирали правильную формулу в предыдущем
обсуждении).
