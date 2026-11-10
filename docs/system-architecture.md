# Kiến Trúc Hệ Thống & Luồng Dự Án — Online Exam System

Tài liệu này tổng hợp toàn bộ kiến trúc hệ thống, luồng nghiệp vụ end-to-end của nền tảng thi trắc nghiệm trực tuyến (**Online Exam System**), bao gồm các phân hệ **đã hoàn thiện** (Core & Pha 1/Mở rộng) và các phân hệ **dự kiến xây dựng bổ sung** (Pha 2 & Tối ưu hóa).

---

## 1. Sơ Đồ Kiến Trúc Tổng Thể (System Architecture Diagram)

Hệ thống được thiết kế theo mô hình **Phân tầng (Layered Architecture)** kết hợp với **Domain-Driven Design (DDD)** hướng module trong NestJS, dữ liệu được quản lý giao dịch an toàn (ACID Transactions) trên MongoDB Replica Set.

```mermaid
flowchart TB
    %% STYLING (BLACK & WHITE / MONOCHROME)
    classDef clientStyle fill:#fdfdfd,stroke:#111111,stroke-width:2px,color:#000000;
    classDef existingStyle fill:#ffffff,stroke:#000000,stroke-width:2px,color:#000000;
    classDef plannedStyle fill:#ffffff,stroke:#222222,stroke-width:2px,stroke-dasharray: 6 4,color:#111111;
    classDef dbStyle fill:#efefef,stroke:#000000,stroke-width:2px,color:#000000;
    classDef extStyle fill:#f7f7f7,stroke:#222222,stroke-width:2px,color:#000000;
    classDef filterStyle fill:#f2f2f2,stroke:#000000,stroke-width:1.5px,color:#000000;

    %% CLIENT TIER
    subgraph ClientTier["TẦNG GIAO DIỆN (Frontend - React + TypeScript + Vite)"]
        direction LR
        UI_Student["Student UI<br/>(Làm bài thi, Xem đáp án,<br/>Lịch sử thi, Lớp học)"]:::clientStyle
        UI_Manager["Exam Manager UI<br/>(Soạn đề, Quản lý lớp,<br/>Leaderboard, Thống kê)"]:::clientStyle
        UI_Admin["Admin UI<br/>(Quản trị tài khoản,<br/>Cấp/Đổi quyền Role)"]:::clientStyle
        UI_Proctor["Client Proctoring Agent<br/>(Phát hiện Tab Switch, DevTools,<br/>Webcam Face Tracking)"]:::clientStyle
    end

    %% SECURITY GATEWAY
    subgraph SecurityLayer["CỔNG BẢO MẬT & TIỀN XỬ LÝ (NestJS Pipeline)"]
        direction TB
        CORS["CORS & Helmet Middleware"]:::filterStyle
        Pipes["ValidationPipe & ParseObjectIdPipe"]:::filterStyle
        JwtGuard["JwtAuthGuard (Xác thực Token & Blacklist)"]:::filterStyle
        RolesGuard["RolesGuard (RBAC: STUDENT, EXAM_MANAGER, ADMIN)"]:::filterStyle
        AuthVerGuard["AuthVersion Validation (Hủy phiên khi đổi quyền)"]:::filterStyle
        
        CORS --> Pipes --> JwtGuard --> RolesGuard --> AuthVerGuard
    end

    ClientTier -->|"HTTPS / REST API"| SecurityLayer

    %% BACKEND APPLICATION TIER
    subgraph BackendTier["TẦNG NGHIỆP VỤ BACKEND (NestJS Application Server)"]
        
        subgraph ImplementedModules["Các Module Hiện Tại (Đã Hoàn Thiện - Nét liền)"]
            AuthMod["AuthModule & UsersModule<br/>• Đăng ký / Đăng nhập (Bcrypt, JWT)<br/>• Thu hồi token / Đăng xuất an toàn<br/>• Quản lý profile (Avatar, Bio, Cover)<br/>• Admin quản trị tài khoản & Role"]:::existingStyle
            
            ClassroomMod["ClassroomsModule<br/>• Tạo lớp & Sinh mã Code 6 ký tự<br/>• Mật khẩu lớp & Tham gia lớp<br/>• Quản lý thành viên (Kick học sinh)<br/>• Cô lập đề thi lớp vs Đề công khai"]:::existingStyle
            
            ExamMod["ExamsModule & QuestionsModule<br/>• Soạn đề nháp (DRAFT)<br/>• Câu hỏi & Lựa chọn (1 đáp án đúng)<br/>• Mở đề (PUBLISHED) & Khóa (CLOSED)<br/>• Mở lại đề (REOPEN) bảo lưu lịch sử<br/>• Lịch thi (opensAt, closesAt, Hard Cutoff)<br/>• Giới hạn số lượt làm (maxAttempts)"]:::existingStyle
            
            AttemptMod["AttemptsModule<br/>• Bắt đầu / Tiếp tục thi (Idempotent)<br/>• Realtime Auto-save (answerVersion)<br/>• Chấm điểm tự động tại Backend (Thang 10)<br/>• Tự động thu bài khi hết hạn deadlineAt<br/>• Ghi nhận gian lận (AttemptViolation)"]:::existingStyle
            
            ResultMod["Analytics & Leaderboard<br/>• Kết quả học sinh (Lọc, phân trang)<br/>• Thống kê toàn đề (Avg, Min, Max)<br/>• Bảng xếp hạng Top 3 Podium"]:::existingStyle
        end

        subgraph PlannedModules["Các Module Sẽ Xây Dựng Bổ Sung (Roadmap - Nét đứt)"]
            MailMod["MailModule (Đang tích hợp)<br/>• Gửi email xác thực tài khoản<br/>• Quên mật khẩu & Token Reset 15 phút"]:::plannedStyle
            
            CacheMod["CacheModule (Redis)<br/>• Cache danh mục đề & Profile<br/>• Blacklist Token tức thì trên RAM<br/>• Tăng RPS, giảm tải p95/p99"]:::plannedStyle
            
            QueueMod["Queue Worker (BullMQ)<br/>• Xử lý chấm điểm kỳ thi lớn<br/>• Gửi email hàng loạt bất đồng bộ<br/>• Auto-close các bài thi quá hạn"]:::plannedStyle
            
            ShuffleMod["Smart Question Bank & Shuffling<br/>• Xáo trộn thứ tự câu hỏi & đáp án<br/>• Ngân hàng câu hỏi dùng chung<br/>• Import/Export Excel/Word"]:::plannedStyle
            
            AIProctorMod["AI Proctoring Integration<br/>• Nhận diện khuôn mặt bằng MediaPipe<br/>• Chụp ảnh vi phạm lưu trữ Cloud"]:::plannedStyle
            
            ExportMod["Report & Export Module<br/>• Xuất bảng điểm lớp ra Excel (.xlsx)<br/>• Xuất đề thi / bài làm ra PDF"]:::plannedStyle
        end
    end

    AuthVerGuard --> ImplementedModules
    AuthVerGuard -.-> PlannedModules

    %% PERSISTENCE TIER
    subgraph PersistenceTier["TẦNG DỮ LIỆU & HẠ TẦNG PHỤ TRỢ"]
        PrismaORM["Prisma ORM (Schema & Client Engine)"]:::filterStyle
        
        MongoDB[("MongoDB 8.0 Replica Set (rs0)<br/>• Multi-document ACID Transactions<br/>• Collections: User, Classroom, Exam,<br/>  Question, Option, Attempt, Answer,<br/>  AttemptViolation, RevokedToken")]:::dbStyle
        
        RedisDB[("Redis In-Memory Database<br/>(Bổ sung - Planned)")]:::plannedStyle
        
        SMTP["SMTP Server<br/>(Resend / Gmail SMTP)"]:::extStyle
        
        CloudStorage["Cloud Object Storage<br/>(Cloudinary / AWS S3 - Planned)"]:::plannedStyle
    end

    ImplementedModules --> PrismaORM --> MongoDB
    MailMod -.-> SMTP
    CacheMod -.-> RedisDB
    QueueMod -.-> RedisDB
    AIProctorMod -.-> CloudStorage
    ShuffleMod -.-> PrismaORM
    ExportMod -.-> PrismaORM
```

---

## 2. Chi Tiết Các Luồng Nghiệp Vụ Cốt Lõi (Core Business Flows)

### 2.1. Luồng Xác Thực & Phân Quyền (Auth & RBAC Flow)

```mermaid
sequenceDiagram
    autonumber
    actor User as Người dùng
    participant Front as Frontend (React)
    participant Auth as AuthController / Service
    participant Guard as JwtAuthGuard & RolesGuard
    participant DB as MongoDB (Prisma)

    %% Đăng nhập
    Note over User, DB: 1. Đăng nhập & Tạo Token
    User->>Front: Nhập email & mật khẩu
    Front->>Auth: POST /api/v1/auth/login
    Auth->>DB: Tìm User theo email & kiểm tra bcrypt hash
    alt Mật khẩu đúng
        Auth->>Auth: Tạo JWT payload (userId, role, authVersion, jti)
        Auth-->>Front: 200 OK + { accessToken, user }
        Front->>Front: Lưu token vào LocalStorage & set AuthContext
    else Mật khẩu sai
        Auth-->>Front: 401 Unauthorized
    end

    %% Truy cập tài nguyên
    Note over User, DB: 2. Gọi API yêu cầu quyền (Ví dụ: ADMIN)
    Front->>Guard: Gửi Request kèm Header Authorization: Bearer <Token>
    Guard->>DB: Kiểm tra token hash trong RevokedToken
    Guard->>DB: Kiểm tra User tồn tại & khớp authVersion
    Guard->>Guard: So khớp quyền (Role = ADMIN?)
    alt Hợp lệ
        Guard-->>Front: Cho phép truy cập tài nguyên
    else Token bị thu hồi / authVersion sai
        Guard-->>Front: 401 Unauthorized (Frontend xóa phiên, về /login)
    else Sai vai trò
        Guard-->>Front: 403 Forbidden
    end

    %% Đăng xuất
    Note over User, DB: 3. Đăng xuất an toàn
    User->>Front: Bấm "Đăng xuất"
    Front->>Auth: POST /api/v1/auth/logout
    Auth->>DB: Lưu SHA-256 hash của Token vào RevokedToken với expiresAt
    Auth-->>Front: 204 No Content
    Front->>Front: Xóa token cục bộ, điều hướng về /login
```

---

### 2.2. Luồng Quản Lý Lớp Học & Cô Lập Đề Thi (Classrooms & Isolation Flow)

```mermaid
sequenceDiagram
    autonumber
    actor Manager as Giáo viên (EXAM_MANAGER)
    actor Student as Học sinh (STUDENT)
    participant API as ClassroomsController
    participant ExamService as ExamsService
    participant DB as MongoDB

    %% Tạo lớp
    Manager->>API: POST /classrooms (name, description, password)
    API->>API: Sinh ngẫu nhiên Code 6 ký tự duy nhất (VD: 'A9K2B1')
    API->>DB: Lưu Classroom (managerId, code, password, name)
    DB-->>API: Classroom đã tạo
    API-->>Manager: 201 Created (Kèm Mã lớp & Mật khẩu để chia sẻ)

    %% Học sinh tham gia lớp
    Student->>API: POST /classrooms/join (code, password)
    API->>DB: Tìm lớp theo code & kiểm tra mật khẩu
    API->>DB: Tạo bản ghi ClassroomMember (classroomId, studentId)
    API-->>Student: 200 OK (Tham gia thành công)

    %% Tạo đề thi riêng cho lớp
    Manager->>API: POST /exams (title, duration, classroomId = '...')
    API->>DB: Lưu Exam gắn với classroomId
    Note over API, DB: Cơ chế Strict Isolation: Đề thi này KHÔNG hiển thị ở danh mục chung (/exams)

    %% Học sinh làm đề trong lớp
    Student->>API: GET /classrooms/:id/exams
    API->>DB: Kiểm tra Student đã tham gia lớp chưa
    API->>ExamService: Lấy danh sách đề PUBLISHED của riêng lớp này
    ExamService-->>Student: 200 OK (Danh sách đề trong lớp)
```

---

### 2.3. Luồng Làm Bài Thi, Giám Sát Gian Lận & Chấm Điểm (Exam & Proctoring Flow)

```mermaid
sequenceDiagram
    autonumber
    actor Student as Học sinh
    participant Front as Frontend (Room & Proctoring)
    participant AttemptAPI as AttemptsController / Service
    participant DB as MongoDB (Giao dịch ACID)

    %% Bắt đầu làm bài
    Student->>Front: Bấm "Bắt đầu làm bài"
    Front->>AttemptAPI: POST /exams/:id/attempts
    AttemptAPI->>DB: Kiểm tra: Đề PUBLISHED, trong khung [opensAt, closesAt], lượt thi < maxAttempts
    alt Đã có bài IN_PROGRESS
        AttemptAPI-->>Front: Trả về bài thi đang chạy (Resume)
    else Tạo lượt thi mới
        AttemptAPI->>AttemptAPI: Tính deadlineAt = min(now + duration, closesAt)
        AttemptAPI->>DB: Tạo Attempt mới (status: IN_PROGRESS)
        AttemptAPI-->>Front: 201 Created + Attempt + Danh sách câu hỏi (KHÔNG CÓ ĐÁP ÁN ĐÚNG)
    end

    %% Trong lúc làm bài: Auto-save & Proctoring
    par Lưu đáp án Realtime
        Student->>Front: Chọn phương án câu X
        Front->>AttemptAPI: PUT /attempts/:id/answers/:questionId (selectedOptionIndex)
        AttemptAPI->>DB: Upsert Answer (tăng answerVersion chống xung đột)
        AttemptAPI-->>Front: 200 OK (Đã lưu)
    and Giám sát thi (Proctoring)
        Front->>Front: Phát hiện chuyển Tab / Thoát toàn màn hình
        Front->>AttemptAPI: POST /attempts/:id/violations (type: TAB_SWITCH)
        AttemptAPI->>DB: Lưu AttemptViolation & tăng violationCount
        alt violationCount >= maxViolations
            AttemptAPI->>DB: Đánh dấu terminatedReason = 'VIOLATION_LIMIT_EXCEEDED'
            AttemptAPI-->>Front: Đình chỉ bài thi, buộc nộp ngay
        else Chưa vượt ngưỡng
            AttemptAPI-->>Front: 200 OK (Cảnh báo còn lại X lần)
        end
    end

    %% Nộp bài & Chấm điểm
    alt Học sinh chủ động bấm Nộp bài HOẶC Hết giờ (deadlineAt)
        Front->>AttemptAPI: POST /attempts/:id/submit
        AttemptAPI->>DB: Mở Transaction: Khóa Attempt (chuyển sang SUBMITTED)
        AttemptAPI->>DB: Đọc toàn bộ Answer đã lưu của Attempt & Option.isCorrect
        AttemptAPI->>AttemptAPI: Tính điểm thang 10 = (correctCount / totalQuestions) * 10
        AttemptAPI->>DB: Cập nhật score, correctCount, incorrectCount, submittedAt
        DB-->>AttemptAPI: Transaction Commit thành công
        AttemptAPI-->>Front: 200 OK + Bảng điểm
        Front->>Student: Hiển thị Thẻ điểm & Đối chiếu đáp án đúng/sai/lời giải
    end
```

---

## 3. Bản Đồ Các Thành Phần Hệ Thống (Hiện Tại vs Bổ Sung)

| Phân hệ / Khối chức năng | Thành phần hiện tại (Đã hoàn thiện) | Thành phần sẽ xây dựng bổ sung (Planned / Roadmap) |
| :--- | :--- | :--- |
| **1. Xác thực & Tài khoản** | • Đăng ký, đăng nhập JWT, bcrypt hash<br/>• Thu hồi token qua `RevokedToken` MongoDB<br/>• `authVersion` vô hiệu hóa phiên tức thì khi đổi quyền<br/>• Cập nhật thông tin cá nhân: avatar, cover, workplace | • **Khôi phục mật khẩu qua Email (Forgot/Reset password)** với token dùng 1 lần (Branch `feat/1-password`)<br/>• Đăng nhập mạng xã hội (Google / Microsoft OAuth2)<br/>• Xác thực 2 lớp (2FA - OTP) |
| **2. Quản trị hệ thống (Admin)** | • Quản lý người dùng: xem danh sách, lọc<br/>• Đổi vai trò tài khoản (`STUDENT`, `EXAM_MANAGER`, `ADMIN`)<br/>• Xóa tài khoản an toàn (chặn xóa nếu có dữ liệu ràng buộc) | • Nhật ký kiểm toán hệ thống (Audit Logs)<br/>• Dashboard giám sát tài nguyên máy chủ & throughput |
| **3. Không gian Lớp học (Classrooms)** | • Tạo lớp học với mã 6 ký tự & mật khẩu riêng<br/>• Tham gia lớp học bằng code + password<br/>• Quản lý thành viên lớp, loại học sinh khỏi lớp<br/>• Phân tách đề thi lớp học & đề thi công khai | • Diễn đàn trao đổi / Thông báo nội bộ lớp học<br/>• Quản lý tài liệu học tập đính kèm lớp (File/PDF)<br/>• Hệ thống Nhiệm vụ / Bài tập có deadline (Tasks/Assignments) |
| **4. Quản lý Đề thi & Câu hỏi** | • CRUD đề thi nháp (DRAFT), câu hỏi & lựa chọn<br/>• Xuất bản đề (PUBLISHED) & Đóng đề (CLOSED)<br/>• Mở lại đề (REOPEN) bảo lưu dữ liệu đợt cũ<br/>• Khung giờ tự động (`opensAt`, `closesAt`) & Hard Cutoff<br/>• Giới hạn số lượt làm bài (`maxAttempts`) | • **Xáo trộn thứ tự câu hỏi và lựa chọn (Shuffling)** ngẫu nhiên cho từng học sinh<br/>• Ngân hàng câu hỏi dùng chung phân loại theo chủ đề/mức độ khó<br/>• Nhập/xuất đề thi hàng loạt từ file Excel/Word<br/>• Hỗ trợ dạng câu hỏi chọn nhiều đáp án, điền từ, tự luận |
| **5. Phòng thi & Giám sát (Proctoring)** | • Làm bài trực tuyến, đếm ngược tự động khóa giờ<br/>• Tự động lưu đáp án theo thời gian thực (Auto-save)<br/>• Chấm điểm tự động tại Backend, chống nộp lặp (Idempotent)<br/>• Ghi nhận các sự kiện vi phạm: `TAB_SWITCH`, `FULLSCREEN_EXIT`, `DEVTOOLS_OPEN`, `CLIPBOARD_ACTION` | • **Giám sát khuôn mặt thông minh bằng AI Client-side (MediaPipe/WebRTC)**: phát hiện quay đầu, vắng mặt, nhiều người<br/>• Chụp ảnh webcam định kỳ / khi vi phạm lưu lên Cloud Storage<br/>• Khóa phím tắt hệ thống nâng cao (Fullscreen Lock mode) |
| **6. Thống kê & Báo cáo (Analytics)** | • Bảng kết quả bài thi theo đề (lọc trạng thái, phân trang)<br/>• Thống kê tổng hợp: Điểm TB, Cao nhất, Thấp nhất, Số bài nộp<br/>• Bảng xếp hạng Top 3 Podium & Leaderboard theo điểm cao nhất | • **Xuất bảng điểm ra file Excel (.xlsx) và PDF**<br/>• Biểu đồ phổ điểm trực quan (Score Distribution Graph)<br/>• Phân tích độ khó từng câu hỏi (Item Analysis: câu nào học sinh hay làm sai nhất) |
| **7. Hạ tầng & Hiệu năng** | • NestJS + TypeScript phân tầng chuẩn<br/>• Docker Compose MongoDB Replica Set `rs0`<br/>• ACID Multi-document Transactions an toàn dữ liệu<br/>• Baseline kiểm thử tải Kaggle CPU | • **Tích hợp Redis Caching**: Cache danh sách đề, profile, blacklist token trên RAM<br/>• **Message Queue (BullMQ / RabbitMQ)**: Xử lý chấm điểm & gửi email bất đồng bộ quy mô lớn<br/>• CI/CD pipeline tự động build, test & deploy |

---

## 4. Luồng Chức Năng Bổ Sung Đang Xây Dựng: Quên Mật Khẩu Qua Email

Hiện tại phân hệ gửi mail đặt lại mật khẩu đã có cấu hình SMTP trong `.env` và đang được hoàn thiện (tương ứng với branch `feat/1-password`):

```mermaid
sequenceDiagram
    autonumber
    actor User as Người dùng quên mật khẩu
    participant Front as Frontend (/forgot-password)
    participant Auth as AuthService & MailService
    participant SMTP as SMTP Server (Resend / Gmail)
    participant DB as MongoDB

    User->>Front: Nhập email cần khôi phục
    Front->>Auth: POST /api/v1/auth/forgot-password { email }
    Auth->>DB: Tìm User theo email
    alt Email tồn tại
        Auth->>Auth: Sinh Reset Token ngẫu nhiên (hết hạn trong 15 phút)
        Auth->>DB: Lưu PasswordResetToken (hash, userId, expiresAt)
        Auth->>SMTP: Gửi email chứa đường dẫn đặt lại mật khẩu
        SMTP-->>User: Gửi email kèm link https://.../reset-password?token=...
    end
    Auth-->>Front: 200 OK (Thông báo đã gửi hướng dẫn qua email nếu email hợp lệ)

    User->>Front: Mở link trong email, nhập mật khẩu mới
    Front->>Auth: POST /api/v1/auth/reset-password { token, newPassword }
    Auth->>DB: Xác thực token hợp lệ & chưa hết hạn
    Auth->>Auth: Băm mật khẩu mới bằng bcrypt (salt 12 rounds)
    Auth->>DB: Cập nhật passwordHash & tăng authVersion (hủy toàn bộ phiên cũ)
    Auth->>DB: Xóa PasswordResetToken đã sử dụng
    Auth-->>Front: 200 OK (Đặt lại mật khẩu thành công)
    Front->>User: Điều hướng về /login với thông báo thành công
```

---

## 5. Kiến Trúc Dữ Liệu Tổng Thể (Entity Relationship Diagram - ERD)

Dưới đây là cấu trúc liên kết các thực thể trong Prisma MongoDB hiện tại và các thực thể mở rộng:

```mermaid
erDiagram
    User ||--o{ Exam : "sở hữu / quản lý"
    User ||--o{ Attempt : "thực hiện"
    User ||--o{ Classroom : "quản lý lớp"
    User ||--o{ ClassroomMember : "tham gia lớp"
    User ||--o{ PasswordResetToken : "yêu cầu reset (Planned)"

    Classroom ||--o{ ClassroomMember : "chứa thành viên"
    Classroom ||--o{ Exam : "chứa đề thi riêng"

    Exam ||--o{ Question : "gồm các câu hỏi"
    Exam ||--o{ Attempt : "có các lượt làm bài"

    Question ||--o{ Option : "chứa các phương án"
    Question ||--o{ AttemptAnswer : "được trả lời trong"

    Option ||--o{ AttemptAnswer : "được chọn bởi"

    Attempt ||--o{ AttemptAnswer : "chứa các đáp án đã chọn"
    Attempt ||--o{ AttemptViolation : "ghi nhận vi phạm"

    RevokedToken {
        string tokenHash PK
        datetime expiresAt
    }

    User {
        string id PK
        string email UK
        string passwordHash
        string fullName
        Role role "STUDENT, EXAM_MANAGER, ADMIN"
        string avatar
        string cover
        string workplace
        string currentResidence
        int authVersion
        datetime createdAt
    }

    Classroom {
        string id PK
        string name
        string code UK "6 ký tự duy nhất"
        string description
        string password "Mật khẩu bảo vệ"
        string managerId FK
    }

    ClassroomMember {
        string id PK
        string classroomId FK
        string userId FK
        datetime joinedAt
    }

    Exam {
        string id PK
        string title
        string description
        int durationMinutes
        ExamStatus status "DRAFT, PUBLISHED, CLOSED"
        datetime opensAt "Khung giờ mở"
        datetime closesAt "Khung giờ đóng (Hard Cutoff)"
        int maxAttempts "Số lần thi tối đa"
        boolean enableProctoring "Bật giám sát"
        int maxViolations "Ngưỡng vi phạm"
        string managerId FK
        string classroomId FK "Null nếu là đề công khai"
    }

    Question {
        string id PK
        string examId FK
        string content
        int position
    }

    Option {
        string id PK
        string questionId FK
        string content
        int position
        boolean isCorrect
    }

    Attempt {
        string id PK
        string userId FK
        string examId FK
        AttemptStatus status "IN_PROGRESS, SUBMITTED, CANCELLED"
        datetime startedAt
        datetime deadlineAt
        datetime submittedAt
        float score "Thang 10"
        int totalQuestions
        int correctCount
        int incorrectCount
        int violationCount
        string terminatedReason
    }

    AttemptViolation {
        string id PK
        string attemptId FK
        ViolationType type "TAB_SWITCH, FULLSCREEN_EXIT, ..."
        string detail
        datetime createdAt
    }

    AttemptAnswer {
        string id PK
        string attemptId FK
        string questionId FK
        string selectedOptionId FK
        datetime updatedAt
    }
```

