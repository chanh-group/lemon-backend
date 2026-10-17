# LemonChat Backend (`LemonCore`)

Backend cho app chat LemonChat — NestJS + Drizzle ORM + PostgreSQL + Redis. Code chạy được cả trên **Node ≥ 20** và Bun (cấm dùng API native của Bun như `bun:*` để bạn nào dùng Node vẫn chạy được).

## Stack

| Thành phần    | Công nghệ                       |
| ------------- | ------------------------------- |
| Framework     | NestJS 12 + Express             |
| ORM / DB      | Drizzle ORM + PostgreSQL 16     |
| Cache         | Redis qua `ioredis`             |
| Test          | Vitest (unit) + Supertest (e2e) |
| Lint / Format | oxlint (type-aware) + oxfmt     |
| Package mgr   | Bun (`bun.lock`)                |

## Chạy local

Yêu cầu: Node ≥ 20 (hoặc Bun), PostgreSQL 16, Redis đang chạy ở local.

```bash
cp .env.example .env   # rồi sửa lại cho khớp máy bạn
bun install

# migrate DB
bun run db:migrate

# chạy dev (watch mode)
bun run start:dev
```

> **Lưu ý migration `0001` (unique `notes.user_id`):** nếu DB đã có dữ liệu `notes` từ trước
> (có thể tồn tại nhiều note/1 user do race đã fix), kiểm tra trước:
> `SELECT user_id, count(*) FROM notes GROUP BY user_id HAVING count(*) > 1;`
> Nếu có kết quả, chạy dedupe (giữ note mới nhất mỗi user) **trước khi** `db:migrate`:
>
> ```sql
> DELETE FROM notes n USING notes o
> WHERE n.user_id = o.user_id
>   AND (n.created_at < o.created_at OR (n.created_at = o.created_at AND n.id < o.id));
> ```
>
> **Lưu ý migration `0002` (CHECK constraints cho `stories`/`notes`):** các rule mới
> (caption ≤ 500 ký tự, `width`/`height`/`duration_ms` ≥ 0, background ≤ 200 ký tự)
> chưa được code cũ enforce, nên row cũ có thể vi phạm. Kiểm tra trước:
> `SELECT id FROM stories WHERE char_length(caption) > 500 OR width < 0 OR height < 0 OR duration_ms < 0;`
> và `SELECT id FROM notes WHERE char_length(background) > 200;`
> Nếu có kết quả, dọn các row vi phạm (sửa hoặc xóa) **trước khi** `db:migrate`.
>
> Không sửa file SQL sinh tự động trong `drizzle/`.

App mặc định nghe ở `http://localhost:3000` (đổi qua `PORT`).

| Lệnh                                               | Để làm gì                              |
| -------------------------------------------------- | -------------------------------------- |
| `bun run start:dev`                                | Chạy dev, tự reload                    |
| `bun run build` + `bun run start:prod`             | Build rồi chạy production              |
| `bun run typecheck`                                | `tsc --noEmit` — phải xanh             |
| `bun run lint`                                     | oxlint type-aware — phải sạch          |
| `bun run fmt`                                      | Format toàn repo (oxfmt)               |
| `bun run test`                                     | Unit tests (`test/unit/**`)            |
| `bun run test:e2e`                                 | E2E tests (`test/e2e/**`, cần DB thật) |
| `bun run test:cov`                                 | Unit tests + coverage                  |
| `bun run db:generate` / `db:migrate` / `db:studio` | Drizzle Kit                            |

## Biến môi trường

Xem đầy đủ ở `.env.example`. Các biến quan trọng:

| Biến                          | Ví dụ / Ghi chú                                          |
| ----------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`                | `postgres://postgres:postgres@localhost:5432/lemon_chat` |
| `REDIS_URL`                   | `redis://localhost:6379`                                 |
| `JWT_SECRET`                  | Chuỗi bí mật **≥ 32 bytes**                              |
| `JWT_ISSUER` / `JWT_AUDIENCE` | `lemon-chat` / `lemon-chat-client`                       |
| `USE_MEMORY_CACHE`            | `true` → dùng cache in-memory, khỏi cần Redis (dev/test) |
| `NODE_ENV`                    | `development` / `production` (quyết định format log)     |
| `FRONTEND_URL`                | URL FE, dùng cho CORS                                    |

Đọc env trong code luôn qua helper `get_env()` (`src/helpers/index.ts`) — thiếu biến bắt buộc là crash ngay lúc boot, không fail âm thầm.

## Cấu trúc thư mục

```
src/
  main.ts                 # bootstrap (logger, PORT)
  app.ts                  # root module
  configs/                # module Global: database.ts, cache.ts, schema.ts (barrel)
  domain/<name>/          # theo domain: controller.ts, service.ts, module.ts,
                          # repository.ts (interface), pg.ts (Drizzle impl),
                          # schema.ts, dto/{request,response,mapper}.ts
  middleware/             # request-logger.ts (access log 1 dòng/request)
  utils/cache/            # CacheStore interface + Redis/Memory backend (Lua atomic)
  utils/                  # logger.ts (AppLogger), database.ts, i18n/
  helpers/                # get_env(), ...
test/unit/...             # mirror theo src (VD: src/utils/cache/keys.ts
test/e2e/...              #   -> test/unit/utils/cache/keys.spec.ts)
drizzle/                  # migration SQL đã generate (sql-first)
```

**Quy ước đặt tên file** (học từ Rust): file chỉ mang tên **role**, không lặp tên folder — `service.ts` chứ không phải `example.service.ts`, `pg.ts` chứ không phải `user.pg.ts`, `store.ts` chứ không phải `cache-store.interface.ts`. Tên class/interface giữ nguyên (`ExampleService`, `CacheModule`...). Import ESM bắt buộc kèm suffix `.js` (`from "./service.js"`).

Chi tiết quy ước cho người/agent sửa code: xem `AGENTS.md`.

## Logging Convention

Dự án sử dụng NestJS `Logger` chuẩn (`@nestjs/common`) với cấu hình tập trung tại `src/utils/logger.ts`. Mọi service khởi tạo logger độc lập theo tên class:

```typescript
import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class ExampleService {
  private readonly logger = new Logger(ExampleService.name);

  someMethod() {
    // Thứ tự tham số chuẩn Nest: message trước, metadata/object sau (ngược với Pino)
    this.logger.log("User signed up successfully", { userId: "123" });
  }
}
```

`RequestLoggerMiddleware` tự động ghi 1 dòng mỗi request (`method, path` đã strip query, `status, durationMs`), phân level theo status (`<400` log, `4xx` warn, `5xx` error).

### Quy ước log level:

- `log`: Business event thành công (ví dụ: `User signed up`, `Conversation created`).
- `warn`: Attempt thất bại nhưng nằm trong dự tính nghiệp vụ (ví dụ: `Invalid invite code`, `Password mismatch`).
- `error`: Exception / lỗi hệ thống không mong muốn (kèm `{ err }`).
- `debug`: Chi tiết query / kỹ thuật hỗ trợ dev (chỉ bật ở development).
- `verbose`: Trace chi tiết hơn `debug` (chỉ bật ở development).
- `fatal`: Lỗi làm process không thể tiếp tục.

### Định dạng output:

- **Development** (`NODE_ENV` khác `production`): human-readable, có màu, timestamp ISO 8601.
- **Production** (`NODE_ENV=production`): 1 dòng JSON mỗi log, timestamp ISO 8601, tắt `debug`/`verbose`.

```json
{
  "level": "log",
  "pid": 123,
  "timestamp": "2026-10-13T03:00:00.000Z",
  "message": "User signed up successfully",
  "params": { "userId": "123" }
}
```

### Định dạng & Quy tắc:

1. **Message**: Dùng string literal ổn định, ngắn gọn để dễ grep log (không nối chuỗi động vào message).
2. **Metadata**: Dùng plain object truyền ở tham số thứ 2.
3. **Thứ tự tham số**: `logger.log(message, context/meta)` — **Message trước, Object sau** (chú ý ngược với `(obj, msg)` của Pino).

## Đóng góp

- Mỗi việc một nhánh (`feat/...`, `fix/...`, `refactor/...`), commit theo conventional commits (`feat(cache): ...`).
- Mở PR vào `main` trên GitHub UI, chờ review rồi merge. Không push thẳng `main`.
- Trước khi báo xong việc: `bun run typecheck && bun run lint && bun run test` phải xanh hết.
