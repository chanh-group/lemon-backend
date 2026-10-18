# Repository Guidelines

LemonChat chat-app backend. NestJS 12 + Express, Drizzle ORM + PostgreSQL 16, Redis via `ioredis`, Vitest. Private repo. Code must run on **Node ≥ 20 AND Bun** — never import `bun:*` or use Bun-native APIs.

## Project Structure & Module Organization

```
src/
├── main.ts                  # Bootstrap (logger, PORT)
├── app.ts                   # Root module
├── configs/                 # @Global() modules: database.ts, cache.ts + schema.ts barrel
├── domain/<name>/           # controller.ts service.ts module.ts repository.ts (interface)
│                            # pg.ts (Drizzle impl) schema.ts  dto/{request,response,mapper}.ts
├── middleware/              # request-logger.ts (1-line access log per request)
├── utils/cache/             # constants keys error types store.ts (CacheStore+Ext)
│                            # redis.ts memory.ts index.ts barrel
├── utils/                   # logger.ts (AppLogger) database.ts i18n/
└── helpers/                 # get_env() — single env accessor, throws on missing required var
test/unit/**                 # mirrors src (src/utils/cache/keys.ts -> test/unit/utils/cache/keys.spec.ts)
test/e2e/**                  # needs a real DB
drizzle/                     # generated SQL migrations (sql-first, never hand-edit)
package.json                  # scripts + dependencies (Bun lockfile)
```

## Build, Test, and Development Commands

```bash
bun install
bun run start:dev      # watch mode, PORT from .env (default 3000)
bun run build && bun run start:prod
bun run typecheck      # tsc --noEmit — must be clean
bun run lint           # oxlint --type-aware src/ test/ — must be clean
bun run fmt            # oxfmt --write . (repo-wide; check `git status` after)
bun run test           # vitest run, test/unit/**/*.spec.ts
bun run test:e2e       # vitest e2e config, needs a real DB
bun run db:generate | db:migrate | db:studio
```

Copy `.env.example` to `.env` first. `USE_MEMORY_CACHE=true` boots without Redis (dev/test). Tests must never require a live Redis/Postgres except e2e.

## Coding Style & Naming Conventions

- **Filenames are role-only, Rust-style**: `service.ts`, not `example.service.ts`; `pg.ts`, not `user.pg.ts`; `store.ts`, not `cache-store.interface.ts`. Class/interface names keep their full names (`ExampleService`, `CACHE_STORE`).
- **Types**: `PascalCase` (classes, interfaces, enums). **Functions/variables**: `camelCase`. **Constants**: `SCREAMING_SNAKE_CASE`. **Error classes**: `<Name>Error` (e.g. `CacheError`).
- **ESM imports always end with `.js`**: `from "./service.js"`, `from "../utils/cache/store.js"`.
- **Formatting**: `bun run fmt` before committing. Max line width follows the formatter — don't hand-wrap.
- **Barrel files**: `index.ts` (utils), `schema.ts` (configs). Direction is one-way: `configs -> utils`, `domain -> configs/utils`. No cycles.

## Testing Guidelines

- **Framework**: Vitest with globals (`describe/it/expect` need no import).
- **Location**: `test/unit/**` mirrors `src/`; DB-touching tests belong in `test/e2e/`, not unit.
- **Style**: name tests by behavior (`"revoking the last session deletes the sessions key"`). Prefer real collaborators (`MemoryCacheService`, Nest testing module with provider overrides); stub I/O boundaries with `vi.fn()` objects, never `any` (lint forbids it).
- **Run all**: `bun run test`. **Run one file**: `bun run test -- test/unit/utils/cache/keys.spec.ts`.

## Commit & Pull Request Guidelines

- **Commits**: Conventional — `feat|fix|refactor|style|test|chore|docs(<scope>): ...` (e.g. `feat(cache): add rotation`). One logical change per commit.
- **PRs**: one branch per task (`feat/...`, `fix/...`, `refactor/...`), open PR to `main` via GitHub UI, merge after review. Never push `main` directly, never force-push.
- **Before opening a PR**: `typecheck + lint + test` all green. Mention the commands and their output in the final report.

## Security & Configuration

- **Env**: `.env` is gitignored; read env only via `get_env()` (throws on missing required var — fail fast at boot, never silently).
- **Database**: Drizzle + parameterized queries (no raw string-interpolated SQL). Never hand-edit `drizzle/` — change `schema.ts`, run `db:generate`.
- **Secrets/PII**: never in logs (strip query strings from logged paths, no headers/body); `JWT_SECRET` ≥ 32 bytes.
- **Dependencies**: no new runtime dep without a stated reason (precedent: `ioredis` chosen over `bun:redis` for Node compat).

## Mandatory Rules

### Code Quality

- **NO** hardcoded magic values — TTLs/key-prefixes/limits go in `constants.ts` or config.
- **NO** code smells — one responsibility per function. Past ~60–80 lines, split it or justify why not.
- **NO** reinventing the wheel — use libs/patterns already in the repo (`CacheStore`, `get_env`, `AppLogger`).
- **NO** `console.log` — use Nest `Logger` via `AppLogger`.
- **NO** `as any` — lint forbids it. Use `unknown` + type guard.
- **Every** public method in `service.ts`/`pg.ts` must have direct test coverage or indirect coverage via a service test.

### Error Handling

- **Production code:** No untyped raw throws — use typed errors (`CacheError`, Nest `HttpException`). No `process.exit()` outside `main.ts`.
- **Separate infra errors from business errors:** Redis down (`CacheError`) must NEVER become "wrong OTP" / "session expired" — critical paths fail closed (503), non-critical paths use `*BestEffort` fail-open (DB fallback).
- **Tests:** `throw`/`reject` stubs are allowed to exercise error paths, but assert the exact error type.
- Every error must preserve context (`new CacheError(op, err)`, `{ err }` in logs).

### Async Patterns (MANDATORY)

- **Batch I/O:** Merge independent I/O into one batch — `Promise.all` / `pipeline`, Redis Lua in 1 round trip. Never `await` 3 independent queries sequentially.
  ```ts
  // ✅ CORRECT: parallel
  const [user, sessions] = await Promise.all([getUser(id), getSessions(id)]);

  // ❌ WRONG: sequential (2 round trips instead of 1)
  const user = await getUser(id);
  const sessions = await getSessions(id);
  ```
- **DB patterns:**
  - Use Drizzle relational queries (`with:`) instead of N+1 loop queries.
  - Use `ON CONFLICT DO NOTHING/UPDATE` instead of find-then-insert.
  - Use transactions for multi-step writes.
  - No SQL outside `pg.ts`.
- **NO** holding locks/resources across unnecessary `.await`s; no blocking I/O on the request path (use a worker/queue for heavy work).

### State & DTO

- Don't model state with multiple booleans — use an enum/union type.
  ```ts
  // ❌ WRONG
  isExpired: boolean;
  isLocked: boolean;
  // ✅ CORRECT
  OtpCheckOutcome.Match | Mismatch | Missing | Locked;
  ```
- Never serialize business objects directly to the API — go through `dto/response.ts` + `mapper.ts`.
- No logic in controllers; no SQL outside `pg.ts`.

### Observability

- `private readonly logger = new Logger(ClassName)`; message-first, metadata-object-second (`log(msg, {...})`, never Pino order).
- Messages are stable string literals for greppability; strip query/PII from logged paths.
- Levels: `log` business success, `warn` expected failures, `error` unexpected (+`{ err }`), `debug/verbose` dev-only.
- No `println`/console; add metrics where needed (latency, queue length) — no logging on the hot path.

### Review Checklist

Before finishing any task, always answer:

- Any race condition? (read-modify-write without Lua/transaction?)
- Any infra error mistaken for a business error? (fail-closed vs fail-open correct?)
- Any N+1 query?
- Any resource leak? (client without `quit()`, dangling timer/handle)
- Any unnecessary clone/sequential `await`?
- Edge cases tested? (corrupt entry, TTL expiry, empty list)
- Any secret/PII in logs?
- `typecheck + lint + test` green with evidence?
- Any breaking import/API change (`git status` + full suite)?

### Testing (CRITICALLY IMPORTANT)

- Every new `service.ts`/`pg.ts` must have a mirror spec in `test/unit/`.
- Test real behavior, not mocks (`vi.fn()` only replaces I/O boundaries).
- Unit tests need no live Redis/Postgres (`MemoryCacheService`, stub objects). Live DB only in e2e.
- Name tests by behavior, not `test1`: `"evicting oldest beyond maxSessions"`, `"corrupt entry is Missing and deleted"`.

### Git Workflow

- One branch per task from `main` (`feat/...`, `fix/...`, `refactor/...`).
- NEVER code two unrelated features on the same branch.
- Merge after: green tests + finished review (on GitHub UI).
- Never commit `.env`, `dist/`, `node_modules/`, or agent scratch docs (`docs/superpowers/`, `.superpowers/` are git-ignored).
