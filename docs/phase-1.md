# Pha 1 — Online Exam System

## Phạm vi ba thành viên

| Thành viên | Phần pha 1 đã triển khai |
| --- | --- |
| Người 1 | MongoDB replica set, Prisma/schema, Docker, Auth đăng ký/đăng nhập/đăng xuất, JWT và phân quyền, ADMIN quản lý user và thu hồi JWT, tích hợp frontend, Swagger/validation, baseline Kaggle CPU, hai repo Public |
| Người 2 | CRUD đề/câu hỏi/lựa chọn, đúng một đáp án đúng, mở/đóng đề, catalog/chi tiết, Manager/ADMIN quản lý bằng UI và xem kết quả theo đề với bộ lọc/phân trang/thống kê |
| Người 3 | Bắt đầu/tiếp tục, lưu/đổi đáp án, đồng hồ deadline, nộp/chấm điểm backend, kết quả/lịch sử, hủy giữ dữ liệu, xử lý reload/mất mạng/hết giờ/nộp lặp |

Kiến trúc API: Controller → Service → Repository → Prisma → MongoDB. Model chính: User, Exam, Question, Option, Attempt, AttemptAnswer. AttemptAnswer giữ tên collection MongoDB `Answer` bằng `@@map`; CANCELLED lưu trong lịch sử, không xóa bài làm. JWT đã đăng xuất được lưu hash và hạn dùng trong RevokedToken.

Frontend thực nằm riêng tại `D:/online-exam-front`, không nằm trong backend. Các quyền: STUDENT, EXAM_MANAGER và ADMIN. Chỉ chủ đề EXAM_MANAGER hoặc ADMIN được sửa đề/xem kết quả học sinh; chỉ chủ bài STUDENT được lưu/nộp/xem bài của mình. STUDENT không nhận khóa đáp án trước khi nộp.

## Kịch bản demo

1. Chạy API/MongoDB Compose và frontend Vite. Mở Swagger `http://localhost:3000/docs` và UI `http://localhost:5173`.
2. Đăng ký STUDENT, đăng nhập; mở Cài đặt để đăng xuất. JWT cũ sau đăng xuất trả 401.
3. ADMIN vào Quản trị, xem user, đổi quyền STUDENT → EXAM_MANAGER. Token cũ bị vô hiệu hóa; user đăng nhập lại bằng quyền mới. Xóa user còn sở hữu đề/bài làm trả 409 để giữ dữ liệu.
4. EXAM_MANAGER vào Quản lý đề, tạo bản nháp, thêm/sửa/xóa câu hỏi, chọn đáp án đúng và mở đề. Mỗi câu ít nhất hai lựa chọn và đúng một đáp án đúng. Đề mở khóa chỉnh sửa nội dung.
5. STUDENT chọn đề, làm bài, đổi đáp án, reload và thử mất mạng rồi kết nối lại. Đồng hồ giữ deadline ban đầu, trạng thái lưu/lỗi/thử lại hiển thị rõ.
6. Nộp bài, xem điểm backend và lịch sử. Nộp lặp trả lại cùng kết quả. Hủy lượt khác giữ CANCELLED cùng đáp án; hết giờ chấm dữ liệu đã lưu.
7. Manager mở Kết quả học sinh: lọc trạng thái/phân trang, xem số đúng/sai/điểm và thống kê toàn đề. Bài hết giờ được chấm trước khi trả bảng.
8. Manager đóng đề: lượt mới bị chặn, bài đang làm vẫn tiếp tục sau reload và nộp được. Xóa một đề nháp có câu hỏi để chứng minh cleanup phụ thuộc.

Các giao dịch bảo vệ bắt đầu đồng thời (một bài đang làm), lưu/nộp đồng thời, mở đề/sửa câu hỏi đồng thời và đóng đề/bắt đầu lượt mới. Retry tranh chấp có giới hạn; không thay deadline khi tiếp tục.

## Kiểm chứng

API đã kiểm tra build, lint, Prisma validate, 37 test đơn vị và 99 test e2e gồm các suite MongoDB thật. Các suite Auth/Attempt/Exam dùng database riêng có hậu tố `_codex_test`; fixture dọn theo ID sở hữu, không reset database ứng dụng. Seed và migration legacy có kiểm tra tính lặp lại và bảo toàn bài/đáp án đã lưu.

Frontend:

```sh
npm run lint
npm run build
npm run test:e2e
npm run test:e2e:real
npm run test:e2e:admin-real
npm run test:e2e:manager-real
```

Ba runner real dùng API/MongoDB Docker hiện có và tài khoản/đề kiểm thử riêng; kết thúc dọn đúng fixture. Kiểm tra UI gồm Auth/ADMIN, reload, mất mạng, hết giờ, nộp lặp, hủy, CRUD đề/câu hỏi, điểm Manager và tiếp tục bài khi đóng đề.

## Baseline và nguồn công khai

[Hướng dẫn và kết quả Kaggle CPU](../benchmarks/README.md) chứa notebook, source/workload hash, runtime và summary/report thật. Cấu hình cố định: 10 VU, warmup 10s, đo 60s; 10 học sinh, một đề 20 câu × 4 lựa chọn, một bài nộp/học sinh; bốn GET có JWT. Chỉ số gồm p50/p95/p99, RPS, tỷ lệ lỗi, số request và concurrency. Giữ cùng cấu hình/workload/dataset khi so sánh pha 2.

[Backend GitHub](https://github.com/lth24021473/online-exam-api) và [frontend GitHub](https://github.com/lth24021473/online-exam-front) Public. Kiểm chứng ẩn danh bằng `npm run github:check-public`; không suy ra Public chỉ từ việc push thành công.

Khôi phục mật khẩu qua email, cập nhật hồ sơ lên server, lớp học/nhiệm vụ và tối ưu hiệu năng pha 2 nằm ngoài phạm vi pha 1. Hồ sơ/ảnh/chế độ tối hiện lưu theo tài khoản trên trình duyệt như README frontend mô tả.
