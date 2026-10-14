# TÀI LIỆU KIẾN TRÚC, PHÂN TÍCH PATTERNS & LỘ TRÌNH TRIỂN KHAI STORY & NOTE 24H
> Dành cho Kỹ sư Phát triển & AI Coding Agents — Lemon Chat Backend  
> Phiên bản: 1.1 (Cập nhật sau phản biện & commit `f69a81d`)

---

## 1. Kiểm tra & Phân tích Commit mới trên Nhánh (`f69a81d`)

Sau khi pull commit mới nhất `f69a81d` (`fix(story): fail-closed auth, revive cached Dates, shared constants, UUID pipes`), nhóm đã thực hiện các cải tiến kỹ thuật quan trọng:

1. **Bảo mật Fail-Closed Authentication**:
   - Header fallback `x-user-id` chỉ được kích hoạt trong môi trường phát triển / kiểm thử (`NODE_ENV !== "production"`).
   - Trong production, hệ thống bắt buộc lấy user identity từ `request.user.id` (được giải mã từ Access Token qua Auth Guard), chặn hoàn toàn nguy cơ giả mạo định danh qua header HTTP.
2. **Hồi sinh kiểu dữ liệu `Date` khi đọc từ Redis Cache (Revive Cached Dates)**:
   - Redis lưu trữ JSON chuỗi (JSON serialization biến `Date` thành ISO string). Khi cache hit, service tự động map và khởi tạo lại đối tượng `new Date(item.createdAt)` và `new Date(item.expiresAt)`, ngăn chặn lỗi runtime khi tầng controller/client gọi các phương thức thời gian.
3. **Invalidation Cache diện rộng theo mạng lưới bạn bè (`deleteManyBestEffort`)**:
   - Khi tạo hoặc xóa story, service tự động tính toán và xóa đồng thời feed cache của chính chủ và toàn bộ bạn bè (`[userFeedKey, ...friendFeedKeys]`).
4. **Chuẩn hóa Hằng số & Validation Pipes**:
   - Tách hằng số dùng chung: `STORY_FEED_TTL_SECONDS = 60`, `STORY_EXPIRATION_HOURS = 24`, `STORY_MAX_CAPTION_LENGTH = 500`.
   - Sử dụng `new ParseUUIDPipe()` trên tất cả các route parameters `:id` để từ chối sớm (fail-fast) các ID không đúng định dạng UUID.
5. **Bổ sung Unit Tests**:
   - Thêm `test/unit/domain/story/mapper.spec.ts` kiểm thử toàn diện mappers `toStoryItemResponse` và `groupStoriesByUser`.
   - Kiểm tra chặn caption chỉ chứa khoảng trắng (`whitespace-only`), và tự động bỏ qua tự xem story của chính mình (`self-view ignored`).

---

## 2. Nghiên cứu Patterns từ các Hệ thống Lớn (Research: Messenger, Signal, Instagram)

### 2.1 Facebook Messenger: Tích hợp sâu vào Chat & Ephemeral Interactions
- **Story Ring & Carousel**: Story xuất hiện ngay đầu danh sách hộp thư đến (Inbox Header). Vòng tròn avatar phân biệt: Gradient đầy màu sắc (chưa xem), Xám mờ (đã xem hết), Nét đứt (nhiều story ngắn).
- **Rep Story thành Direct Message (Core Philosophy)**: Messenger **không có phần bình luận công khai (Public Comments)** trên Story. Khi người xem phản hồi:
  - Hệ thống tự động tạo / mở cuộc trò chuyện 1:1 (`DIRECT`).
  - Gửi tin nhắn chứa snapshot (thumbnail, text caption, loại media) của story tại thời điểm đó để cả hai người đều hiểu ngữ cảnh dù story gốc có thể đã bị xóa hoặc hết hạn sau 24h.
- **Quick Reactions**: Các emoji tương tác nhanh (❤️, 😂, 😮, 😢, 😡, 🔥) được gửi trực tiếp như một tin nhắn tương tác hoặc reaction nổi bật trong luồng chat riêng của chủ story.

### 2.2 Signal: Zero-Knowledge, E2EE & Private View Receipts
- **Mã hóa đầu cuối (E2EE) cho Story**:
  - Mỗi story được mã hóa bằng một khóa đối xứng ngẫu nhiên (`Story Key`).
  - Tận dụng giao thức **Sender Keys** để phân phối nội dung tới danh sách bạn bè mà server trung gian không thể đọc được nội dung ảnh/video/caption.
- **View Receipts riêng tư (Opt-in Privacy)**:
  - Signal cho phép người dùng tắt tính năng "Đã xem" (Read Receipts). Nếu tắt, người xem sẽ không xuất hiện trong danh sách viewer của chủ story, đồng thời họ cũng không xem được ai đã xem story của mình.
- **Tombstones & Remote Retraction**:
  - Khi chủ story xóa story hoặc hết hạn 24h, một gói tin mã hóa mang cờ xóa (`Tombstone Retraction Message`) được gửi đến các client để ra lệnh xóa sạch file media đã cache trong bộ nhớ máy của người nhận.

### 2.3 WhatsApp & Instagram: Tối ưu Lưu trữ, Fan-Out vs Fan-In & High-Volume View Receipts
- **Media Ingestion qua Presigned URL (Zero-Server-Load)**:
  - File nhị phân (Ảnh, Video dung lượng lớn) **tuyệt đối không đi qua Backend API Gateway**.
  - Client gửi yêu cầu lấy `Presigned S3/MinIO PUT URL` kèm mã hash/kích thước. Sau đó client đẩy thẳng lên Object Storage qua CDN. Backend chỉ nhận webhook hoặc kiểm tra `HEAD Object` trước khi lưu metadata vào database.
- **Mô hình Phân phối Feed: Fan-In on Read (Pull with Cache)**:
  - Với mạng lưới bạn bè vừa và nhỏ, mô hình Fan-in on read kết hợp bộ đệm Redis TTL 60s tối ưu chi phí hơn nhiều so với Fan-out on write (không bị write amplification khi user có hàng nghìn bạn bè).
- **Ghi nhận Lượt xem Idempotent**:
  - Dùng PostgreSQL `INSERT INTO story_views ... ON CONFLICT (story_id, user_id) DO NOTHING` kết hợp index tổng hợp. Lượt xem đầu tiên được bảo toàn thời điểm xem (`viewed_at`), các lần click xem lại không gây tải ghi hoặc trùng lặp dữ liệu.
- **Dọn dẹp Phế phẩm (Tombstone Purge Job)**:
  - Kết hợp cron job định kỳ dọn database với S3 Batch Delete (`DeleteObjectsCommand`) để giải phóng dung lượng đĩa vật lý.

---

## 3. Kiến trúc Áp dụng cho Lemon Backend

Hệ thống tuân thủ nghiêm ngặt quy ước thiết kế trong `lemon-backend/AGENTS.md` và `docs/STORIES_NOTES.md`:

```mermaid
flowchart TD
    subgraph Client["Client (Web / Mobile)"]
        UI["UI Layer"]
    end

    subgraph Gateway["NestJS API Gateway"]
        AuthG["Auth Guard & Fail-Closed CurrentUserId"]
        StoryCtrl["StoryController\n(REST Envelopes)"]
        NoteCtrl["NoteController\n(Upsert 1 Active Note)"]
        StorySvc["StoryService\n(Business Logic & Validation)"]
        NoteSvc["NoteService\n(Business Logic)"]
    end

    subgraph Infrastructure["Infrastructure & Background"]
        PurgeCron["PurgeCronService\n(@Cron '*/5 * * * *')"]
        S3Storage[("S3 / MinIO Object Storage\n(Media Files)")]
        RedisStore[("Redis Cluster\n- stories:feed:<uid>\n- lock:purge-stories-notes")]
        PgDB[("PostgreSQL 16\n- stories, story_views\n- notes, friendships")]
    end

    UI -->|"1. POST /files/presign"| StoryCtrl
    UI -->|"2. Direct PUT binary"| S3Storage
    UI -->|"3. POST /stories (metadata)"| StoryCtrl
    UI -->|"4. PUT /notes"| NoteCtrl
    UI -->|"5. GET /stories/feed & /notes/feed"| StoryCtrl

    StoryCtrl --> StorySvc
    NoteCtrl --> NoteSvc

    StorySvc <-->|"Feed Cache (TTL 60s)\nDeleteMany Invalidation"| RedisStore
    StorySvc -->|"Drizzle ORM Queries"| PgDB
    NoteSvc -->|"Drizzle ORM Queries"| PgDB

    PurgeCron -->|"Leader Lock (SET NX EX 5)"| RedisStore
    PurgeCron -->|"DELETE Expired Records"| PgDB
    PurgeCron -->|"DeleteObjectsCommand (Batch)"| S3Storage
```

### Các nguyên tắc cốt lõi dành cho AI & Kỹ sư:
1. **Rust-style Role-Only Filenames**: Tên file trong domain không lặp lại tên thư mục (chỉ đặt `service.ts`, `controller.ts`, `module.ts`, `pg.ts`, `repository.ts`, `schema.ts`).
2. **Không ép kiểu bừa bãi (`no-any`)**: Nghiêm cấm sử dụng `as any` trong cả mã nguồn chính và test code.
3. **Không tạo Unbound Methods trong Spies**: Khi mock vitest, gán các hàm giả lập vào biến rời có định danh rõ ràng thay vì trích xuất từ object để linter `typescript(unbound-method)` luôn đạt 0 cảnh báo.
4. **Phản hồi Envelope Thống nhất (`RESPONSES.md`)**:
   - Thành công: `{ success: true, message: string, data?: T }`
   - Thất bại: `{ success: false, error: { code: string, message: string, details?: unknown } }`

---

## 4. Lộ trình Triển khai Chi tiết Theo Từng Đợt Commit

Toàn bộ công việc tiếp theo được chia nhỏ thành các đợt (Phases/Batches), mỗi đợt có phạm vi và cam kết cụ thể:

### Đợt 1: Hoàn thiện Ổn định Hạ tầng & Presigned Media Upload
- **Mục tiêu**: Đảm bảo 100% test suites không bị flake trên môi trường Windows và hỗ trợ cơ chế Presigned URL cho Story Media theo chuẩn S3.
- **Commit 1.1**: `fix(test): set realistic test timeout in cache suite to prevent Windows CI flake`
  - *Công việc*: Điều chỉnh timeout 15000ms trong `test/unit/configs/cache.spec.ts` cho test case khởi tạo dynamic testing module.
  - *Verify*: `bun run test` 100% green trên cả 16 test files.
- **Commit 1.2**: `feat(story): implement S3 presigned URL generation and media head verification`
  - *Công việc*:
    - Xây dựng service hỗ trợ sinh Presigned PUT URL với MinIO/S3 SDK (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`).
    - Endpoint `POST /files/presign` (hoặc `POST /stories/presign`) kiểm tra kích thước tối đa (Ảnh <= 10MB, Video <= 50MB) và mime type hợp lệ.
    - Validate kiểm tra file thực sự tồn tại trên S3 (`HeadObjectCommand`) trước khi lưu record Story.

### Đợt 2: Xây dựng Worker Dọn dẹp Định kỳ (Background Purge Cron Job)
- **Mục tiêu**: Tự động giải phóng dung lượng đĩa và dọn dẹp các story/note đã quá hạn 24 giờ.
- **Commit 2.1**: `feat(story): implement PurgeCronService with distributed Redis lock and S3 batch deletion`
  - *Công việc*:
    - Tạo `src/jobs/purge.job.ts` (hoặc `src/domain/story/cron.ts`) với `@Cron('*/5 * * * *')`.
    - Sử dụng Redis Distributed Lock (`SET lock:purge-stories-notes 1 NX EX 5`) để chỉ duy nhất 1 pod/instance thực thi tại một thời điểm.
    - Truy vấn các story có `expiresAt <= NOW()`, thu thập danh sách `(bucket, objectKey)`.
    - Gọi lệnh S3 `DeleteObjectsCommand` để xóa file vật lý hàng loạt.
    - Xóa các records đã hết hạn trong PostgreSQL (`stories`, `notes`).
- **Commit 2.2**: `test(story): add unit tests for PurgeCronService leader election and batch deletion`
  - *Công việc*:
    - Viết unit test cho cron service: Kiểm thử kịch bản lock thành công/thất bại, batch deletion S3, rollback an toàn khi DB lỗi.

### Đợt 3: Triển khai Domain Note 24h (Text Status)
- **Mục tiêu**: Hoàn thành tính năng Note 24h (trạng thái text ngắn 1-200 ký tự, upsert duy nhất 1 active note/user).
- **Commit 3.1**: `feat(note): define Note DTOs, repository contract, and Drizzle PG implementation`
  - *Công việc*:
    - Tạo `src/domain/note/dto/request.ts`, `src/domain/note/dto/response.ts`.
    - Định nghĩa `NoteRepository` contract và hiện thực `NotePgRepository` truy vấn bảng `notes`.
    - Logic `upsert`: Nếu user đã có note còn hạn, xóa note cũ hoặc cập nhật note mới, `expiresAt = NOW() + 24h`.
- **Commit 3.2**: `feat(note): implement NoteService and NoteController with friend feed and early deletion`
  - *Công việc*:
    - `NoteService`: Quản lý nghiệp vụ note, kiểm tra độ dài 1-200 ký tự, lấy note feed của bạn bè có quan hệ `ACCEPTED`.
    - `NoteController`:
      - `PUT /notes`: Tạo hoặc cập nhật note.
      - `GET /notes/feed`: Lấy feed note của bạn bè.
      - `DELETE /notes/me`: Chủ động gỡ note trước thời hạn 24h.
    - Đăng ký `NoteModule` vào `AppModule`.
- **Commit 3.3**: `test(note): add unit tests for NoteService and NoteController`
  - *Công việc*:
    - Viết bộ test đầy đủ cho service và controller của Note domain.

### Đợt 4: Mở rộng Tương tác Story (Messenger / Instagram Style - Phase 2)
- **Mục tiêu**: Định tuyến phản hồi Story thành tin nhắn riêng và hỗ trợ thả biểu cảm realtime.
- **Commit 4.1**: `feat(story): implement story reaction endpoint and sync into 1:1 conversation`
  - *Công việc*:
    - Định nghĩa bảng `story_reactions`.
    - Endpoint `POST /stories/:id/react`: Ghi nhận reaction (❤️, 🔥, 😂, 😮, 😢, 👏) và định tuyến thành sự kiện tin nhắn vào hộp thoại riêng với chủ story.
- **Commit 4.2**: `feat(story): implement story reply endpoint with snapshot quotation into direct message`
  - *Công việc*:
    - Endpoint `POST /stories/:id/reply`: Tạo tin nhắn dạng `STORY_REPLY` kèm snapshot preview của story trong cuộc trò chuyện `DIRECT`.
- **Commit 4.3**: `test(story): add unit tests for story reactions and reply workflows`
  - *Công việc*: Kiểm thử xác thực quyền riêng tư (chỉ bạn bè mới được react/reply), kiểm tra cấu trúc snapshot trích dẫn.

---

## 5. Quy tắc Kiểm thử & Tiêu chuẩn Bàn giao (Definition of Done)
1. **Linter & Typecheck**:
   - `bun run typecheck` ➜ Exit code 0, 0 lỗi.
   - `bun run lint` ➜ Exit code 0, 0 warnings, 0 errors.
2. **Unit Tests**:
   - `bun run test` ➜ 100% test cases passed, không có test nào bị timeout hay flakiness.
3. **Build & E2E**:
   - `bun run build` ➜ Build NestJS hoàn tất không có cảnh báo module thiếu.
   - `bun run test:e2e` ➜ Toàn bộ luồng E2E passed.
4. **Git Hygiene**:
   - Commit atomic, thông điệp tuân thủ Conventional Commits (`feat(...)`, `fix(...)`, `test(...)`).
   - Tuyệt đối không push đè lên `main`, luôn tạo nhánh tính năng và mở Pull Request để review.
