const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const endpointNames = ['users_me', 'exams', 'exam_detail', 'attempts'];
const windowBasis = 'fixed scheduled baseline interval; gracefulStop=0; completed responses only';

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
function finite(value, label, minimum = 0) {
  requireValue(typeof value === 'number' && Number.isFinite(value) && value >= minimum, `Invalid ${label}.`);
  return value;
}
function integer(value, label, minimum = 0) {
  finite(value, label, minimum);
  requireValue(Number.isInteger(value), `${label} must be an integer.`);
  return value;
}
function text(value, label) {
  requireValue(typeof value === 'string' && value.trim().length > 0, `Missing ${label}.`);
  return value;
}
function rejectSecrets(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    requireValue(!/^(?:password|passwordHash|token|accessToken|refreshToken|authorization|cookie|users|email|databaseUrl|connectionString)$/i.test(key), 'Summary contains fixture credentials or account data.');
    rejectSecrets(child);
  }
}
function metric(summary, name, expectedType) {
  const result = summary.metrics?.[name];
  requireValue(result?.type === expectedType && result.values && typeof result.values === 'object', `Missing or invalid measured metric ${name}.`);
  return result.values;
}
function counter(summary, name) {
  return integer(metric(summary, name, 'counter').count, `${name} count`);
}
function latency(summary, name, expectedCount) {
  const values = metric(summary, name, 'trend');
  const result = {
    p50: finite(values.med, `${name} p50`),
    p95: finite(values['p(95)'], `${name} p95`),
    p99: finite(values['p(99)'], `${name} p99`),
    avg: finite(values.avg, `${name} average`),
    min: finite(values.min, `${name} minimum`),
    max: finite(values.max, `${name} maximum`),
    count: integer(values.count, `${name} samples`, 1),
  };
  requireValue(result.count === expectedCount, `${name} sample count does not match request count.`);
  const epsilon = Math.max(1e-9, result.max * 1e-9);
  requireValue(result.min <= result.p50 + epsilon && result.p50 <= result.p95 + epsilon
    && result.p95 <= result.p99 + epsilon && result.p99 <= result.max + epsilon
    && result.avg + epsilon >= result.min && result.avg <= result.max + epsilon, `${name} percentiles are inconsistent.`);
  return result;
}
function closeTo(actual, expected, label) {
  finite(actual, label);
  requireValue(Math.abs(actual - expected) <= Math.max(1e-9, Math.abs(expected) * 1e-9), `${label} does not match measured counts.`);
}

function validateSummary(summary, expectedEnvironment) {
  requireValue(summary && typeof summary === 'object' && !Array.isArray(summary), 'Summary must be a JSON object.');
  rejectSecrets(summary);
  requireValue(summary.version === 1 && summary.phase === 'phase1' && summary.workload === 'authenticated-mixed-read-v1', 'Unsupported benchmark summary schema or workload.');
  requireValue(summary.completed === true, 'Refusing to report an incomplete benchmark run.');
  requireValue(['local', 'kaggle-cpu'].includes(expectedEnvironment), 'An explicit expected environment is required.');
  const provenance = summary.provenance;
  requireValue(provenance?.environment === expectedEnvironment, 'Requested environment does not match measured provenance; results cannot be relabeled.');
  text(provenance.runId, 'run ID');
  requireValue(/^[a-f\d]{40}$/i.test(provenance.gitCommit || ''), 'Missing full source Git commit.');
  requireValue(/^sha256:[a-f\d]{64}$/i.test(provenance.sourceTree || ''), 'Missing working-source manifest hash.');
  requireValue(/^[a-f\d]{64}$/i.test(provenance.workloadSha256 || ''), 'Missing workload SHA256.');
  requireValue(typeof provenance.gitDirty === 'boolean', 'Missing source dirty-state provenance.');
  requireValue(Number.isFinite(Date.parse(provenance.startedAt)) && Number.isFinite(Date.parse(summary.generatedAt)), 'Missing valid run timestamps.');
  const runtime = provenance.runtime;
  requireValue(runtime && ['win32', 'linux', 'darwin'].includes(runtime.platform), 'Missing runtime platform.');
  requireValue(runtime.accelerator === 'none', 'CPU-only benchmark proof is missing.');
  integer(runtime.cpuCount, 'runtime CPU count', 1);
  for (const name of ['cpuModel', 'nodeVersion', 'mongoVersion', 'k6Version']) text(runtime[name], `runtime ${name}`);
  if (expectedEnvironment === 'kaggle-cpu') {
    requireValue(runtime.platform === 'linux' && runtime.kaggleVerified === true, 'Kaggle CPU runtime verification is missing.');
  }
  const config = summary.config;
  requireValue(config && config.summaryFormat === 'k6-legacy-custom-v1', 'Unsupported k6 metric format.');
  const vus = integer(config.virtualUsers, 'configured virtual users', 1);
  const duration = integer(config.durationSeconds, 'measured duration', 1);
  integer(config.warmupSeconds, 'warmup duration');
  requireValue(config.gracefulStopSeconds === 0, 'A zero-grace measured window is required.');
  finite(config.thinkTimeSeconds, 'think time');
  integer(config.timeoutSeconds, 'request timeout', 1);
  requireValue(/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|api|host\.docker\.internal)(?::\d+)?\/api\/v1$/.test(config.baseUrl || ''), 'The benchmark target must identify a local disposable API.');
  requireValue(Array.isArray(config.requestMix) && config.requestMix.length === 4
    && config.requestMix.every((item, index) => item.name === endpointNames[index] && item.method === 'GET'
      && item.expectedStatus === 200 && typeof item.path === 'string'), 'The measured endpoint mix is invalid.');
  const mix = config.requestMix;
  requireValue(mix[0].path === '/users/me' && mix[1].path === '/exams'
    && /^\/exams\/[a-f\d]{24}$/i.test(mix[2].path) && mix[3].path === '/attempts?page=1&limit=10', 'The measured endpoint paths are invalid.');
  const dataset = provenance.dataset;
  requireValue(dataset?.version === 1 && dataset.seed === 'phase1-v1', 'Missing deterministic dataset provenance.');
  integer(dataset.students, 'dataset students', vus);
  for (const name of ['exams', 'questionsPerExam', 'optionsPerQuestion', 'submittedAttemptsPerStudent']) integer(dataset[name], `dataset ${name}`, 1);

  const totalRequests = counter(summary, 'baseline_requests');
  const errors = counter(summary, 'baseline_errors');
  requireValue(totalRequests > 0 && errors <= totalRequests, 'Measured request/error counts are invalid.');
  requireValue(counter(summary, 'baseline_vus_started') === vus && counter(summary, 'baseline_vus_completed') === vus, 'Every configured VU must complete a measured iteration.');
  const iterations = counter(summary, 'baseline_completed_iterations');
  requireValue(iterations >= vus && iterations * 4 <= totalRequests, 'Measured iteration count is inconsistent.');
  const observedConcurrentVus = integer(metric(summary, 'baseline_active_vus', 'gauge').max, 'observed concurrent VUs', 1);
  requireValue(observedConcurrentVus === vus, 'Observed concurrency does not match the configured measured scenario.');
  const observedLastCompletedRequestMs = finite(metric(summary, 'baseline_elapsed_ms', 'gauge').max, 'last measured response time');
  requireValue(observedLastCompletedRequestMs >= duration * 1000 - 1000 && observedLastCompletedRequestMs <= duration * 1000 + 250, 'Measured scenario did not reach its scheduled end.');
  const measurement = summary.measurement;
  requireValue(measurement?.windowBasis === windowBasis && measurement.measurementWindowSeconds === duration, 'The measurement window or throughput basis is inconsistent.');
  requireValue(measurement.totalRequests === totalRequests && measurement.errors === errors
    && measurement.observedLastCompletedRequestMs === observedLastCompletedRequestMs, 'Summary counts do not match measured metrics.');
  finite(measurement.testRunDurationMs, 'test runtime');
  requireValue(measurement.testRunDurationMs >= (duration + config.warmupSeconds) * 1000 - 250, 'The test stopped before warmup and measurement completed.');
  closeTo(measurement.errorRate, errors / totalRequests, 'error rate');
  closeTo(metric(summary, 'baseline_unexpected_errors', 'rate').rate, errors / totalRequests, 'custom error rate');
  closeTo(measurement.throughputRequestsPerSecond, totalRequests / duration, 'throughput');
  const responseTimes = latency(summary, 'baseline_latency_ms', totalRequests);
  const endpoints = mix.map((endpoint) => {
    const requests = counter(summary, `baseline_${endpoint.name}_requests`);
    const endpointErrors = counter(summary, `baseline_${endpoint.name}_errors`);
    requireValue(requests > 0 && endpointErrors <= requests, `Invalid counts for ${endpoint.name}.`);
    return { ...endpoint, requests, errors: endpointErrors, errorRate: endpointErrors / requests,
      latency: latency(summary, `baseline_${endpoint.name}_latency_ms`, requests) };
  });
  requireValue(endpoints.reduce((sum, endpoint) => sum + endpoint.requests, 0) === totalRequests
    && endpoints.reduce((sum, endpoint) => sum + endpoint.errors, 0) === errors, 'Endpoint counts do not match the measured total.');
  return { summary, totalRequests, errors, errorRate: errors / totalRequests, vus, observedConcurrentVus, duration, iterations,
    throughput: totalRequests / duration, latency: responseTimes, endpoints };
}

function inline(value) { return String(value).replace(/[\r\n|`]/g, ' '); }
function decimal(value) { return value.toFixed(3); }
function renderReport(summary, expectedEnvironment, summarySha256) {
  const measured = validateSummary(summary, expectedEnvironment);
  const { provenance, config, measurement } = summary;
  const runtime = provenance.runtime;
  const title = expectedEnvironment === 'kaggle-cpu' ? 'Baseline pha 1 — Kaggle CPU' : 'Baseline cục bộ — chưa phải kết quả Kaggle CPU';
  const rows = measured.endpoints.map((endpoint) => `| GET ${inline(endpoint.path)} | ${endpoint.requests} | ${decimal(endpoint.errorRate * 100)}% | ${decimal(endpoint.latency.p50)} | ${decimal(endpoint.latency.p95)} | ${decimal(endpoint.latency.p99)} |`);
  return [
    `# ${title}`, '',
    `Run: \`${inline(provenance.runId)}\`. Môi trường: **${expectedEnvironment}**. Thời điểm: ${inline(provenance.startedAt)}.`, '',
    '| Chỉ số đo | Kết quả |', '| --- | ---: |',
    `| Thời gian phản hồi p50 | ${decimal(measured.latency.p50)} ms |`,
    `| Thời gian phản hồi p95 | ${decimal(measured.latency.p95)} ms |`,
    `| Thời gian phản hồi p99 | ${decimal(measured.latency.p99)} ms |`,
    `| Throughput | ${decimal(measured.throughput)} request/s |`,
    `| Tỷ lệ lỗi HTTP hoặc JSON không đúng | ${decimal(measured.errorRate * 100)}% |`,
    `| Tổng request đã hoàn tất trong cửa sổ đo | ${measured.totalRequests} |`,
    `| Tổng lỗi | ${measured.errors} |`,
    `| Người dùng đồng thời cấu hình / quan sát | ${measured.vus} / ${measured.observedConcurrentVus} |`,
    `| Thời gian đo / warmup | ${measured.duration}s / ${config.warmupSeconds}s |`, '',
    '## Theo endpoint', '',
    '| Endpoint | Request hoàn tất | Lỗi | p50 (ms) | p95 (ms) | p99 (ms) |', '| --- | ---: | ---: | ---: | ---: | ---: |', ...rows, '',
    'Mỗi vòng gọi tuần tự bốn GET được xác thực bằng JWT rồi nghỉ 0,25 giây. POST đăng nhập chạy ở setup; setup và warmup không thuộc các chỉ số trên. Mỗi VU phải hoàn tất ít nhất một vòng đo.', '',
    `Throughput = ${measured.totalRequests} request đã hoàn tất / ${measured.duration} giây của scenario đo có gracefulStop=0. Request còn đang chạy khi hết cửa sổ đo bị dừng và không được tính vào bộ đếm đã hoàn tất. Phản hồi đo cuối ở ${decimal(measurement.observedLastCompletedRequestMs)} ms tính từ khi scenario bắt đầu.`, '',
    'Latency là response.timings.duration của k6 (gửi + chờ + nhận), không gồm DNS/kết nối/TLS. Lỗi gồm status khác 200, lỗi kết nối hoặc JSON không đúng cấu trúc mong đợi. Kết quả mô tả tải đọc có xác thực; không đại diện cho tải tạo/nộp bài.', '',
    '## Môi trường và dữ liệu', '',
    `- Nền tảng: ${inline(runtime.platform)}; accelerator: ${inline(runtime.accelerator)}; CPU: ${runtime.cpuCount} × ${inline(runtime.cpuModel)}.`,
    `- Node: ${inline(runtime.nodeVersion)}; MongoDB: ${inline(runtime.mongoVersion)}; k6: ${inline(runtime.k6Version)}.`,
    `- API: ${inline(config.baseUrl)}; request timeout: ${config.timeoutSeconds}s.`,
    `- Dataset ${inline(provenance.dataset.seed)}: ${provenance.dataset.students} học sinh, ${provenance.dataset.exams} đề, ${provenance.dataset.questionsPerExam} câu/đề, ${provenance.dataset.optionsPerQuestion} đáp án/câu, ${provenance.dataset.submittedAttemptsPerStudent} bài đã nộp/học sinh.`,
    `- Git commit: \`${inline(provenance.gitCommit)}\`; có thay đổi chưa commit lúc đo: ${provenance.gitDirty ? 'có' : 'không'}.`,
    `- Source manifest: \`${inline(provenance.sourceTree)}\`.`,
    `- Workload SHA256: \`${inline(provenance.workloadSha256)}\`.`,
    ...(summarySha256 ? [`- Summary SHA256: \`${inline(summarySha256)}\`.`] : []), '',
    expectedEnvironment === 'local' ? '**Đây là kết quả cục bộ. Cần chạy notebook trên Kaggle CPU và giữ artifacts của lần chạy đó để hoàn thành baseline Kaggle.**'
      : 'Môi trường được wrapper xác minh là Kaggle Linux, CPU-only. Giữ summary JSON, report này và manifest/notebook output cùng nhau để đối chiếu pha 2.', '',
  ].join('\n');
}

function main(argv) {
  const input = argv[0];
  const environmentIndex = argv.indexOf('--environment');
  const outputIndex = argv.indexOf('--output');
  requireValue(input && !input.startsWith('--') && environmentIndex >= 1 && outputIndex >= 1
    && argv.length === 5 && environmentIndex !== outputIndex, 'Usage: node benchmarks/report.cjs <summary.json> --environment local|kaggle-cpu --output <report.md>');
  const environment = argv[environmentIndex + 1];
  const output = argv[outputIndex + 1];
  requireValue(output && !output.startsWith('--'), 'A report output path is required.');
  const raw = fs.readFileSync(path.resolve(input), 'utf8');
  const summary = JSON.parse(raw);
  const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
  const report = renderReport(summary, environment, sha256);
  const reportPath = path.resolve(output);
  requireValue(reportPath !== path.resolve(input), 'The report must not overwrite its input summary.');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report, 'utf8');
  return reportPath;
}

module.exports = { validateSummary, renderReport, main };
if (require.main === module) {
  try { console.log(`Validated report: ${main(process.argv.slice(2))}`); }
  catch (error) { console.error(`Benchmark report rejected: ${error.message}`); process.exitCode = 1; }
}
