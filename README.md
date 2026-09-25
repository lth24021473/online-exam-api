# Online Exam API

Backend thi trắc nghiệm trực tuyến, sử dụng NestJS, TypeScript, Prisma và MongoDB.
Tên package và Docker Compose: online-exam-api.s

## Đăng ký tài khoản

`POST /api/v1/auth/register`

```json
{
  "fullName": "Nguyen Van An",
  "email": "student@example.com",
  "password": "Student123"
}
```

- Họ tên được bỏ khoảng trắng hai đầu, bắt buộc có nội dung và tối đa 100 ký tự.
- Email hợp lệ, được bỏ khoảng trắng hai đầu và chuyển thành chữ thường ở cả đăng ký và đăng nhập.
- Mật khẩu có ít nhất 6 ký tự, tối đa 72 byte UTF-8 theo giới hạn bcrypt.
- Tài khoản mới mặc định có quyền `STUDENT`; không nhận trường `role` từ client.
- Thành công trả HTTP `201` với `{ "accessToken": "...", "user": { ... } }`, không chứa mật khẩu hoặc `passwordHash`.
- Dữ liệu không hợp lệ trả `400`; email đã đăng ký trả `409`.

Sau khi đăng ký, có thể dùng token ngay hoặc đăng nhập qua `POST /api/v1/auth/login` với email và mật khẩu. Xem Swagger tại `/docs`.

## Đăng xuất

Gọi `POST /api/v1/auth/logout` với header `Authorization: Bearer <accessToken>`, không cần body.

- Thành công trả `204 No Content`. Client xóa token đang lưu sau khi nhận phản hồi thành công.
- Token thiếu, sai, hết hạn hoặc đã đăng xuất trả `401 Unauthorized`.
- Chỉ token hiện tại bị thu hồi; token từ lần đăng nhập khác vẫn hoạt động. Mỗi token mới có `jti` riêng.
- Hash SHA-256 của token được lưu trong collection `RevokedToken` trên MongoDB nên việc thu hồi vẫn có hiệu lực sau khi server khởi động lại.
- Các API cần đăng nhập phải dùng `@UseGuards(JwtAuthGuard)` và module chứa chúng phải import `AuthModule`; guard kiểm tra chữ ký, hạn dùng và trạng thái thu hồi.

Sau khi cập nhật mã, chạy `npm run prisma:generate` và `npx prisma db push` để đồng bộ schema với MongoDB. Đặt `JWT_EXPIRES_IN` theo số giây, ví dụ `86400`. Không tự động đồng bộ database khi khởi động ứng dụng.

Các bản ghi thu hồi có thể xóa khi `expiresAt` đã qua (token khi đó bị guard từ chối do hết hạn). Hiện chưa có tác vụ dọn dẹp tự động.

## API tài khoản và phân quyền

`GET /api/v1/users/me` yêu cầu `Authorization: Bearer <accessToken>`. Guard kiểm tra chữ ký HS256, hạn dùng, claims và trạng thái thu hồi, sau đó gắn `{ id, email, role }` vào `request.user`. Endpoint lấy tài khoản theo ID đã xác thực, không trả `passwordHash`; tài khoản đã bị xóa trả `401`.

### Kiểm tra Swagger

1. Chạy `npm run start:dev`, mở `http://localhost:3000/docs` (đổi cổng nếu cấu hình PORT khác).
2. Chưa Authorize: gọi `GET /api/v1/users/me`, mong đợi `401`.
3. Gọi `POST /api/v1/auth/login`. Nếu đã chạy seed, dùng `student@example.com` / `Student123`, hoặc `manager@example.com` / `Manager123`.
4. Sao chép `accessToken`, chọn **Authorize**, chỉ dán token (không thêm `Bearer`). Gọi `/users/me`: `200`, đúng ID/email/role và không có `passwordHash`.
5. Logout trong hộp Authorize, nhập `invalid`: `/users/me` trả `401`. Để kiểm tra hết hạn, trong môi trường thử nghiệm đặt `JWT_EXPIRES_IN=1`, khởi động lại, đăng nhập lấy token mới, chờ hơn 1 giây rồi gọi `/users/me`: `401`. Khôi phục thời hạn sau khi thử.

### Bàn giao cho nhóm đề thi và lượt làm

Module chức năng import `AuthModule` từ `src/auth/auth.module`. `AuthModule` export `AuthSecurityModule` để dùng chung cấu hình JWT, hai Guard và dịch vụ thu hồi token; `UsersModule` dùng trực tiếp module bảo mật để tránh phụ thuộc vòng.

```ts
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';

// Đặt trên controller hoặc handler. JwtAuthGuard phải chạy trước RolesGuard.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.EXAM_MANAGER) // API quản lý đề thi

// API bắt đầu/nộp lượt làm:
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.STUDENT)

// API dùng chung: @Roles(Role.STUDENT, Role.EXAM_MANAGER)
// Trong handler: @Req() request: AuthenticatedRequest
// ID chủ sở hữu: request.user.id
```

- Thiếu/sai/hết hạn/thu hồi token: `401`. Đã xác thực nhưng sai quyền: `403`.
- Metadata `@Roles` trên handler ưu tiên hơn controller. Không khai báo role (hoặc danh sách rỗng) thì RolesGuard cho mọi người đã xác thực đi qua.
- Role lấy từ JWT đã xác minh; đổi role trong database có hiệu lực với token mới. Token cũ giữ role tới khi hết hạn hoặc bị thu hồi.
- Nhóm đề thi kiểm tra thêm `exam.managerId === request.user.id`; nhóm lượt làm kiểm tra `attempt.userId === request.user.id`. RolesGuard chỉ kiểm tra loại tài khoản, không thay kiểm tra quyền sở hữu tài nguyên.
- Test HTTP nằm trong `src/auth/auth.spec.ts`; dùng repository giả lập để kiểm tra lỗi token, tài khoản bị xóa, dữ liệu công khai và hai chiều phân quyền. Chạy `npm test -- --runInBand` và `npm run test:e2e -- --runInBand`.
