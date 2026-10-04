# Online Exam API

Backend thi trắc nghiệm trực tuyến, sử dụng NestJS, TypeScript, Prisma và MongoDB.
Tên package và Docker Compose: online-exam-api.

Frontend hỗ trợ ba quyền `STUDENT`, `EXAM_MANAGER`, `ADMIN`; quản lý tài khoản dùng các API `/api/v1/admin/users`.

JWT được kiểm tra với tài khoản hiện tại ở mọi API cần đăng nhập. Đổi quyền tăng `User.authVersion` và vô hiệu hóa mọi token cũ; xóa tài khoản khiến token trả `401`. Gán lại quyền hiện tại không vô hiệu hóa phiên. Tài khoản và token cũ chưa có phiên bản được xem là phiên bản `0`; trường còn thiếu được khởi tạo khi đổi quyền. Sau khi lấy schema mới, chạy `npm run prisma:generate` và build lại backend. Xóa tài khoản còn sở hữu đề thi hoặc lượt làm bài trả `409` để giữ dữ liệu liên quan.
