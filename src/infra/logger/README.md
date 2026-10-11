# Independent Request Logging Module — LEMON CHAT

Module logging độc lập cho **LEMON CHAT Backend**, được thiết kế theo chuẩn đặc tả tại [docs/SETUP.md](../../../../docs/SETUP.md) và [docs/RESPONSES.md](../../../../docs/RESPONSES.md).

Module hoàn toàn độc lập (Self-contained), chưa gắn trực tiếp vào `AppModule` hay `main.ts` để tránh xung đột (merge conflicts) với các thành viên khác đang làm tính năng và infra.

---

## 1. Tính năng nổi bật

1. **Ghi log yêu cầu đến (Incoming Request)**:
   - **Thời gian request đến**: Unix timestamp + định dạng ngày giờ tháng năm ISO 8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`).
   - **URL client gọi**: Full path + query parameters (`req.originalUrl || req.url`).
   - **HTTP Method**, **Request ID** (`x-request-id`), **Client IP**, **User-Agent**.
2. **Ghi log phản hồi hoàn tất (Completed Request)**:
   - **URL client gọi**, HTTP Method.
   - **Mã trạng thái HTTP** (`statusCode`), phân loại cảnh báo tự động:
     - 2xx / 3xx $\rightarrow$ `info`
     - 4xx $\rightarrow$ `warn` (lỗi nghiệp vụ / phía client)
     - 5xx $\rightarrow$ `error` (lỗi hệ thống)
   - **Thời gian xử lý** (`responseTime` / `durationMs`).
   - **Thời gian hoàn tất** (ngày giờ tháng năm).
3. **An toàn bảo mật (Auto-redaction)**:
   - Tự động che giấu (`***`) các trường nhạy cảm: `password`, `oldPassword`, `newPassword`, `otp`, `accessToken`, `refreshToken`, `secret`, `authorization`, `cookie`.
4. **Hỗ trợ Request Tracing**:
   - Tự động sinh `x-request-id` (UUIDv7/UUID) nếu client chưa gửi, hoặc giữ nguyên ID client gửi lên và echo về header của response.
   - Bỏ qua các endpoint nội bộ như `/health/live`, `/health/ready`, `/metrics` để giảm nhiễu log.

---

## 2. Các class thành phần

* **`AppLogger`** (`logger.service.ts`):
  Class độc lập triển khai `LoggerService` của NestJS và bọc `pino`. Có thể khởi tạo `new AppLogger()` trực tiếp ở bất kỳ đâu không cần qua DI container.
* **`RequestLoggerMiddleware`** (`request-logger.middleware.ts`):
  Class triển khai `NestMiddleware` ở tầng HTTP Express, bắt đầu ghi nhận ngay khi request chạm tới server và ghi nhận thời gian xử lý khi request hoàn tất (`res.on('finish')`).
* **`RequestLoggerInterceptor`** (`request-logger.interceptor.ts`):
  Class triển khai `NestInterceptor` cho NestJS execution context, tiện lợi khi muốn gắn qua Decorator `@UseInterceptors(RequestLoggerInterceptor)` hoặc global interceptor.
* **`LoggerModule`** (`logger.module.ts`):
  Module đóng gói sẵn, có thể gọi `LoggerModule.forRoot()` để cấu hình động.

---

## 3. Cách tích hợp khi nhóm ghép nhánh

### Cách 1: Gắn qua Middleware trong AppModule (Khuyên dùng cho toàn bộ HTTP)

```typescript
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { LoggerModule, RequestLoggerMiddleware } from './infra/logger/index.js';

@Module({
  imports: [LoggerModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
```

### Cách 2: Gắn độc lập trực tiếp trong `main.ts`

```typescript
import { AppLogger, RequestLoggerMiddleware } from './infra/logger/index.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const logger = new AppLogger();
  app.useLogger(logger);
  app.use(new RequestLoggerMiddleware(logger).use.bind(new RequestLoggerMiddleware(logger)));

  await app.listen(3000);
}
```

### Cách 3: Gắn qua Global Interceptor

```typescript
import { RequestLoggerInterceptor } from './infra/logger/index.js';

app.useGlobalInterceptors(new RequestLoggerInterceptor());
```

---

## 4. Kiểm thử

Chạy bộ test độc lập của logger:

```bash
bun test src/infra/logger
```
