# Kế Hoạch & Danh Sách Nhiệm Vụ Triển Khai — Online Exam System
*(Tasks Roadmap: Backend & Frontend)*

Tài liệu này tổng hợp toàn bộ danh sách các module công việc và nhiệm vụ (tasks) cần thực hiện cho cả **Backend (`online-exam-api`)** và **Frontend (`online-exam-front`)**.

Hệ thống được chia thành **3 Giai đoạn (Phases)** theo thứ tự ưu tiên từ cốt lõi đến nâng cao, đi theo từng "lát cắt tính năng" (Feature Slice) để đảm bảo làm đến đâu chạy mượt mà và kiểm thử được ngay đến đó.

---

## 📊 Bảng Theo Dõi Tiến Độ Tổng Quan (Progress Tracker)

| Mã Task | Tên Nhiệm vụ | Phạm vi | Trạng thái | Ghi chú |
| :--- | :--- | :--- | :---: | :--- |
| **`TASK-01`** | **Khép kín luồng Quên / Đặt lại mật khẩu** | Backend & Frontend | ✅ **Hoàn thành** | SMTP, Token 15p, băm bcrypt, tăng `authVersion`, UI 2 bước |
| **`CORE-01`** | **Chính sách Quyền Admin: Không xóa User** | Backend & Frontend | ✅ **Hoàn thành** | Đã xóa `DELETE /admin/users/:id` khỏi Swagger, Controller & UI |
| **`TASK-02`** | **Lưu hồ sơ cá nhân lên Server & Đổi mật khẩu** | Backend & Frontend | ✅ **Hoàn thành** | `PATCH /users/me`, `POST /auth/change-password` |
| **`TASK-03`** | **Tự động gia hạn Token (Silent Refresh)** | Backend & Frontend | ✅ **Hoàn thành** | Cặp đôi AccessToken/RefreshToken, `POST /auth/refresh` |
| **`TASK-04`** | **Worker tự động chốt bài quá hạn (Cron)** | Backend & Frontend | ✅ **Hoàn thành** | `@nestjs/schedule` Cron 10s `AttemptSchedulerService`, bỏ `while(true)` ở `GET /exams/:id/results`, UI auto-submit khi hết giờ |
| **`TASK-05`** | **Tách thuật toán Chấm điểm (Strategy Pattern)** | Backend | ✅ **Hoàn thành** | `GradingStrategy` & `StandardGradingStrategy`, DI vào `AttemptsService` |
| **`TASK-06`** | **Rate Limiting & Health Check Container** | Backend & Frontend | ✅ **Hoàn thành** | Throttler chống brute-force, Terminus `/health/live`, `/health/ready` (ping MongoDB) |
| **`TASK-07`** | **Xáo trộn Đề thi và Đáp án (Shuffle Anti-cheat)** | Backend & Frontend | ⏳ *Chờ xử lý* | Random permutation mapping cho từng học sinh |
| **`TASK-08`** | **Giám sát Trình duyệt (Tab switch, Fullscreen)** | Backend & Frontend | ⏳ *Chờ xử lý* | Ghi nhận `AttemptViolation`, cảnh báo popup |
| **`TASK-09`** | **Đa dạng hóa câu hỏi (Nhiều đáp án, Đúng/Sai)** | Backend & Frontend | ⏳ *Chờ xử lý* | Enum `QuestionType`, Partial credit chấm điểm |
| **`TASK-10`** | **Công thức Toán KaTeX & Code Lập trình** | Frontend | ⏳ *Chờ xử lý* | Render LaTeX `$ ... $`, highlight cú pháp code |
| **`TASK-11`** | **Giới hạn số lượt thi (`maxAttempts`) & Mã đề** | Backend & Frontend | ⏳ *Chờ xử lý* | Chặn làm lại quá giới hạn, nhập mã code vào thi |
| **`TASK-12`** | **Tích hợp Redis Caching (Cache-Aside)** | Backend | ⏳ *Chờ xử lý* | Cache danh sách đề mở, RevokedToken Set $O(1)$ |
| **`TASK-13`** | **Upload Ảnh/Tệp lên Object Storage (Valet Key)** | Backend & Frontend | ⏳ *Chờ xử lý* | MinIO/S3 Pre-signed URL, tải ảnh trực tiếp |
| **`TASK-14`** | **Quản lý Lớp học (Classrooms & Members)** | Backend & Frontend | ⏳ *Chờ xử lý* | Mã lớp 6 ký tự, mật khẩu lớp, duyệt thành viên |
| **`TASK-15`** | **Giao Đề thi theo Lớp (Assignments & Tasks)** | Backend & Frontend | ⏳ *Chờ xử lý* | Tab Nhiệm vụ trong Profile, đề thi cô lập theo lớp |
| **`TASK-16`** | **Giám sát Phòng thi Trực tiếp (WebSocket)** | Backend & Frontend | ⏳ *Chờ xử lý* | Socket.io Live Proctoring, trạng thái realtime |
| **`TASK-17`** | **Xuất Bảng điểm Excel & Import Đề từ Word/Excel**| Backend & Frontend | ⏳ *Chờ xử lý* | `exceljs`, `mammoth` nạp nhanh 50 câu trắc nghiệm |

---

# 🚀 GIAI ĐOẠN 1: Khép kín Luồng Cốt lõi & Chuẩn hóa Hệ thống (Ưu tiên số 1)
*Mục tiêu: Xóa bỏ dữ liệu giả (`localStorage`), sửa các lỗi thiết kế hạ tầng nghiêm trọng, hoàn thiện chu trình người dùng cơ bản.*

### 📌 MODULE 1: AUTH & QUẢN LÝ TÀI KHOẢN (USER & PROFILE)

#### `TASK-01`: Khép kín luồng Quên / Đặt lại mật khẩu (Forgot & Reset Password) — [✅ ĐÃ HOÀN THÀNH]
*   ⚙️ **Backend:**
    *   Thư viện gửi mail `nodemailer` với `MailModule` và `MailService`.
    *   Model `PasswordResetToken` trong Prisma MongoDB (lưu `email`, `tokenHash`, `expiresAt`, index TTL 15 phút).
    *   API `POST /api/v1/auth/forgot-password`: Kiểm tra email, sinh token ngẫu nhiên, lưu SHA-256 hash và gửi link/mã về email người dùng (chế độ Dev in ra console nếu chưa cấu hình SMTP).
    *   API `POST /api/v1/auth/reset-password`: Xác thực token hợp lệ, băm mật khẩu mới bằng `bcrypt` (12 rounds), tăng `authVersion` để hủy toàn bộ phiên cũ trên các thiết bị khác, xóa token đã dùng (chống Replay attack).
*   🎨 **Frontend:**
    *   Trang `src/pages/ForgotPasswordPage.tsx` luồng 2 bước:
        *   Bước 1: Form nhập email $\rightarrow$ gửi yêu cầu nhận mã xác thực.
        *   Bước 2: Form nhập mã xác nhận (Token từ email), mật khẩu mới & xác nhận mật khẩu (tự động nhận token & email từ query params khi bấm link email).
    *   Cấu hình dịch thông báo lỗi tiếng Việt trong `axios.ts` và thông báo thành công xanh trên `LoginPage.tsx`.
*   ✅ **Nghiệm thu:** 44/44 Unit tests Backend pass, 15/15 Playwright Auth tests Frontend pass.

#### `CORE-01`: Chính sách Quản trị viên không có quyền xóa User — [✅ ĐÃ HOÀN THÀNH]
*   ⚙️ **Backend:** Gỡ bỏ hoàn toàn route `@Delete(':id')` trong `AdminUsersController` để xóa khỏi Swagger UI; xóa hàm `remove()` trong `UsersService` và `deleteById()` trong `UsersRepository`.
*   🎨 **Frontend:** Gỡ bỏ nút "Xóa tài khoản" và dialog xác nhận xóa trong `AdminUsersPage.tsx`, chỉ giữ lại chức năng đổi vai trò (Role assignment).
*   ✅ **Nghiệm thu:** Swagger UI không còn endpoint `DELETE`, gọi trực tiếp trả `404 Not Found`, 14/14 tests Admin Frontend pass.

#### `TASK-02`: Đồng bộ Hồ sơ cá nhân lên Server & Đổi mật khẩu chủ động — [✅ ĐÃ HOÀN THÀNH]
*   ⚙️ **Backend:**
    *   Bổ sung các trường vào model `User` trong Prisma: `workplace`, `currentResidence`, `avatar`, `cover`.
    *   Viết API `PATCH /api/v1/users/me`: Cập nhật `fullName`, `workplace`, `currentResidence` của tài khoản hiện tại.
    *   Viết API `POST /api/v1/auth/change-password`: Kiểm tra mật khẩu cũ (`bcrypt.compare`) $\rightarrow$ đổi sang mật khẩu mới $\rightarrow$ tăng `authVersion` đăng xuất phiên cũ.
*   🎨 **Frontend:**
    *   Tại `src/pages/ProfilePage.tsx`: Chuyển hàm `handleProfileSave` từ lưu `localStorage` sang gọi API `PATCH /users/me`.
    *   Tạo Modal/Form **"Đổi mật khẩu"**: Gồm 3 ô (Mật khẩu hiện tại, Mật khẩu mới, Xác nhận mật khẩu mới) gắn vào tab Chỉnh sửa tài khoản hoặc Cài đặt.
*   ✅ **Nghiệm thu:** Đổi tên/nơi làm việc ở máy tính A, đăng nhập máy tính B dữ liệu vẫn được lưu nguyên vẹn; đổi được mật khẩu chủ động an toàn; 8/8 tests ChangePassword & 4/4 tests UsersService pass.

#### `TASK-03`: Cơ chế Tự động gia hạn Token (Silent Refresh Token) — [✅ ĐÃ HOÀN THÀNH]
*   ⚙️ **Backend:**
    *   Sửa API `/auth/login` và `/auth/register`: Cấp cặp đôi `accessToken` (hạn 15 phút) và `refreshToken` (hạn 7 ngày).
    *   Tạo API `POST /api/v1/auth/refresh`: Nhận `refreshToken`, kiểm tra tính hợp lệ và cấp mới `accessToken`, `refreshToken` và `user`.
    *   `JwtAuthGuard` chủ động chặn việc dùng nhầm `refreshToken` trên các API nghiệp vụ yêu cầu `accessToken`.
*   🎨 **Frontend:**
    *   Tại `src/api/axios.ts`: Cấu hình Axios Interceptor bắt mã lỗi `401`.
    *   Tự động gọi ngầm `/auth/refresh` lấy token mới rồi gửi lại request cũ mà người dùng không hề hay biết (không bị đá văng ra login khi đang làm bài).
*   ✅ **Nghiệm thu:** Cấp cặp Access Token (15m) & Refresh Token (7d); API `POST /auth/refresh` gia hạn token tự động; JwtAuthGuard chặn lạm dụng token; 15/15 unit tests pass.

---

### 📌 MODULE 2: HẠ TẦNG THI & CHỐNG NGHẼN (EXAM CORE & RESILIENCY)

#### `TASK-04`: Tiến trình Worker tự động chốt bài thi quá hạn (Background Auto-finalizer) — [✅ ĐÃ HOÀN THÀNH]
*   ⚙️ **Backend:**
    *   Cài đặt `@nestjs/schedule` và kích hoạt `ScheduleModule.forRoot()` trong `AppModule`.
    *   Tạo service `AttemptSchedulerService` chạy Cron định kỳ mỗi 10 giây (`@Cron('*/10 * * * * *')`).
    *   Tự động quét các `Attempt` có `status = IN_PROGRESS` và `deadlineAt <= now()` (kèm index `[status, deadlineAt]`) $\rightarrow$ tự động tính điểm và chuyển sang `SUBMITTED`.
    *   **Loại bỏ hoàn toàn** vòng lặp `while(true)` chốt lười (`finalizeExpiredForExam`) trong API `GET /exams/:id/results`.
*   🎨 **Frontend:**
    *   Tại `src/pages/TakeExamPage.tsx`: Khi đồng hồ đếm ngược về `00:00:00`, khóa toàn bộ tương tác, hiển thị popup: *"Đã hết giờ làm bài! Hệ thống đang tự động thu bài và tính điểm..."*, sau đó tự động chuyển hướng sang trang kết quả `/attempts/:id/result`.
*   ✅ **Nghiệm thu:** Học sinh tắt máy/mất mạng khi hết giờ thì bài thi vẫn tự động được chấm trên server đúng từng giây; Frontend tự động khóa làm bài và điều hướng mượt mà sang trang kết quả khi hết thời gian; 8/8 tests scheduler & 134/134 unit tests pass.

#### `TASK-05`: Tách thuật toán Chấm điểm (Strategy Pattern) — [✅ ĐÃ HOÀN THÀNH]
*   ⚙️ **Backend:**
    *   Tạo interface `GradingStrategy` với phương thức `calculateScore(questions, answers, totalQuestions?)`.
    *   Cài đặt `StandardGradingStrategy` (công thức chia đều điểm hiện tại, validation 1 đáp án đúng).
    *   Inject Strategy vào `AttemptsService` thay cho đoạn code hardcode trước đây, sẵn sàng cho việc mở rộng các dạng chấm điểm khác ở Pha 2 (điểm trừ, partial credit).
*   🎨 **Frontend:** Không ảnh hưởng giao diện.
*   ✅ **Nghiệm thu:** 10/10 tests `StandardGradingStrategy`, 4/4 tests `AttemptsService - Grading Strategy Integration`, 16/16 tests `attempts.e2e-spec.ts` pass 100%.

#### `TASK-06`: Bảo vệ API với Rate Limiting & Giám sát Sức khỏe Container — [✅ ĐÃ HOÀN THÀNH]
*   ⚙️ **Backend:**
    *   Cài đặt `@nestjs/throttler`: Gắn chặn brute-force cho `/auth/login` (tối đa 5 lần/phút) và giới hạn gọi `/attempts/:id/answers/:id` (tối đa 5 lần/giây/user với custom `getUserTracker`).
    *   Cài đặt `@nestjs/terminus`: Mở route `/health/live` và `/health/ready` (ping MongoDB qua `PrismaHealthIndicator`), hỗ trợ cả route trực tiếp và route qua prefix `/api/v1/health/*`. Cập nhật healthcheck container trong `docker-compose.yml`.
*   🎨 **Frontend:**
    *   Bắt lỗi `HTTP 429 Too Many Requests` trong Axios interceptor và hiển thị thông báo tiếng Việt: *"Bạn đang thao tác quá nhanh, vui lòng thử lại sau vài giây!"*.
*   ✅ **Nghiệm thu:** 3/3 tests `health.controller.spec.ts`, 7/7 tests `health-and-throttler.e2e-spec.ts` pass, 12/12 Playwright tests `axios-client.spec.ts` pass, toàn bộ 151 unit tests và 81 e2e tests backend pass 100%.

---

# 🛡️ GIAI ĐOẠN 2: Tối ưu Hiệu năng, Mở rộng Đề & Chống Gian lận (Pha 2)
*Mục tiêu: Đủ sức gánh hàng nghìn thí sinh thi đồng thời và tổ chức thi nghiêm túc.*

### 📌 MODULE 3: CHỐNG GIAN LẬN & TRẢI NGHIỆM LÀM BÀI

#### `TASK-07`: Xáo trộn Đề thi và Đáp án (Shuffle Anti-cheat)
*   ⚙️ **Backend:**
    *   Khi học sinh bắt đầu làm bài (`POST /exams/:id/attempts`): Tạo bản sao thứ tự câu hỏi và thứ tự đáp án (A, B, C, D) đã được xáo ngẫu nhiên riêng cho lượt làm bài đó.
    *   Lưu bản đồ hoán vị (shuffled mapping) vào `Attempt` để lúc chấm điểm quy về đúng đáp án gốc.
*   🎨 **Frontend:**
    *   Hiển thị danh sách câu hỏi và lựa chọn theo đúng thứ tự xáo trộn mà backend trả về.
*   ✅ **Nghiệm thu:** Hai học sinh cùng mở 1 đề thi thì câu số 1 và vị trí các đáp án của 2 người hoàn toàn khác nhau.

#### `TASK-08`: Cơ chế Giám sát Gian lận trên Trình duyệt (Browser Anti-cheat)
*   ⚙️ **Backend:**
    *   Thêm vào `Attempt`: `violationCount` (Int, mặc định 0) và lưu bảng log vi phạm `AttemptViolation`.
    *   Tạo API `POST /attempts/:id/violations`: Nhận loại vi phạm (chuyển tab, thoát fullscreen, mở DevTools). Nếu vượt quá số lần cho phép (`maxViolations`) $\rightarrow$ tự động thu bài và đánh dấu `terminatedReason = 'EXCEEDED_VIOLATIONS'`.
*   🎨 **Frontend (`TakeExamPage.tsx`):**
    *   Yêu cầu chế độ Toàn màn hình (**Fullscreen**) trước khi bấm bắt đầu làm bài.
    *   Lắng nghe sự kiện `visibilitychange`, `window.onblur` và phím tắt mở DevTools (F12, Ctrl+Shift+I).
    *   Bật popup cảnh báo giật cấp: *"Cảnh báo: Bạn vừa rời khỏi màn hình thi (Lần 1/3). Nếu tiếp tục vi phạm, bài thi sẽ bị thu hồi!"*.
*   ✅ **Nghiệm thu:** Học sinh nhảy tab sang Google tìm kiếm sẽ bị hệ thống ghi vết và cảnh báo trực tiếp.

---

### 📌 MODULE 4: ĐA DẠNG CÂU HỎI & NỘI DUNG ĐA PHƯƠNG TIỆN

#### `TASK-09`: Đa dạng hóa loại câu hỏi (Nhiều đáp án, Đúng/Sai)
*   ⚙️ **Backend:**
    *   Thêm enum `QuestionType`: `SINGLE_CHOICE`, `MULTIPLE_CHOICE`, `TRUE_FALSE`.
    *   Cập nhật `GradingStrategy` cho dạng nhiều đáp án: Tính điểm theo tỷ lệ số ý đúng đã chọn (Partial Credit).
*   🎨 **Frontend:**
    *   **Soạn đề (`ManagerQuestionForm.tsx`):** Thêm dropdown chọn Loại câu hỏi; cho phép tích chọn nhiều đáp án đúng cho `MULTIPLE_CHOICE`.
    *   **Làm bài (`TakeExamPage.tsx`):** Hiển thị Checkbox hình vuông cho câu nhiều đáp án đúng; Radio hình tròn cho câu 1 đáp án; nút gạt cho câu Đúng/Sai.
*   ✅ **Nghiệm thu:** Tạo và làm được đề thi kết hợp cả trắc nghiệm đơn, trắc nghiệm nhiều lựa chọn và Đúng/Sai.

#### `TASK-10`: Hỗ trợ Công thức Toán học LaTeX & Code Lập trình
*   ⚙️ **Backend:**
    *   Cho phép lưu chuỗi định dạng Markdown và công thức LaTeX trong trường `Question.content` và `Option.content`.
*   🎨 **Frontend:**
    *   Tích hợp thư viện **KaTeX** (`katex`) để tự động render các biểu thức toán học nằm giữa cặp ký tự `$ ... $` hoặc `$$ ... $$` (ví dụ: `$\sqrt{x^2 + y^2}$`).
    *   Tích hợp thư viện highlight code (`prismjs`) hiển thị các đoạn mã nguồn có màu cú pháp rõ ràng.
*   ✅ **Nghiệm thu:** Đề thi toán, lý, hóa và lập trình hiển thị công thức và code chuyên nghiệp, không bị vỡ giao diện.

#### `TASK-11`: Cấu hình Giới hạn Lượt thi & Khung giờ đóng mở đề
*   ⚙️ **Backend:**
    *   Bổ sung trường vào `Exam`: `maxAttempts` (Int, mặc định 1), `opensAt`, `closesAt`.
    *   Khi gọi `POST /exams/:id/attempts`: Kiểm tra nếu số bài thi của user $\ge$ `maxAttempts` $\rightarrow$ chặn (`403 Forbidden`). Kiểm tra khung giờ thi hợp lệ.
*   🎨 **Frontend:**
    *   Giao diện tạo đề: Thêm ô nhập "Số lần thi tối đa" và khung giờ mở/đóng.
    *   Giao diện chi tiết đề: Hiển thị số lượt thi còn lại của học sinh, nếu hết lượt thì vô hiệu hóa nút vào thi.
*   ✅ **Nghiệm thu:** Học sinh thi đủ số lần không thể vào thi lại; đề chưa mở hoặc đã quá giờ đóng không thể bắt đầu bài làm mới.

---

### 📌 MODULE 5: HẠ TẦNG ĐỆM REDIS & LƯU TRỮ TỆP

#### `TASK-12`: Tích hợp Redis Caching (Cache-Aside Pattern)
*   ⚙️ **Backend:**
    *   Thêm service `redis:7-alpine` vào `docker-compose.yml`.
    *   Cấu hình `Cache-Aside` cho đề thi: Danh sách đề thi đã `PUBLISHED` được lưu trên Redis. Khi Manager sửa/đóng đề thì tự động xóa cache (`DEL exam:{id}`).
    *   Chuyển danh sách `RevokedToken` từ MongoDB sang Redis Set để kiểm tra token trong $O(1)$.
*   🎨 **Frontend:** Không ảnh hưởng giao diện (tốc độ tải đề nhanh hơn rõ rệt).
*   ✅ **Nghiệm thu:** Tải đề thi không còn tốn I/O của MongoDB; kiểm tra token đăng xuất tức thì dưới 1ms.

#### `TASK-13`: Upload Tệp & Ảnh lên Object Storage (Valet Key Pattern)
*   ⚙️ **Backend:**
    *   Cấu hình MinIO (hoặc S3) trên Docker.
    *   Viết API `POST /api/v1/media/presigned-url`: Sinh đường dẫn upload có chữ ký tạm thời (Pre-signed URL).
*   🎨 **Frontend:**
    *   Component upload ảnh (Avatar, Ảnh câu hỏi): Gửi file trực tiếp từ trình duyệt lên MinIO/S3 bằng Pre-signed URL, không gửi file nặng qua API NestJS.
*   ✅ **Nghiệm thu:** Upload được avatar và ảnh câu hỏi mượt mà, lưu trữ tập trung trên Object Storage.

---

# 🏫 GIAI ĐOẠN 3: Lớp học (LMS), Giám sát Realtime & Mở rộng (Pha 3)
*Mục tiêu: Hoàn thiện hệ sinh thái đào tạo toàn diện, phục vụ kỳ thi lớn.*

### 📌 MODULE 6: QUẢN LÝ LỚP HỌC & GIAO BÀI (CLASSROOMS & LMS)

#### `TASK-14`: Quản lý Lớp học (Classrooms & Members)
*   ⚙️ **Backend:**
    *   Tạo model `Classroom` (Tên, Mã `code` 6 ký tự, mật khẩu lớp, `managerId`).
    *   Tạo model `ClassroomMember` (liên kết `userId` và `classroomId`).
    *   APIs: Tạo lớp, Lấy danh sách lớp, Tham gia lớp bằng code + mật khẩu, Rời lớp, Loại học sinh khỏi lớp.
*   🎨 **Frontend:**
    *   Trang `/classes` và `/classes/:classId`:
        *   Giáo viên: Có nút "Tạo lớp học mới", quản lý danh sách học sinh, kick học sinh.
        *   Học sinh: Có nút "Tham gia lớp" $\rightarrow$ nhập code 6 ký tự và mật khẩu.
*   ✅ **Nghiệm thu:** Giáo viên tạo lớp gửi mã cho học sinh, học sinh nhập mã để vào lớp.

#### `TASK-15`: Giao Đề thi theo Lớp học (Assignments & Tasks)
*   ⚙️ **Backend:**
    *   Liên kết `Exam` với `classroomId` (nếu null là đề công khai, có ID là đề nội bộ lớp).
    *   Phân quyền: Chỉ học sinh là thành viên lớp mới có quyền truy cập và làm đề thi của lớp đó.
*   🎨 **Frontend:**
    *   Trang chi tiết lớp: Hiển thị danh sách đề thi riêng của lớp.
    *   Trang Dashboard/Hồ sơ: Hiển thị danh sách nhiệm vụ bài thi được giao kèm deadline.
*   ✅ **Nghiệm thu:** Đề thi được bảo mật theo từng lớp, học sinh bên ngoài không thể truy cập đề lớp khác.

---

### 📌 MODULE 7: GIÁM SÁT REALTIME & CÔNG CỤ NHẬP/XUẤT

#### `TASK-16`: Giám sát Phòng thi Trực tiếp (Live Proctoring WebSocket)
*   ⚙️ **Backend:**
    *   Tích hợp `@nestjs/websockets` (Socket.io) tạo `ExamProctorGateway`.
    *   Client thi gửi tín hiệu định kỳ (Heartbeat); Gateway đẩy thông tin trạng thái về phòng giám thị: online/offline, số câu đã tick, cảnh báo vi phạm.
*   🎨 **Frontend:**
    *   Xây dựng màn hình Giám thị `/manage/exams/:examId/live`:
        *   Hiển thị danh sách học sinh theo dạng lưới thẻ (Grid).
        *   Đèn báo trạng thái: Xanh (Đang thi) / Đỏ (Mất mạng) / Vàng nhấp nháy (Vi phạm chuyển tab).
        *   Nút bấm: "Đình chỉ thi" hoặc "Thu bài ngay lập tức".
*   ✅ **Nghiệm thu:** Giám thị thấy trực tiếp màn hình thi của cả lớp cập nhật theo thời gian thực mà không cần F5.

#### `TASK-17`: Xuất Bảng điểm & Nhập Đề thi từ Excel/Word
*   ⚙️ **Backend:**
    *   Cài đặt thư viện `exceljs` và `mammoth` (đọc file `.docx`).
    *   API `GET /exams/:id/export-results`: Xuất toàn bộ kết quả học sinh ra file `.xlsx`.
    *   API `POST /exams/:id/import-questions`: Đọc file Excel/Word mẫu, tự động trích xuất nội dung câu hỏi/đáp án đẩy vào bản nháp.
*   🎨 **Frontend:**
    *   Tại trang kết quả đề thi: Nút **"Xuất Excel"** tải về bảng điểm hoàn chỉnh.
    *   Tại trang tạo đề thi: Khung kéo thả file Excel/Word mẫu để nạp nhanh 50 câu hỏi vào form chỉ với 1 click.
*   ✅ **Nghiệm thu:** Giáo viên không phải nhập tay 50 câu hỏi và dễ dàng tải bảng điểm nộp cho nhà trường.

