# Antigravity Guidelines & Rules for online-exam-api

## 🛡️ Phân Chia Trách Nhiệm Git & Quy Tắc Thực Hiện (Git & Workflow Rules)

> **QUY TẮC BẮT BUỘC DÀNH CHO AI ASSISTANT:**
>
> 1. **Phân nhánh & Thao tác Git thuộc toàn quyền của Người dùng:**
>    - Người dùng sẽ **tự quản lý toàn bộ việc phân nhánh** (`checkout`, tạo branch mới, `pull`, `merge`, `push`, đồng bộ remote).
>    - AI **tuyệt đối KHÔNG tự ý can thiệp** vào nhánh, không tự tạo branch, không tự checkout hay cố gắng đồng bộ nhánh.
>    - **Không cần bận tâm về nhánh `main` ở local:** Người dùng không quan tâm việc `main` local bị lệch commit so với remote; chỉ cần code trên GitHub/web đầy đủ là được.
>
> 2. **Trách nhiệm của AI Assistant:**
>    - **Chỉ tập trung vào công việc:** Triển khai tính năng, sửa lỗi, viết test, refactor và kiểm tra chất lượng mã nguồn trực tiếp trên nhánh hiện tại mà người dùng đã đứng sẵn.
>    - Chỉ chạy các lệnh Git đọc trạng thái khi cần khảo sát (`git status`, `git diff`, `git log`, xem file).
>    - Sau khi hoàn thành task hoặc bộ test, báo cáo chi tiết kết quả cho người dùng để người dùng tự xử lý commit / push / tạo PR theo ý muốn.
