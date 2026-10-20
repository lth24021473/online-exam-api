const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateSummary, renderReport } = require('./report.cjs');

// Synthetic inputs test the report validator; they are never baseline results.
function sample() {
  const counter = (count) => ({ type: 'counter', values: { count, rate: count / 70 } });
  const trend = (count) => ({ type: 'trend', values: { count, min: 1, max: 20, avg: 5, med: 3.5, 'p(95)': 10, 'p(99)': 15 } });
  const metrics = {
    baseline_requests: counter(2400), baseline_errors: counter(12),
    baseline_unexpected_errors: { type: 'rate', values: { rate: 0.005 } },
    baseline_latency_ms: trend(2400), baseline_vus_started: counter(10), baseline_vus_completed: counter(10),
    baseline_completed_iterations: counter(600),
    baseline_active_vus: { type: 'gauge', values: { value: 10, min: 10, max: 10 } },
    baseline_elapsed_ms: { type: 'gauge', values: { value: 59999, min: 1, max: 59999 } },
    http_reqs: counter(3200), // Setup/warmup would inflate this global metric.
  };
  const requestMix = [
    { name: 'users_me', path: '/users/me' },
    { name: 'exams', path: '/exams' },
    { name: 'exam_detail', path: '/exams/670001111111111111111111' },
    { name: 'attempts', path: '/attempts?page=1&limit=10' },
  ].map((endpoint) => ({ ...endpoint, method: 'GET', expectedStatus: 200 }));
  for (const endpoint of requestMix) {
    metrics[`baseline_${endpoint.name}_requests`] = counter(600);
    metrics[`baseline_${endpoint.name}_errors`] = counter(3);
    metrics[`baseline_${endpoint.name}_latency_ms`] = trend(600);
  }
  return {
    version: 1, phase: 'phase1', workload: 'authenticated-mixed-read-v1', completed: true,
    generatedAt: '2026-10-05T00:01:15.000Z',
    provenance: {
      environment: 'local', runId: 'synthetic-validator-test', gitCommit: 'a'.repeat(40),
      sourceTree: `sha256:${'b'.repeat(64)}`, gitDirty: true, workloadSha256: 'c'.repeat(64),
      startedAt: '2026-10-05T00:00:00.000Z',
      dataset: { version: 1, seed: 'phase1-v1', students: 10, exams: 1, questionsPerExam: 20, optionsPerQuestion: 4, submittedAttemptsPerStudent: 1 },
      runtime: { platform: 'win32', accelerator: 'none', cpuCount: 4, cpuModel: 'Synthetic CPU', nodeVersion: 'v24', mongoVersion: '8', k6Version: 'v1.6.1', kaggleVerified: false },
    },
    config: {
      baseUrl: 'http://127.0.0.1:3100/api/v1', virtualUsers: 10, warmupSeconds: 10,
      durationSeconds: 60, thinkTimeSeconds: 0.25, gracefulStopSeconds: 0, timeoutSeconds: 10,
      requestMix, summaryFormat: 'k6-legacy-custom-v1',
    },
    measurement: {
      totalRequests: 2400, errors: 12, errorRate: 0.005, throughputRequestsPerSecond: 40,
      measurementWindowSeconds: 60, observedLastCompletedRequestMs: 59999, testRunDurationMs: 70004,
      windowBasis: 'fixed scheduled baseline interval; gracefulStop=0; completed responses only',
    }, metrics,
  };
}

test('a completed local report uses measured counts and window, excluding global setup/warmup metrics', () => {
  const input = sample();
  const measured = validateSummary(input, 'local');
  assert.equal(measured.totalRequests, 2400);
  assert.equal(measured.throughput, 40);
  assert.equal(measured.errorRate, 0.005);
  assert.deepEqual([measured.latency.p50, measured.latency.p95, measured.latency.p99], [3.5, 10, 15]);
  const markdown = renderReport(input, 'local', 'd'.repeat(64));
  assert.match(markdown, /chưa phải kết quả Kaggle CPU/);
  assert.match(markdown, /40\.000 request\/s/);
  assert.match(markdown, /0\.500%/);
  assert.doesNotMatch(markdown, /3200/);
});

test('partial runs and runs that never reach the measured deadline are rejected', () => {
  const partial = sample();
  partial.completed = false;
  assert.throws(() => validateSummary(partial, 'local'), /incomplete/);
  const stopped = sample();
  stopped.metrics.baseline_elapsed_ms.values.max = 50000;
  stopped.measurement.observedLastCompletedRequestMs = 50000;
  assert.throws(() => validateSummary(stopped, 'local'), /scheduled end/);
});

test('inconsistent latency samples, counts, and computed throughput cannot become a report', () => {
  const wrongSamples = sample();
  wrongSamples.metrics.baseline_latency_ms.values.count = 2399;
  assert.throws(() => validateSummary(wrongSamples, 'local'), /sample count/);
  const wrongCounts = sample();
  wrongCounts.metrics.baseline_exams_errors.values.count = 2;
  assert.throws(() => validateSummary(wrongCounts, 'local'), /Endpoint counts/);
  const wrongThroughput = sample();
  wrongThroughput.measurement.throughputRequestsPerSecond = 2400 / 70;
  assert.throws(() => validateSummary(wrongThroughput, 'local'), /throughput/);
});

test('local results cannot be relabeled as Kaggle CPU results', () => {
  assert.throws(() => renderReport(sample(), 'kaggle-cpu'), /cannot be relabeled/);
});

test('Kaggle CPU labels require runtime proof and no accelerator', () => {
  const input = sample();
  input.provenance.environment = 'kaggle-cpu';
  input.provenance.runtime.platform = 'linux';
  assert.throws(() => validateSummary(input, 'kaggle-cpu'), /runtime verification/);
  input.provenance.runtime.kaggleVerified = true;
  assert.match(renderReport(input, 'kaggle-cpu'), /# Baseline pha 1 — Kaggle CPU/);
  input.provenance.runtime.accelerator = 'gpu';
  assert.throws(() => validateSummary(input, 'kaggle-cpu'), /CPU-only/);
});

test('summaries containing fixture credentials or account records are rejected', () => {
  const input = sample();
  input.provenance.fixture = { password: 'never-export-fixture-passwords' };
  assert.throws(() => validateSummary(input, 'local'), /credentials/);
});

test('unordered percentiles and missing source provenance are rejected', () => {
  const unordered = sample();
  unordered.metrics.baseline_latency_ms.values['p(99)'] = 2;
  assert.throws(() => validateSummary(unordered, 'local'), /percentiles/);
  const untraceable = sample();
  delete untraceable.provenance.sourceTree;
  assert.throws(() => validateSummary(untraceable, 'local'), /manifest hash/);
});

test('every configured concurrent user must complete an iteration', () => {
  const input = sample();
  input.metrics.baseline_vus_completed.values.count = 9;
  assert.throws(() => validateSummary(input, 'local'), /Every configured VU/);
});
