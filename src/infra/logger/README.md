# Request Logging Module — LEMON CHAT

Module logging gọn nhẹ cho **LEMON CHAT Backend**, tận dụng 100% tính năng gốc có sẵn của `pino`, `pino-http`, và `nestjs-pino`, tuân thủ đặc tả tại [docs/SETUP.md](../../../../docs/SETUP.md).

Module giữ đúng thiết kế độc lập (Self-contained), chưa can thiệp vào `AppModule` hay `main.ts` để tránh xung đột nhánh.

---

## 1. Tính năng cốt lõi

1. **Tận dụng Native Hooks của `pino-http`**:
   - `customReceivedMessage`: Ghi nhận khi request vừa đến (`http.request_incoming: --> METHOD URL (reqId: ...)`).
   - `customSuccessMessage`: Ghi nhận khi request hoàn tất kèm `responseTime` đo bằng hrtime chính xác cao.
   - `customLogLevel`: Tự động phân loại mức log theo chuẩn HTTP:
     - 2xx / 3xx $\rightarrow$ `info`
     - 4xx $\rightarrow$ `warn`
     - 5xx / Error $\rightarrow$ `error`
2. **Request Tracing chuẩn UUIDv7**:
   - `genReqId` tạo mã **UUIDv7** thời gian thực (`uuid.v7()`) nếu client chưa gửi, và tự động echo header `x-request-id` về client.
3. **Bảo mật & Chuẩn hóa**:
   - **Auto-redact**: Che giấu (`***`) các trường nhạy cảm: `password`, `oldPassword`, `newPassword`, `otp`, `accessToken`, `refreshToken`, `secret`, `authorization`, `cookie`.
   - **Serializers chuẩn**: Sử dụng `pino.stdSerializers.req`, `res`, `err`.
   - **Bỏ qua Health check**: Tự động bỏ qua `/health/live`, `/health/ready`, `/metrics`.
   - **Immutability**: `AppLogger.forContext()` tạo child logger bất biến, không mutate singleton instance.

---

## 2. Cấu trúc module (~250 dòng code)

```
src/infra/logger/
├── logger.constants.ts        # Hằng số REDACT_PATHS, HEADER_REQUEST_ID, IGNORED_LOG_URLS
├── logger.interface.ts        # Types & Interfaces gọn nhẹ
├── logger.config.ts           # 1 resolver cấu hình chung cho Pino & Pino-HTTP (hooks, serializers, uuidv7)
├── logger.service.ts          # AppLogger mỏng bọc Pino, hỗ trợ forContext() bất biến
├── request-logger.middleware.ts # RequestLoggerMiddleware mỏng ủy quyền cho pino-http
├── logger.module.ts           # LoggerModule đóng gói cho NestJS
└── index.ts                   # Barrel export
```

---

## 3. Cách tích hợp khi nhóm ghép nhánh

### Cách 1: Tích hợp qua AppModule (Khuyên dùng)

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

### Cách 2: Tích hợp toàn diện qua `LoggerModule.forRoot()`

```typescript
import { Module } from '@nestjs/common';
import { LoggerModule } from './infra/logger/index.js';

@Module({
  imports: [LoggerModule.forRoot()],
})
export class AppModule {}
```

---

## 4. Kiểm thử

```bash
bun test src/infra/logger
```
