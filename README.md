# Online Exam API

Backend thi trắc nghiệm trực tuyến, sử dụng NestJS, TypeScript, Prisma và MongoDB.
Tên package và Docker Compose: online-exam-api.

## Trạng thái hiện tại

Dự án đã chuyển sang **khung nền cho đề tài thi trắc nghiệm**. Có cấu hình NestJS,
validation toàn cục, Swagger tại /docs, kết nối Prisma, UsersRepository,
schema đề thi và Docker. Chỉ có GET /api/v1 trả thông tin dịch vụ dạng JSON.
**Chưa triển khai đăng nhập, phân quyền, API thi/quản lý đề, chấm điểm hoặc kiểm thử tải.**
Schema mô tả dữ liệu; các quy tắc nghiệp vụ dưới đây cần được triển khai ở Service.

## Kiến trúc

Luồng dự kiến: Controller (REST/JSON, DTO) → Service (nghiệp vụ) → Repository → Prisma → MongoDB.
Xác thực và phân quyền sẽ dùng NestJS Guard, không lặp trong từng endpoint.

- src/main.ts: khởi động, prefix /api/v1, validation và Swagger.
- src/app.*: module gốc và thông tin dịch vụ.
- src/database/: PrismaModule và PrismaService.
- src/users/: repository người dùng dùng chung.
- prisma/schema.prisma: mô hình dữ liệu mới.
- test/: kiểm thử HTTP của khung ứng dụng.

Các module sẽ bổ sung: auth, exams (gồm quản lý câu hỏi), attempts (gồm lưu đáp án và chấm điểm).
Mỗi module nghiệp vụ cần tách controller, service, repository và DTO.

## Dữ liệu và quy tắc dự kiến

- User: email, mật khẩu băm, họ tên; vai trò STUDENT hoặc EXAM_MANAGER.
- Exam: tên, mô tả, quy định, thời gian làm bài, người quản lý;
  trạng thái DRAFT → PUBLISHED → CLOSED.
- Question: nội dung, danh sách lựa chọn, vị trí và chỉ số đáp án đúng (bắt đầu từ 0).
- Attempt: người làm, đề thi, thời điểm bắt đầu, hạn nộp, trạng thái, thời điểm nộp và điểm.
- Answer: một lựa chọn cho mỗi câu trong một lượt làm; cặp attemptId/questionId là duy nhất.

Chỉ được sửa câu hỏi/nội dung hoặc xóa đề ở trạng thái DRAFT. Khi công bố phải có
ít nhất một câu, mỗi câu có ít nhất hai lựa chọn và một chỉ số đáp án đúng hợp lệ;
thời gian làm bài phải dương. Nội dung đã công bố được cố định để bảo toàn kết quả.
Đóng đề chỉ ngăn lượt làm mới, các lượt đang làm tiếp tục tới hạn.
Chỉ chủ sở hữu được lưu, nộp, xem hoặc hủy lượt làm của mình; người quản lý chỉ
quản lý và xem kết quả các đề mình sở hữu.

Thời gian do server quyết định. Sau hạn không nhận thay đổi đáp án; khi truy cập
lượt quá hạn, hệ thống dự kiến chốt bài theo đáp án đã lưu, dùng deadlineAt làm
thời điểm nộp hiệu lực. Nộp lại không chấm lại hoặc thay đổi kết quả.
Chỉ hủy lượt IN_PROGRESS chưa quá hạn, đồng thời xóa các Answer liên quan.
Không trả đáp án đúng trước khi nộp. Điểm dự kiến theo thang 10:
10 × số câu đúng / tổng số câu; câu chưa trả lời tính là sai.
Service phải kiểm tra câu hỏi thuộc đề của lượt làm và chỉ số lựa chọn hợp lệ.
Các thao tác đổi trạng thái/lưu đáp án phải kiểm tra điều kiện ngay khi ghi để
tránh nhận đáp án sau khi đã nộp hoặc hết hạn.

## API dự kiến (chưa triển khai)

Tất cả đường dẫn dưới đây có prefix /api/v1. Ngoại trừ đăng nhập, tất cả cần
xác thực qua Guard; đường dẫn /management cần thêm vai trò EXAM_MANAGER.

| Method | Đường dẫn | Chức năng |
| --- | --- | --- |
| POST | /auth/login | Đăng nhập |
| GET | /exams | Danh sách đề đã công bố, số câu và thời gian |
| GET | /exams/:id | Thông tin và quy định đề |
| POST | /exams/:id/attempts | Bắt đầu làm bài |
| GET | /attempts | Lịch sử cá nhân |
| GET | /attempts/:id | Câu hỏi và đáp án đang chọn |
| PUT | /attempts/:id/answers/:questionId | Lưu/thay đổi lựa chọn |
| POST | /attempts/:id/submit | Nộp và chấm bài |
| GET | /attempts/:id/result | Điểm, đúng/sai và đáp án sau khi nộp |
| DELETE | /attempts/:id | Hủy lượt chưa nộp |
| GET | /management/exams | Danh sách đề của người quản lý |
| GET | /management/exams/:id | Nội dung đề để quản lý |
| POST | /management/exams | Tạo đề nháp |
| PATCH | /management/exams/:id | Cập nhật đề nháp |
| POST | /management/exams/:id/questions | Thêm câu hỏi và lựa chọn |
| PATCH | /management/exams/:id/questions/:questionId | Sửa câu hỏi và lựa chọn |
| DELETE | /management/exams/:id/questions/:questionId | Xóa câu hỏi |
| POST | /management/exams/:id/publish | Công bố |
| POST | /management/exams/:id/close | Đóng đề |
| DELETE | /management/exams/:id | Xóa đề nháp |
| GET | /management/exams/:id/results | Người đã nộp, điểm và thời điểm nộp |

## Chạy local

Yêu cầu Node.js 24 và MongoDB replica set (hoặc MongoDB Atlas).

1. Chạy npm ci.
2. Sao chép .env.example thành .env nếu chưa có; cấu hình DATABASE_URL trỏ tới
   database riêng tên online_exam. Không dùng lại database của đề tài trước.
   JWT_SECRET và JWT_EXPIRES_IN dành cho module xác thực sắp triển khai.
3. Chạy npm run prisma:generate.
4. Khi đã xác nhận database mới, chạy npx prisma db push để đồng bộ schema.
5. Chạy npm run start:dev.

Swagger: http://localhost:3000/docs. API: http://localhost:3000/api/v1.
PrismaService kết nối database khi khởi động nên cần DATABASE_URL hợp lệ.
Không có tài khoản mẫu/seed ở thời điểm này.

## Docker

Mở Docker Desktop, tạo `.env` từ `.env.example` nếu chưa có, rồi chạy:

```bash
docker compose up -d --build
docker compose exec api npx prisma db push
```

Compose chạy MongoDB 8 dưới dạng replica set một nút và dùng volume `mongo_data`
để lưu dữ liệu. API trong Compose luôn kết nối tới `mongo:27017/online_exam`;
`DATABASE_URL` trong `.env` chỉ dùng khi chạy ứng dụng trực tiếp trên máy.
MongoDB nội bộ không mở cổng ra máy chủ và không bật xác thực: cấu hình này chỉ
dành cho phát triển local. Image tạo Prisma Client và build ứng dụng trước khi chạy.
Swagger: http://localhost:3000/docs. Kiểm tra trạng thái bằng `docker compose ps`
và `docker compose logs api`. Dừng bằng `docker compose down` để giữ dữ liệu;
`docker compose down -v` sẽ xóa volume dữ liệu.

Nếu muốn dùng Atlas trong Docker, thay `DATABASE_URL` ở `docker-compose.yml`
bằng URI Atlas rồi kiểm tra Network Access, cổng 27017 và TLS của Atlas.

## Kiểm tra

- npm run prisma:validate
- npm run build
- npm test -- --runInBand
- npm run test:e2e -- --runInBand
- npm run lint

E2E hiện chỉ kiểm tra JSON và định tuyến khung ứng dụng, thay kết nối Prisma
bằng mock; chưa kiểm tra nghiệp vụ hay database thật.

## Kế hoạch hoàn thành bài tập

Pha 1: triển khai các API trên, Guard xác thực/phân quyền, DTO, kiểm thử nghiệp vụ,
Swagger cho từng API, dữ liệu mẫu và kịch bản kiểm thử tải Kaggle CPU.
Giữ repository GitHub công khai và commit theo từng thay đổi có ý nghĩa.

Pha 2: đo baseline trước, xác định vấn đề thực tế rồi mới chọn cải tiến.
Đánh giá trước/sau trên cùng cấu hình Kaggle CPU, cùng dữ liệu và kịch bản tải;
lưu cấu hình CPU/RAM, throughput, p50/p95/p99, tỷ lệ lỗi và mức dùng tài nguyên.
Hiện chưa có kết quả đo hoặc tuyên bố cải thiện hiệu năng.
