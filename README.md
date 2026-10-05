# Online Exam API

Backend thi trắc nghiệm trực tuyến, sử dụng NestJS, TypeScript, Prisma và MongoDB.
Tên package và Docker Compose: online-exam-api.

Frontend hỗ trợ ba quyền `STUDENT`, `EXAM_MANAGER`, `ADMIN`; quản lý tài khoản dùng các API `/api/v1/admin/users`.

JWT được kiểm tra với tài khoản hiện tại ở mọi API cần đăng nhập. Đổi quyền tăng `User.authVersion` và vô hiệu hóa mọi token cũ; xóa tài khoản khiến token trả `401`. Gán lại quyền hiện tại không vô hiệu hóa phiên. Tài khoản và token cũ chưa có phiên bản được xem là phiên bản `0`; trường còn thiếu được khởi tạo khi đổi quyền. Sau khi lấy schema mới, chạy `npm run prisma:generate` và build lại backend. Xóa tài khoản còn sở hữu đề thi hoặc lượt làm bài trả `409` để giữ dữ liệu liên quan.

## Chạy backend và frontend

Tạo `.env` từ `.env.example`, đặt `JWT_SECRET` riêng và MongoDB có replica set. Không đưa `.env` lên Git. MongoDB trong Compose dùng replica set `rs0` và giữ dữ liệu trong volume hiện có.

```sh
npm ci
npm run prisma:generate
npm run build
docker compose up -d --build
```

API: `http://localhost:3000/api/v1`. Swagger: `http://localhost:3000/docs`.
Để đồng bộ collection/index sau khi cập nhật schema, dùng `docker compose exec api npx prisma db push --skip-generate` trên database dự định dùng; nếu còn dữ liệu schema cũ, sao lưu và chạy script `prisma:migrate-options` theo hướng dẫn script trước.

Trong thư mục frontend riêng `D:/online-exam-front`, cấu hình `VITE_API_URL=http://localhost:3000/api/v1`, rồi `npm ci` và `npm run dev`. Mở `http://localhost:5173`. Mã frontend không nằm trong backend.

## Auth, phân quyền và ADMIN

| Endpoint (sau `/api/v1`) | Chức năng | Quyền |
| --- | --- | --- |
| `POST /auth/register` | Tạo tài khoản STUDENT, mật khẩu băm bcrypt | Khách |
| `POST /auth/login` | Trả JWT và thông tin tài khoản an toàn | Khách |
| `POST /auth/logout` | Thu hồi JWT đang dùng, trả 204 | Đã đăng nhập |
| `GET /users/me` | Thông tin tài khoản hiện tại | Đã đăng nhập |
| `GET /admin/users` | Danh sách tài khoản | ADMIN |
| `GET /admin/users/:id` | Chi tiết tài khoản | ADMIN |
| `PATCH /admin/users/:id/role` | Đổi quyền với `{ "role": "STUDENT" }` (hoặc EXAM_MANAGER/ADMIN) | ADMIN |
| `DELETE /admin/users/:id` | Xóa tài khoản không còn dữ liệu phụ thuộc | ADMIN |

Đăng ký không cho người dùng tự cấp quyền. Guard kiểm tra tài khoản hiện tại, phiên bản quyền và danh sách JWT bị thu hồi tại mọi request cần xác thực. Đăng xuất lưu **hash** JWT và thời hạn vào MongoDB, nên khởi động lại API không khôi phục token đã thu hồi. Đăng nhập lần khác tạo JWT mới. Đổi quyền rồi đổi lại không khôi phục JWT cũ. ID ADMIN không hợp lệ trả 400; sai quyền trả 403; tài khoản/token không còn hợp lệ trả 401.

Frontend có đăng ký/đăng nhập, kiểm tra phiên khi tải lại, điều hướng theo cả ba quyền, đăng xuất trong **Cài đặt**, và quản lý tài khoản tại `/admin/users`. Đổi quyền/xóa chính mình kết thúc phiên tương ứng; response trễ từ phiên trước không xóa phiên mới. Mất mạng khi kiểm tra phiên hiển thị lỗi/thử lại.

## Quản lý đề thi, câu hỏi và kết quả

Luồng đầy đủ Controller → Service → Repository → Prisma → MongoDB được dùng cho Auth/User/ADMIN, Exam/Question và Attempt. Schema gồm User, Exam, Question, Option, Attempt, AttemptAnswer (collection MongoDB `Answer`) và RevokedToken; hủy bài giữ trạng thái CANCELLED cùng đáp án.

| Endpoint sau `/api/v1` | Chức năng | Quyền |
| --- | --- | --- |
| `POST /exams` | Tạo đề DRAFT | EXAM_MANAGER, ADMIN |
| `GET /exams`, `GET /exams/:id` | Danh sách/chi tiết theo quyền; STUDENT chỉ thấy đề mở và không thấy đáp án đúng | Đã đăng nhập |
| `PATCH /exams/:id`, `DELETE /exams/:id` | Sửa/xóa bản nháp; xóa cả câu hỏi/lựa chọn, từ chối dữ liệu đã có bài làm | Chủ đề, ADMIN |
| `PUT /exams/:id/publish`, `PUT /exams/:id/close` | Mở/đóng đề | Chủ đề, ADMIN |
| `POST /exams/:id/questions` | Thêm câu hỏi và các lựa chọn | Chủ đề, ADMIN |
| `PATCH /exams/:id/questions/:questionId`, `DELETE /exams/:id/questions/:questionId` | Sửa/xóa câu hỏi nháp | Chủ đề, ADMIN |
| `GET /exams/:id/results` | Kết quả học sinh, lọc trạng thái, phân trang, thống kê toàn đề | Chủ đề, ADMIN |

Nội dung đề/câu hỏi chỉ sửa khi DRAFT. Mở đề yêu cầu ít nhất một câu hỏi, mỗi câu ít nhất hai lựa chọn có nội dung và đúng một lựa chọn đúng. Khóa giao dịch ngăn sửa câu hỏi đồng thời với publish. Đóng đề ngăn lượt làm mới; học sinh đang làm vẫn được tiếp tục/lưu/nộp bài.

API results nhận `page` mặc định 1, `limit` mặc định 10 (tối đa 100), `status` tùy chọn IN_PROGRESS/SUBMITTED/CANCELLED; trả `{ exam, data, meta, summary }`. Điểm/số đúng/sai lấy từ dữ liệu backend đã chấm. Thống kê summary tính trên toàn đề, độc lập bộ lọc/trang; chưa có bài nộp thì điểm trung bình/cao nhất/thấp nhất là null. Bài hết giờ được chốt/chấm trước khi người quản lý xem kết quả. ID/query không hợp lệ trả 400; sai quyền hoặc không sở hữu đề trả 403.

Frontend có các trang `/manage/exams`, `/manage/exams/:examId` và `/manage/exams/:examId/results`; EXAM_MANAGER/ADMIN vào **Quản lý đề** trên thanh điều hướng. Chi tiết luồng demo và kiểm chứng: [Pha 1](docs/phase-1.md).

## Luồng làm bài của học sinh

API start/resume, lưu/đổi đáp án, submit idempotent, cancel, kết quả và lịch sử đều yêu cầu STUDENT và đúng chủ bài làm. Điểm theo thang 10 được chấm ở backend. Giao dịch và retry có backoff bảo vệ lưu đáp án/nộp bài đồng thời; bắt đầu đồng thời chỉ tạo một lượt đang làm cho học sinh/đề. Hết giờ chấm theo đáp án backend đã lưu và không kéo dài deadline khi reload.

Frontend hiển thị đồng hồ từ `deadlineAt`, trạng thái lưu/lỗi/thử lại, giữ đáp án chờ khi mất mạng, tiếp tục sau reload, xác nhận nộp/hủy và lịch sử CANCELLED. Xem README frontend để chạy `test:e2e:real`, `test:e2e:admin-real` và `test:e2e:manager-real` trên Docker API/MongoDB hiện có.

## Baseline pha 1 và GitHub public

Xem [hướng dẫn benchmark](benchmarks/README.md), [notebook Kaggle CPU](benchmarks/kaggle-baseline.ipynb) và thư mục [kết quả đo](benchmarks/results/). Bộ đo giữ cố định dataset, 10 VU, warmup 10 giây, đo 60 giây và bốn GET có JWT. Báo cáo gồm p50/p95/p99, RPS, tỷ lệ lỗi, tổng request và số người dùng đồng thời; login/setup/warmup không tính vào số đo. Kết quả local được ghi riêng, không coi là baseline Kaggle.

Hai repo cần truy cập được khi **không đăng nhập**: [online-exam-api](https://github.com/lth24021473/online-exam-api) và [online-exam-front](https://github.com/lth24021473/online-exam-front). Nếu GitHub/API trả 404 ẩn danh, chưa đạt xác nhận public. Việc kiểm tra code ở máy hoặc push thành công bằng tài khoản có quyền không chứng minh repo public. Chỉ công khai sau khi chủ repo kiểm tra không có secrets trong lịch sử Git.

Chạy `npm run github:check-public` để kiểm tra lại bằng GitHub REST không có token/cookie. Kết quả lưu ở `benchmarks/results/github-public-check.json`; script trả mã lỗi nếu chưa xác minh được cả hai repo public.
