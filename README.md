# Online Exam API

Backend thi trắc nghiệm trực tuyến, sử dụng NestJS, TypeScript, Prisma và MongoDB.
Tên package và Docker Compose: online-exam-api.

## Khởi tạo database mới

MongoDB cần chạy replica set để Prisma thực hiện các thao tác ghi có transaction.
Thiết lập `DATABASE_URL` trong `.env`, sau đó:

```powershell
npm run prisma:generate
npm run prisma:validate
npx prisma db push
npx prisma db seed
```

Seed tạo tài khoản demo và một đề gồm 5 câu, mỗi câu có các bản ghi `Option`
riêng. Khi chạy lại, seed giữ nguyên tài khoản, đề thi, câu hỏi và bài làm đã có;
không xóa dữ liệu database.

## Chuyển đổi database đã có dữ liệu

Schema mới dùng `Question.options: Option[]` và `AttemptAnswer.selectedOptionId`.
Model `AttemptAnswer` vẫn dùng collection MongoDB `Answer` để giữ nguyên ID và
bài làm cũ. Trạng thái `CANCELLED` và `cancelledAt` lưu lịch sử hủy bài; hủy bài
không xóa attempt hoặc câu trả lời. `answerVersion` hỗ trợ kiểm soát các lần lưu
đáp án và nộp bài đồng thời.

Prisma MongoDB không dùng `prisma migrate deploy`. Với database cũ, thực hiện
theo thứ tự sau, trước khi khởi động API với code mới:

1. Sao lưu database bằng công cụ MongoDB và kiểm tra có thể khôi phục bản sao.
   Dừng API/các tiến trình có thể ghi dữ liệu trong suốt quá trình chuyển đổi.
2. Chạy `npm run prisma:generate` và `npm run prisma:validate`.
3. Chạy `npm run prisma:migrate-options` để kiểm tra dữ liệu và xem số bản ghi
   cần chuyển đổi. Lệnh mặc định chỉ đọc database.
4. Nếu kiểm tra thành công, chạy `npm run prisma:migrate-options -- --apply`.
5. Chạy lại `npm run prisma:migrate-options`; số thay đổi còn lại phải bằng 0.
6. Chạy `npx prisma db push` để đồng bộ các index, rồi khởi động API mới.

Script chuyển `Question.options` dạng mảng chuỗi và `correctOptionIndex` thành
`Option` với `position` bắt đầu từ 0; chuyển `Answer.selectedOptionIndex` thành
`selectedOptionId`. Script giữ nguyên ID của user, đề thi, câu hỏi, attempt và
câu trả lời; giữ nguyên điểm số, thời gian lưu đáp án và các trường cũ để đối
chiếu lịch sử. Khi một câu trả lời đã có `selectedOptionId`, ID đó là đáp án hiện
tại; script không ghi đè bằng `selectedOptionIndex` cũ nếu thí sinh đã đổi lựa
chọn sau chuyển đổi. Attempt cũ thiếu `answerVersion` được bổ sung giá trị 0.

Script có thể chạy lại nếu một bước bị gián đoạn. Trước khi ghi, script kiểm
tra toàn bộ dữ liệu: index đáp án hợp lệ, câu hỏi còn tồn tại và các Option đã
có khớp dữ liệu cũ. Nếu phát hiện dữ liệu không nhất quán, script dừng để người
quản trị xử lý; không tự xóa hoặc sửa đáp án. Không dùng `--force-reset` hoặc
`--accept-data-loss` cho quy trình này. Chạy seed sau khi chuyển đổi là tùy chọn.

## Kiểm tra chuyển đổi trên MongoDB thật

Test chuyển đổi chỉ chạy khi có `MONGO_TEST_DATABASE_URL` trỏ đến một MongoDB
replica set dành riêng cho test. Ví dụ với một MongoDB test đang chạy:

```powershell
$env:MONGO_TEST_DATABASE_URL = 'mongodb://127.0.0.1:27017/online_exam_codex_test?replicaSet=rs0&directConnection=true'
npm run test:e2e -- --runInBand
```

Test tự chọn database mới có tiền tố `online_exam_migration_codex_test_` hoặc
`online_exam_seed_codex_test_` trên server test, truyền URL đó trực tiếp cho
Prisma và script chuyển đổi/seed. Test không
dùng URL trong `.env` và không xóa collection hoặc database; database fixture
được giữ lại để kiểm tra. Test xác nhận dry run không ghi, chạy chuyển đổi nhiều
lần giữ nguyên ID/điểm/thời gian lưu đáp án, và index đáp án không hợp lệ khiến
chuyển đổi dừng trước khi tạo Option. Test seed xác nhận chạy hai lần vẫn chỉ có
1 đề demo, 5 câu hỏi, 20 Option và giữ nguyên attempt/câu trả lời đã lưu.
Không đặt biến trên nếu chỉ muốn chạy test thông thường không cần MongoDB.

## Prisma trên Windows khi mạng chặn tải engine

Nếu các engine đã có trong `node_modules/@prisma/engines`, dùng chúng trực tiếp
trong phiên PowerShell hiện tại rồi chạy các lệnh Prisma:

```powershell
$env:PRISMA_SCHEMA_ENGINE_BINARY = (Resolve-Path 'node_modules/@prisma/engines/schema-engine-windows.exe').Path
$env:PRISMA_QUERY_ENGINE_LIBRARY = (Resolve-Path 'node_modules/@prisma/engines/query_engine-windows.dll.node').Path
npm run prisma:validate
npm run prisma:generate
```
