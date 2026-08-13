# ai-mode — Construction Plan

Framework/библиотека «режимов ИИ» поверх **Vercel AI SDK** (пакет `ai`, v7).
Каждый режим — композируемый воркфлоу с единым контрактом `run()` / `stream()`.

## Objective

Построить TypeScript-библиотеку, которая даёт разработчикам готовые **режимы работы LLM**
(step-by-step, deep-research, routing, voting/ensemble) поверх Vercel AI SDK.
Ядро — тонкий слой: `Mode`-интерфейс, `ModeContext`, реестр, нормализованные события стрима.
Режимы — отдельные файлы, каждый может быть сделан/продан отдельным PR.

## Non-goals (что НЕ делаем)

- Не форкаем и не заменяем AI SDK — только надстройка (peer dependency).
- Не пишем собственные провайдеры — модели передаёт пользователь (объекты из `ai`).
- Не делаем UI/React-компоненты в этой версии (только headless API).
- Не вводим dependency на `langchain`/`openai` напрямую — только `ai` + `zod`.

## Stack / decisions

| Решение | Выбор |
|---|---|
| Runtime | Bun (bun test, bun run) |
| Язык | TypeScript, ESM, strict |
| Нижний слой | `ai` (Vercel AI SDK **v7**, актуально 7.0.x): `generateText`, `streamText`, `tool`, `Output.object`, `ai/test` (MockLanguageModelV4, simulateReadableStream) |
| Валидация схем | `zod` (direct dependency) |
| Стриминг | Каждый режим умеет `stream()` (AsyncIterable `ModeEvent`) и `run()` (готовый результат). Одно реализуем, второе выводим хелпером `fromRun`/`fromStream` |
| Сборка | `bun build` (dist) + `tsconfig.build.json` для `.d.ts` (шаг 8) |
| CI | GitHub Actions: checkout → `oven-sh/setup-bun@v2` → `bun install && bun run typecheck && bun test && bun run build`. push триггер только на `main` |

> **AI SDK v7 примечания (проверено по `ai@7.0.64`):**
> - `generateObject` **deprecated** — структурированный вывод делаем через `generateText({ output: Output.object({ schema }) })` → `result.output`.
> - Тип юзажа — **`LanguageModelUsage`** (не `TokenUsage`): `{ inputTokens?, outputTokens?, totalTokens? }` c вложенными details. Наш `TokenUsage = Pick<...>` — см. шаг 2.
> - Моки — **`MockLanguageModelV4`** (не V2/V3): `doGenerate` возвращает `content: [{type:'text',text}]`, `finishReason: { unified, raw }`, вложенный usage; `doStream` возвращает `{ stream: simulateReadableStream({chunks:[text-start, text-delta, text-end, finish]}) }`.

## Итоговая структура

```
src/
  core/
    types.ts        # Mode, ModeContext, ModeEvent, ModeResult
    errors.ts       # AIModeError, ModeNotFoundError, StepExecutionError
    helpers.ts      # fromRun, fromStream (приводят stream<->run)
    registry.ts     # ModeRegistry: register/get/list
    context.ts      # createModeContext — дефолтный ModeContext из config
  modes/
    stepByStep.ts
    deepResearch.ts
    routing.ts
    ensemble.ts
    index.ts        # registerAllModes(registry) — явный список MODES (import.meta.glob не работает в рантайме Bun)
  index.ts          # createAI(config), export типов
examples/
  basic.ts          # все 4 режима, без API-ключей не работает — пример кода
test/               # тесты рядом с реализацией (bun test)
```

## Ключевые контракты (зафиксировать в шаге 2)

```ts
// core/types.ts
type ModeID = string

interface ModeContext {
  models: Record<string, LanguageModel>   // 'default' обязателен
  search?: SearchProvider                 // для deep-research
  logger?: (evt: ModeEvent) => void
  signal?: AbortSignal
  tokenBudget?: number
}

interface Mode<Input = unknown, Output = unknown> {
  id: ModeID
  description: string
  run(input: Input, ctx: ModeContext): Promise<ModeResult<Output>>
  stream(input: Input, ctx: ModeContext): AsyncIterable<ModeEvent>
}

type ModeEvent =
  | { type: 'start'; mode: ModeID; input: unknown }
  | { type: 'plan'; steps: unknown }
  | { type: 'step'; index: number; title: string; status: 'running' | 'done' | 'failed'; output?: unknown }
  | { type: 'tool'; tool: string; input: unknown; output?: unknown }
  | { type: 'text-delta'; delta: string }
  | { type: 'result'; output: unknown; usage?: TokenUsage }
  | { type: 'error'; error: Error }

interface ModeResult<O> { output: O; usage: TokenUsage; mode: ModeID }

// TokenUsage = плоский сабсет из LanguageModelUsage (ai v7) — поля number|undefined
// aggregateUsage должен корректно суммировать с undefined (см. addLanguageModelUsage в ai)
type TokenUsage = Pick<LanguageModelUsage, 'inputTokens' | 'outputTokens' | 'totalTokens'>

// Хелперы приведения run<->stream. Контракт фиксируется в шаге 2.
interface ModeImpl<Input, Output> {
  run(input: Input, ctx: ModeContext, emit: (evt: ModeEvent) => void): Promise<ModeResult<Output>>
}
function fromRun<Input, Output>(impl: ModeImpl<Input, Output>): Mode<Input, Output>
function fromStream<Input, Output>(stream: (input: Input, ctx: ModeContext) => AsyncIterable<ModeEvent>): Mode<Input, Output>
// fromRun: stream() эмитит start, проксирует emit-события, в конце result. Отмена → error (AbortModeError).
// fromStream: run() потребляет stream() до result-события; преждевременный конец без result → AIModeError.
// Правило: run() бросает AbortModeError при abort; stream() эмитит {type:'error', error}.
```

**Инварианты (проверять после каждого шага):**
- `bun run typecheck` — 0 ошибок
- `bun test` — все тесты зелёные
- В `src/core` нет `any`
- Каждый режим реализует и `run`, и `stream` (хотя бы один настоящий + хелпер)
- Нет прямых импортов `openai`/`anthropic` в core и modes — только типы/функции `ai`

## Workflow git/PR (доступен: git + gh, репо CMAULTOP/ai-mode, main пустой)

- Шаг 1: первый коммит + push main.
- Шаги 2+: ветка `step/N-<slug>` → PR → merge после зелёного CI.
- Откат любого шага: `git revert -m 1 <merge-commit>` (для merge-коммита нужен `-m 1`; регрессия не выходит за один PR).

## Зависимости шагов

```
1 (scaffold+CI)
   └─► 2 (core: types+errors+helpers+registry+context)
          └─► 3 (public API: createAI + registerAllModes, empty registry)
                 ├─► 4 (step-by-step)        ← эталонный режим, определяет паттерн
                 │      └─► 5,6,7 в параллель после (все зависят от 3 и паттерна 4)
                 │            ├─► 5 (routing)
                 │            ├─► 6 (ensemble)
                 │            └─► 7 (deep-research)
                 └─► 8 (docs+examples+examples+CI publish) — после всех
```

Параллельные: 5, 6, 7. Чтобы параллельные PR не конфликтовали в общем файле `modes/index.ts`, используем **автообнаружение режимов** через `import.meta.glob` (см. шаг 3) — `modes/index.ts` не трогается при добавлении режима, конфликтов нет. Каждый из 5/6/7 зависит от влитого шага 4 (эталонный паттерн).

---

## Step 1 — Scaffold + CI

**Контекст:** проект-пустышка (bun init, `index.ts` c `console.log`, tsconfig strict, git без коммитов, репо `CMAULTOP/ai-mode`).

**Задачи:**
- `bun add ai` (v7) и `bun add zod` — проверить актуальную версию (`bun add ai@latest`). zod — direct dependency (нужен для схем `Output.object`).
- `package.json`: `name: "ai-mode"`, `type: module`, удалить мусорные `"module": "index.ts"` и `peerDependencies` (корневой `index.ts` удаляется). Скрипты `typecheck` (`tsc --noEmit`), `test` (`bun test`), `build` (`bun build ./src/index.ts --outdir dist --target=bun`).
- Заменить `index.ts` на заготовку `src/`-структуры (core/modes пустые, `src/index.ts` экспортирует `createAI`-заглушку — см. шаг 3, здесь только сигнатуру).
- Перенести `tsconfig.json` на строгий ESM-конфиг (already ok) + исключить `dist`, `node_modules`.
- `.github/workflows/ci.yml`:
  ```yaml
  on:
    push: { branches: [main] }
    pull_request:
  jobs:
    ci:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: oven-sh/setup-bun@v2
        - run: bun install
        - run: bun run typecheck
        - run: bun test
        - run: bun run build
  ```
  (push-триггер только на `main`, чтобы PR-бранчи не гоняли CI дважды.)
- Удалить мусорный `index.ts` на корне.

**Верификация:**
```bash
bun install
bun run typecheck
bun test          # 1 smoke-тест
bun run build
```

**Exit criteria:** CI зелёный на первом PR (bun установлен через setup-bun); `ai` + `zod` в deps; `src/` структура создана.

**Model tier:** default.

**Rollback:** сбросить к пустому bun init (`git clean`, удалить ветку).

---

## Step 2 — Core: типы, ошибки, хелперы, реестр, контекст

**Контекст:** файл `src/core/types.ts` — самый важный файл проекта. От него зависит вся библиотека, поэтому сигнатуры из раздела «Ключевые контракты» фиксируются здесь. AI SDK v7: `LanguageModel` и `LanguageModelUsage` экспортируются из `ai`. **`TokenUsage` в v7 не существует** — наш `TokenUsage = Pick<LanguageModelUsage, 'inputTokens'|'outputTokens'|'totalTokens'>` (поля `number | undefined`). Суммирование undefined-safe (по образцу `addLanguageModelUsage` из `ai`).

**Задачи:**
- `types.ts`: `ModeID`, `ModeContext`, `Mode<Input,Output>`, `ModeEvent` (union, `error` несёт `Error`, а не строку), `ModeResult<O>`, `TokenUsage` (Pick из `LanguageModelUsage`), `SearchProvider` (`search(query, opts) => Promise<SearchResult[]>`).
- `errors.ts`: `AIModeError` (base), `ModeNotFoundError`, `StepExecutionError`, `AbortModeError`. Каждый с `.code`.
- `helpers.ts`:
  - `ModeImpl<Input, Output>` — контракт «run + emit»: `run(input, ctx, emit) => Promise<ModeResult<Output>>`.
  - `fromRun(impl)`: создаёт `Mode`, где `run()` = `impl.run(input, ctx, noop)`; `stream()` = эмитит `start` → проксирует `emit`-события из `impl.run` → в конце `result`. Abort → `error` event / throw `AbortModeError`. **Именно здесь снимается дилемма ensemble:** режим пишется один раз через `emit` и получает оба метода без потери событий.
  - `fromStream({ stream })`: создаёт `Mode`, где `stream()` = как есть; `run()` = потребляет `stream()` до терминального `result` (ошибки пробрасываются; преждевременный конец без `result` → `AIModeError`).
  - `aggregateUsage(usages: TokenUsage[])` — undefined-safe суммирование токенов.
  - `emitLogger(logger, evt)` — безопасная обёртка (logger никогда не бросает).
- `registry.ts`: `ModeRegistry` — `register(mode)`, `get(id)`, `list()`, `has(id)`; бросает `ModeNotFoundError` для неизвестного id.
- `context.ts`: `createModeContext(config)` — нормализует `{ models, search, logger, signal, tokenBudget }`; если нет `models.default` — ошибка конфигурации. Внутри хелпер `call({ params, ctx })`-фабрики не нужно — каждый режим сам передаёт `abortSignal: ctx.signal` в вызовы AI SDK; `tokenBudget` проверяется в общей точке `aggregateUsage` (после каждого вызова, если бюджет задан и превышен → `AbortModeError`).
- Тесты: `test/core/*.test.ts` — helpers (fromStream собирает result, fromRun эмитит start/emit-события/result, aggregateUsage с undefined), registry (register/get/unknown→error), abort (сигнал → AbortModeError), типы.

**Верификация:**
```bash
bun run typecheck
bun test
```

**Exit criteria:** core полностью типизирован без `any`; хелперы покрыты тестами; контракты зафиксированы.

**Model tier:** strongest (интерфейсное решение).

**Rollback:** `git revert` шага.

---

## Step 3 — Публичный API: createAI + регистрация

**Контекст:** core готов. Нужна точка входа для пользователя и каркас регистрации режимов. AI SDK v7: `LanguageModel` тип из `ai`; `GenerateTextResult`/`StreamTextResult` имеют `usage`, `text`, `textStream`, `toolResults`.

**Задачи:**
- `src/index.ts`:
  ```ts
  export interface CreateAIConfig {
    models: Record<string, LanguageModel>   // обязательно 'default'
    search?: SearchProvider
    logger?: (evt: ModeEvent) => void
    signal?: AbortSignal
    tokenBudget?: number
    modes?: Mode[]                          // дополнительные пользовательские
  }
  export function createAI(config: CreateAIConfig): AI
  ```
  `AI` = `{ run(id, input), stream(id, input): AsyncIterable<ModeEvent>, list(): ModeDescriptor[], mode(id): ModeHandle }`, где `ModeHandle` = `{ run(input), stream(input) }`.
- Внутри: `ModeRegistry` + `registerAllModes` (из `modes/index.ts`) + регистрация пользовательских `modes`.
- **Регистрация режимов** (снимает конфликты параллельных PR 5/6/7): `modes/index.ts` хранит явный массив `MODES: Mode[]`, в который добавляется каждый новый режим:
  ```ts
  import { stepByStep } from "./stepByStep.ts"
  const MODES: Mode[] = [stepByStep]
  export function registerAllModes(registry: ModeRegistry) {
    for (const mode of MODES) registry.register(mode)
  }
  ```
  > `import.meta.glob` НЕ используется: в рантайме Bun (не в бандлере) он не реализован (oven-sh/bun#6060). Явный список проще и надёжнее; конфликты параллельных PR решаются тривиально — одна строка на режим.
- Убедиться: `run` передаёт `input` в режим и возвращает `ModeResult`; `stream` проксирует события; `signal`/`tokenBudget` пробрасываются в `ModeContext`.
- Тест: `createAI` с фейковым режимом (без реальной модели) — run/stream/list работают; `run('unknown')` → `ModeNotFoundError`; автообнаружение подхватывает файл режима без правки index.

**Верификация:**
```bash
bun run typecheck
bun test
```

**Exit criteria:** `createAI` работает end-to-end с пользовательским режимом; контракт `AI` стабилен.

**Model tier:** strongest.

**Rollback:** `git revert` шага.

---

## Step 4 — Режим step-by-step (эталонный паттерн)

**Контекст:** паттерн для всех остальных режимов. AI SDK v7: структурированный вывод — `generateText({ output: Output.object({ schema }) })` → `result.output` (**`generateObject` deprecated**); `streamText` для шагов. Опираемся на `ai/test` — `MockLanguageModelV4` (doGenerate/doStream) и `simulateReadableStream` для детерминированных тестов.

**Задачи:**
- `src/modes/stepByStep.ts`:
  - input: `{ task: string; steps?: number; maxSteps?: number; stopOnFailure?: boolean; promptPerStep?: string }`
  - **Фаза план**: `generateText({ model, output: Output.object({ schema: planSchema }), prompt })` → `result.output` — массив шагов `{ title, description }`.
  - **Фаза execute**: для каждого шага `streamText` (или generateText) с контекстом предыдущих результатов; emit `step` events.
  - **Фаза synthesize** (опц.): финальный `generateText` собирает ответ из результатов шагов.
  - Реализация через `stream()` (нативный) + `fromStream` для `run()`. Все вызовы AI SDK получают `abortSignal: ctx.signal`.
  - Ошибки шага: `StepExecutionError` (если `stopOnFailure`) или эмит `step failed` и продолжение.
- Регистрация: просто положить `stepByStep.ts` в `src/modes/` (автообнаружение из шага 3), экспортировать `Mode`.
- Тесты (`test/modes/stepByStep.test.ts`): мок `MockLanguageModelV4` отдаёт план (JSON) и текст шагов; проверить — план распарсен, шаги выполнены по порядку, `result.output` собран, `usage` суммирован, события `plan`/`step` эмитятся. Тест на `stopOnFailure`. Для стрим-части — `simulateReadableStream`.

**Верификация:**
```bash
bun run typecheck
bun test
```

**Exit criteria:** режим работает с мок-моделью; паттерн (stream-нативный + fromStream + zod-план) зафиксирован; используется в следующих шагах.

**Model tier:** default.

**Rollback:** `git revert` шага.

---

## Step 5 — Режим routing (совет моделей)

**Контекст:** паттерн «выбор модели под задачу». Использует контракты шагов 2–3 и паттерн шага 4. Пользователь даёт каталог моделей с описаниями, режим выбирает лучшую и выполняет задачу ей.

**Задачи:**
- `src/modes/routing.ts`:
  - input: `{ task: string; catalog: { id: string; model: LanguageModel; description: string; capabilities?: string[]; cost?: number; speed?: number }[]; strategy?: 'llm' | 'round-robin' | 'priority' }`
  - `strategy: 'llm'` — `generateText({ output: Output.object({ schema }) })` выбирает `{ choice: id, reason }` из описаний каталога.
  - `strategy: 'round-robin'` / `'priority'` — детерминированный выбор (без вызова модели), полезен для тестов.
  - После выбора — выполнить `streamText` выбранной моделью; emit `plan` (choice+reason), затем text-delta. `abortSignal: ctx.signal` на всех вызовах.
  - Ошибки: неизвестный id в ответе → ретрай один раз, иначе `AIModeError`.
- Регистрация: файл `src/modes/routing.ts`, экспорт `Mode` (автообнаружение).
- Тесты: `round-robin` (детерминированный порядок выбора), `llm` с моком (мок возвращает выбор id), выполнение выбранной моделью.

**Верификация:**
```bash
bun run typecheck
bun test
```

**Exit criteria:** routing выбирает модель по всем 3 стратегиям; unknown id обрабатывается.

**Model tier:** default.

**Rollback:** `git revert` шага.

---

## Step 6 — Режим ensemble/voting (совет/голосование моделей)

**Контекст:** параллельный запуск нескольких моделей и выбор лучшего ответа. Реализация через **`fromRun`** (run-нативный, контракт из шага 2): режим пишет только `run(input, ctx, emit)` и через `emit` шлёт прогресс-события (`step` на кандидата, `plan` с выбором судьи) — `fromRun` гарантирует, что `stream()` эти события отдаёт, а `run()` их игнорирует. Для параллельности — `Promise.all` (или `Promise.allSettled` с обработкой частичных падений).

**Задачи:**
- `src/modes/ensemble.ts`:
  - input: `{ task: string; models: { id: string; model: LanguageModel; weight?: number }[]; judge?: LanguageModel; method?: 'judge' | 'majority' | 'best-score' }`
  - Фаза 1 (параллельно): каждый кандидат `generateText` по `task`. Частичное падение: если меньше 2 ответов — бросаем; иначе продолжаем с успешными.
  - Фаза 2 (выбор): `judge` — `generateText` с подсказкой выбрать лучший из ответов; `majority` — голосование по id/эмбеддингам не делаем — fallback на первый; `best-score` — по `usage`/весу (детерминированный, для тестов).
  - Внутри `run(input, ctx, emit)`: emit `start`, `step` на каждого кандидата, `plan` с выбором; в конце возвращает `ModeResult`.
  - `abortSignal: ctx.signal` на всех вызовах.
- Регистрация: файл `src/modes/ensemble.ts`, экспорт `Mode` (автообнаружение).
- Тесты: `best-score` детерминирован; `judge` с моком; частичное падение кандидата; `majority`; стрим отдаёт `step`/`plan` события.

**Верификация:**
```bash
bun run typecheck
bun test
```

**Exit criteria:** ensemble параллельно запускает модели и выбирает лучший ответ всеми методами; устойчив к частичным падениям.

**Model tier:** default.

**Rollback:** `git revert` шага.

---

## Step 7 — Режим deep-research (агентный цикл)

**Контекст:** самый сложный режим. Агентный цикл: планирование запросов → поиск → итеративное уточнение → отчёт. Поиск — через `ctx.search` (`SearchProvider`, контракт из шага 2); если его нет — `AIModeError` с понятным сообщением. Для тестов — фейковый `SearchProvider` без сети.

**Задачи:**
- `src/modes/deepResearch.ts`:
  - input: `{ topic: string; iterations?: number; queriesPerIteration?: number; maxSources?: number; style?: 'report' | 'brief' | 'answer' }`
  - Цикл по итерациям (default 2):
    1. `generateText({ output: Output.object({ schema }) })` → список исследовательских запросов `{ queries: string[] }`.
    2. Для каждого запроса — `ctx.search.search(query)` (конкурентно, лимит `maxSources`).
    3. `generateText` → промежуточный синтез «что уже знаем / что пробелы», emit `step`.
  - Финал: `generateText` → отчёт по стилю, со ссылками на источники.
  - Внутренняя структура событий: `start`, `plan` (queries), `tool` (search с результатами), `step` (по итерации), `result`.
  - `signal` из ctx → `abortSignal` в каждый вызов AI SDK; `tokenBudget` проверяется после каждого вызова через `aggregateUsage` (превышение → `AbortModeError`).
  - Реализация через `stream()` (нативный).
- Регистрация: файл `src/modes/deepResearch.ts`, экспорт `Mode` (автообнаружение).
- Тесты: фейковый `SearchProvider`; 1 и 2 итерации; лимит источников; отказ без `search` → понятная ошибка; события `plan`/`tool`/`step`; abort на середине итерации.

**Верификация:**
```bash
bun run typecheck
bun test
```

**Exit criteria:** deep-research выполняет план→поиск→синтез→отчёт с мок-моделью и фейковым поиском.

**Model tier:** default.

**Rollback:** `git revert` шага.

---

## Step 8 — Документация, примеры, публикация

**Контекст:** все режимы готовы и покрыты тестами. Осталось: README, пример, сборка дистрибутива (js + .d.ts), конфиг публикации. CI уже содержит `build` (из шага 1) — он выхватывает только dist, без types, поэтому добавляем отдельную проверку types здесь.

**Задачи:**
- `bun add -d @ai-sdk/openai` — нужен devDependency, чтобы `examples/basic.ts` и README-пример компилировались в `typecheck` (иначе `tsc` падает).
- `README.md`: назначение, отличие от AI SDK (надстройка, а не замена), установка, 4 примера (по режиму), контракт `Mode`, как написать свой режим (через `fromRun`/`fromStream`), лимит/ограничения.
- `examples/basic.ts`: рабочий пример `createAI` с `@ai-sdk/openai` (ключи через env) — все 4 режима.
- `.env.example`: `OPENAI_API_KEY=` (и др. провайдеры), `.gitignore` уже закрывает `.env`.
- `package.json`: `exports` (`./src/index.ts` для dev, `./dist` для npm), `files: ["dist"]`, `peerDependencies: { "ai": "^7" }`, `publishConfig`. Скрипты: `build` (`bun build ./src/index.ts --outdir dist --target=bun`), `build:types` (`tsc -p tsconfig.build.json`).
- `tsconfig.build.json`: `{ "extends": "./tsconfig.json", "compilerOptions": { "noEmit": false, "declaration": true, "emitDeclarationOnly": true, "declarationDir": "dist/types" } }` — отдельный конфиг, т.к. основной имеет `noEmit: true` и `allowImportingTsExtensions`.
- `.github/workflows/ci.yml`: добавить `bun run build:types` в шаги проверки.
- Проверить `bun pack --dry-run` — что попадает в пакет.

**Верификация:**
```bash
bun run typecheck && bun test && bun run build && bun run build:types
bun pack --dry-run
```

**Exit criteria:** README полный; примеры собираются и типизируются; пакет (js + .d.ts) готов к `bun publish` (публикацию не делаем без запроса).

**Model tier:** default.

**Rollback:** `git revert` шага.

---

## Сводка

- Шагов: **8** (1 scaffold → 2 core → 3 API → 4 паттерн → 5,6,7 параллель → 8 docs/publish).
- Параллельность: шаги 5, 6, 7 можно делать параллельно после шага 4 — явный список режимов в `modes/index.ts` (одна строка на режим).
- Проверка после каждого шага: `bun run typecheck` + `bun test` (+ `build`/`build:types` в CI с шага 1).
- Инвариант: ядро без `any`, режимы без прямых импортов провайдеров, все вызовы AI SDK получают `abortSignal: ctx.signal`.

## Mutation protocol

- **Split** (шаг слишком большой) — разрешён, нумеровать `4a/4b`.
- **Insert** (новый режим/примитив) — добавлять в конец, без перенумерации.
- **Reorder** — запрещён для 1→2→3 (жёсткая цепочка), остальное свободно.
- **Abandon** — режим можно выбросить, если тесты не держатся; записать причину в `plans/ADJOURNMENTS.md`.
- Любая мутация фиксируется в `plans/CHANGES.md` с датой и причиной.
