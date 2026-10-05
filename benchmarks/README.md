# Baseline pha 1

Mục tiêu: đo API hiện tại trên **Kaggle CPU** bằng k6; giữ cấu hình và artifacts để so sánh pha 2. Không dùng số liệu cục bộ thay cho baseline Kaggle.

## Kết quả đo thực ngày 05/10/2026

Baseline được chọn là lần chạy lúc **14:47:56 giờ Việt Nam** trên Kaggle CPU (Ubuntu 24.04.5, 4 logical CPU Intel Xeon 2.20 GHz, Accelerator None). Đã lấy nguyên bản file từ output của notebook, kiểm SHA256 và chạy lại bộ kiểm tra report trên máy local; report tạo lại khớp bytes với bản Kaggle. MongoDB riêng do bootstrap tạo đã dừng sau khi dọn fixture.

| Chỉ số | Kết quả |
| --- | ---: |
| p50 / p95 / p99 | 8.163 / 13.515 / 19.462 ms |
| Throughput | 139.300 request/s |
| Requests / lỗi | 8358 / 0 |
| VU cấu hình / quan sát | 10 / 10 |
| Warmup / đo | 10s / 60s |

Artifacts: [báo cáo](results/kaggle-cpu-2026-10-05T07-47-56-834Z-f7280e.md), [summary JSON](results/kaggle-cpu-2026-10-05T07-47-56-834Z-f7280e.summary.json), [runtime/provenance](results/kaggle-cpu-2026-10-05T07-47-56-834Z-f7280e.runtime.json). Summary SHA256: `a1f4ad93d32b9e4a03c293b8226d2031d28c0c821d2cae978c251255bf6541df`. Source archive SHA256: `b688cb5a375f7f8fbf466f4b4092cb51a2f0348675279babfa193acba4b546b1`.

[Notebook Kaggle của hiesew](https://www.kaggle.com/code/hiesew/online-exam-phase-1-cpu-baseline) giữ Private theo chấp thuận của chủ tài khoản. Phiên đo đầu lúc 10:19 có 8194 request nhưng session tạm đã hết hạn trước khi lấy đủ artifacts; không dùng số liệu đó làm baseline được chọn. Bản Quick Save Output đầu tiên còn ở hàng đợi khi kiểm tra; ba file đã tải về ở trên là bằng chứng đo hoàn chỉnh, không phụ thuộc vào việc hàng đợi đó kết thúc.

Cả [backend](https://github.com/lth24021473/online-exam-api) và [frontend](https://github.com/lth24021473/online-exam-front) đã xác minh **Public** qua GitHub REST không Authorization/cookies; xem [kết quả kiểm tra](results/github-public-check.json). Những sửa local trong lượt này chưa commit/push; trạng thái Public không có nghĩa GitHub đã chứa các sửa đó.

## Cấu hình cố định

`config.json` pin Node 24.12.0, k6 1.6.1, 10 người dùng đồng thời, warmup 10 giây, đo 60 giây. Notebook pin MongoDB 8.0.30. Dataset `phase1-v1`: 10 STUDENT, một manager, một đề PUBLISHED, 20 câu × 4 lựa chọn, một bài SUBMITTED và 20 đáp án mỗi học viên (15 đúng/5 sai). ID/password được tạo riêng mỗi lần; nội dung và kích thước giữ nguyên.

Mỗi VU đăng nhập ở setup, rồi lặp bốn GET có JWT: `/users/me`, `/exams`, `/exams/:id`, `/attempts?page=1&limit=10`, nghỉ 0,25 giây sau mỗi vòng. Mix danh nghĩa 25% mỗi endpoint; bộ đếm ghi số request thực tế. Không ghi dữ liệu trong cửa sổ đo. Login là POST có xác thực chức năng nhưng không tính vào tải đọc này.

p50/p95/p99 lấy từ custom Trend **chỉ trong scenario đo**; RPS = completed requests / 60 giây. Lỗi gồm lỗi HTTP/kết nối và JSON sai cấu trúc. GracefulStop=0: request chưa hoàn tất khi hết cửa sổ bị dừng, không được tính vào latency hay số request hoàn tất. Reporter kiểm tra các bộ đếm, percentiles, cửa sổ thời gian, concurrency, provenance và từ chối lần chạy chưa hoàn tất hoặc đổi nhãn local thành Kaggle.

API, MongoDB và k6 chạy cùng máy CPU trong notebook. Đây là baseline của workload đọc có JWT; không suy rộng thành hiệu năng toàn bộ hệ thống hoặc tải nộp bài. Cần ghi cả cấu hình CPU/OS thực tế vì Kaggle có thể thay đổi máy được cấp.

## Kiểm tra local trước khi chạy Kaggle

Chỉ dùng MongoDB hiện có, không tạo Docker Mongo mới. Database benchmark phải mới, rỗng, trên loopback, tên `online_exam_*_benchmark`. Wrapper từ chối database chính, remote/Atlas hoặc URL có credentials.

```powershell
npm run benchmark:install
$env:BENCH_DATABASE_URL='mongodb://127.0.0.1:27017/online_exam_phase1_local_20261005_benchmark?replicaSet=rs0&directConnection=true'
npm run benchmark:local
```

Mỗi lần thử lại chọn một tên database mới. Wrapper generate Prisma, db push và build source hiện tại, tạo fixture, chạy Node API ở cổng 3100, chạy k6, ghi report/summary trong `results`, rồi dừng API và dọn đúng ID của fixture. Không drop database hoặc xóa dữ liệu dùng chung. API ứng dụng ở cổng 3000 tiếp tục dùng database riêng của nó. Binaries, fixture/password, source archive và log ở `.tools`/`.generated` được Git/Docker ignore; report đã loại credentials có thể đưa lên Git.

## Chạy Kaggle CPU

1. Chạy `npm run benchmark:package` tạo `benchmarks/.generated/source.tar.gz` và `.sha256`. Archive chỉ gồm source/config/package-lock/benchmark; không có `.env`, `.git`, database hay frontend. Manifest ghi commit gốc, trạng thái chưa commit và hash source thực tế.
2. Đăng nhập Kaggle, tạo/import `kaggle-baseline.ipynb`, chọn **Accelerator: None**, bật **Internet**. Thêm archive và checksum thành input riêng của notebook; giữ private nếu source repo chưa public.
3. Nếu Kaggle tự giải nén `.tar.gz`, sao chép `source.tar.gz` thành `source.tar.gz.bundle` và `.sha256` thành `source.tar.gz.bundle.sha256`, rồi tải hai bản sao lên input Private. Chỉ đổi tên truyền tải, bytes và SHA256 giữ nguyên. Dùng nút Copy file path của Kaggle để điền `SOURCE_ARCHIVE`; có thể điền trực tiếp checksum đã tạo vào `REQUIRED_SHA256`. Notebook cũng tự tìm `.bundle` khi input chỉ có một archive.
4. Notebook kiểm SHA256 trước khi thực thi bootstrap, cài runtime từ nguồn chính thức, tạo MongoDB replica set riêng trên 127.0.0.1:27018 và chạy `benchmark:kaggle`.
5. Giữ output summary JSON, report Markdown và metadata notebook của **lần chạy thật**. Cell cuối xuất các file qua liên kết chứa đúng bytes đã đo, tránh lỗi đường dẫn FileLink trong editor. Tải ngay và đặt vào `benchmarks/results/`, trước khi session hết hạn. Khi lưu phiên, chọn Quick Save → Advanced Settings → Save output for this version. Chỉ khi có artifacts này mới hoàn thành baseline Kaggle.

Runtime wrapper yêu cầu Linux, `/kaggle/working`, dấu hiệu môi trường Kaggle và không có GPU/TPU. Không thể chạy `benchmark:kaggle` trên Windows để tạo nhãn Kaggle giả. Một notebook chưa chạy không phải báo cáo baseline.

## So sánh pha 2

Giữ cùng CPU/accelerator, phiên bản Node/Mongo/k6, dataset và workload SHA256, 10 VU, warmup/duration, thứ tự request, think time và phương pháp đếm. Mỗi report có Git commit, `gitDirty`, hash working-source, runtime và SHA256 summary. Nếu source có thay đổi chưa commit, hash working-source chỉ rõ bản đã đo; không gán kết quả đó cho commit HEAD nguyên trạng. Giữ baseline pha 1, thêm report pha 2 mới và so sánh; không ghi đè kết quả cũ.

Chạy `npm run benchmark:test` kiểm tra bảo vệ database và tính nhất quán của report. Các input giả trong test chỉ dùng kiểm tra parser, không là kết quả đo.

Nguồn runtime: [Node official releases](https://nodejs.org/dist/v24.12.0/), [k6 official v1.6.1](https://github.com/grafana/k6/releases/tag/v1.6.1), [MongoDB downloads](https://www.mongodb.com/try/download/community), [Kaggle notebooks](https://www.kaggle.com/docs/notebooks).
