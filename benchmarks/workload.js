import http from 'k6/http';
import { check, sleep } from 'k6';
import execution from 'k6/execution';
import { Counter, Gauge, Rate, Trend } from 'k6/metrics';

const fixturePath = __ENV.DATA_FILE;
if (!fixturePath) throw new Error('DATA_FILE must point to a generated benchmark fixture.');
let fixture;
try { fixture = JSON.parse(open(fixturePath)); }
catch { throw new Error('Cannot read the generated benchmark fixture JSON.'); }
if (fixture.version !== 1 || !/^[a-f\d]{24}$/i.test(fixture.examId || '')
  || !Array.isArray(fixture.users) || !fixture.provenance) {
  throw new Error('Unsupported benchmark fixture schema.');
}

const baseUrl = (__ENV.BASE_URL || '').replace(/\/+$/, '');
if (!/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|api|host\.docker\.internal)(?::\d+)?\/api\/v1$/.test(baseUrl)) {
  throw new Error('BASE_URL must explicitly identify the local disposable API, including /api/v1.');
}
const vus = Number(__ENV.VUS || 10);
if (!Number.isInteger(vus) || vus < 1 || vus > 1000 || fixture.users.length < vus) {
  throw new Error('VUS must be a positive integer with at least one fixture student per VU.');
}
function seconds(value, allowZero = false) {
  const match = /^(\d+)(s|m)$/.exec(value);
  const result = match && Number(match[1]) * (match[2] === 'm' ? 60 : 1);
  if (!match || !Number.isFinite(result) || result < (allowZero ? 0 : 1) || result > 600) {
    throw new Error('Benchmark durations must be whole seconds or minutes, up to 10 minutes.');
  }
  return result;
}
const durationSeconds = seconds(__ENV.DURATION || '60s');
const warmupSeconds = seconds(__ENV.WARMUP_DURATION || '10s', true);
const thinkTimeSeconds = 0.25;
const endpoints = [
  { name: 'users_me', path: '/users/me' },
  { name: 'exams', path: '/exams' },
  { name: 'exam_detail', path: `/exams/${fixture.examId}` },
  { name: 'attempts', path: '/attempts?page=1&limit=10' },
];
const baselineRequests = new Counter('baseline_requests');
const baselineErrors = new Counter('baseline_errors');
const baselineErrorRate = new Rate('baseline_unexpected_errors');
const baselineLatency = new Trend('baseline_latency_ms', true);
const baselineStartedVus = new Counter('baseline_vus_started');
const baselineCompletedVus = new Counter('baseline_vus_completed');
const baselineIterations = new Counter('baseline_completed_iterations');
const baselineActiveVus = new Gauge('baseline_active_vus');
const baselineElapsed = new Gauge('baseline_elapsed_ms');
const endpointMetrics = {};
for (const endpoint of endpoints) {
  endpointMetrics[endpoint.name] = {
    requests: new Counter(`baseline_${endpoint.name}_requests`),
    errors: new Counter(`baseline_${endpoint.name}_errors`),
    latency: new Trend(`baseline_${endpoint.name}_latency_ms`, true),
  };
}
const scenarios = {
  baseline: {
    executor: 'constant-vus', vus, duration: `${durationSeconds}s`,
    startTime: `${warmupSeconds}s`, gracefulStop: '0s', exec: 'baseline',
    tags: { phase: 'baseline' },
  },
};
if (warmupSeconds) scenarios.warmup = {
  executor: 'constant-vus', vus, duration: `${warmupSeconds}s`,
  gracefulStop: '0s', exec: 'warmup', tags: { phase: 'warmup' },
};
export const options = {
  scenarios, setupTimeout: '120s',
  summaryTrendStats: ['avg', 'min', 'max', 'med', 'p(95)', 'p(99)', 'count'],
  summaryTimeUnit: 'ms',
  thresholds: { baseline_unexpected_errors: ['rate<0.01'], baseline_requests: ['count>0'] },
};

export function setup() {
  const students = [];
  for (let index = 0; index < vus; index += 1) {
    const user = fixture.users[index];
    if (user.role !== 'STUDENT' || typeof user.email !== 'string' || typeof user.password !== 'string') {
      throw new Error(`Invalid fixture student at index ${index}.`);
    }
    const response = http.post(`${baseUrl}/auth/login`, JSON.stringify({ email: user.email, password: user.password }), {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      tags: { phase: 'setup', name: 'POST /auth/login' }, timeout: '10s', redirects: 0,
    });
    let body;
    try { body = response.json(); } catch { body = null; }
    if (response.status !== 200 || !body || typeof body.accessToken !== 'string'
      || body.user?.role !== 'STUDENT' || typeof body.user.id !== 'string') {
      throw new Error(`Fixture authentication failed at index ${index}; response bodies are omitted.`);
    }
    students.push({ token: body.accessToken, id: body.user.id });
  }
  return { students };
}

function isExpectedJson(name, response, studentId) {
  if (response.status !== 200) return false;
  let body;
  try { body = response.json(); } catch { return false; }
  if (name === 'users_me') return body?.id === studentId && body.role === 'STUDENT';
  if (name === 'exams') {
    const items = Array.isArray(body) ? body : body?.items;
    return Array.isArray(items) && items.some((item) => item.id === fixture.examId && item.status === 'PUBLISHED');
  }
  if (name === 'exam_detail') return body?.id === fixture.examId && body.status === 'PUBLISHED';
  return Boolean(body && Array.isArray(body.items) && body.meta && Number.isInteger(body.meta.total));
}

let hasStartedBaseline = false;
let hasCompletedBaseline = false;
function readRound(data, measured) {
  const student = data.students[(execution.vu.idInTest - 1) % data.students.length];
  if (measured && !hasStartedBaseline) {
    hasStartedBaseline = true;
    baselineStartedVus.add(1);
  }
  for (const endpoint of endpoints) {
    const response = http.get(`${baseUrl}${endpoint.path}`, {
      headers: { Authorization: `Bearer ${student.token}`, Accept: 'application/json' },
      tags: { phase: measured ? 'baseline' : 'warmup', name: `GET ${endpoint.name}` },
      timeout: '10s', redirects: 0,
    });
    const expected = isExpectedJson(endpoint.name, response, student.id);
    check(response, { [`${endpoint.name}: HTTP 200 and expected JSON`]: () => expected }, { phase: measured ? 'baseline' : 'warmup' });
    if (measured) {
      const failed = expected ? 0 : 1;
      baselineRequests.add(1);
      baselineErrors.add(failed);
      baselineErrorRate.add(failed);
      baselineLatency.add(response.timings.duration);
      endpointMetrics[endpoint.name].requests.add(1);
      endpointMetrics[endpoint.name].errors.add(failed);
      endpointMetrics[endpoint.name].latency.add(response.timings.duration);
      baselineActiveVus.add(execution.instance.vusActive);
      baselineElapsed.add(Math.max(0, Date.now() - execution.scenario.startTime));
    }
  }
  if (measured) {
    baselineIterations.add(1);
    if (!hasCompletedBaseline) {
      hasCompletedBaseline = true;
      baselineCompletedVus.add(1);
    }
  }
  sleep(thinkTimeSeconds);
}
export function warmup(data) { readRound(data, false); }
export function baseline(data) { readRound(data, true); }

function sanitizedProvenance() {
  const source = fixture.provenance;
  const runtime = source.runtime || {};
  const dataset = source.dataset || {};
  return {
    environment: source.environment, runId: source.runId, gitCommit: source.gitCommit,
    sourceTree: source.sourceTree, gitDirty: source.gitDirty === true,
    workloadSha256: source.workloadSha256, startedAt: source.startedAt,
    dataset: {
      version: dataset.version, seed: dataset.seed, students: dataset.students,
      exams: dataset.exams, questionsPerExam: dataset.questionsPerExam,
      optionsPerQuestion: dataset.optionsPerQuestion,
      submittedAttemptsPerStudent: dataset.submittedAttemptsPerStudent,
    },
    runtime: {
      platform: runtime.platform, accelerator: runtime.accelerator, cpuCount: runtime.cpuCount,
      cpuModel: runtime.cpuModel, nodeVersion: runtime.nodeVersion, mongoVersion: runtime.mongoVersion,
      k6Version: runtime.k6Version, kaggleVerified: runtime.kaggleVerified === true,
    },
  };
}

export function handleSummary(data) {
  const metrics = {};
  for (const [name, metric] of Object.entries(data.metrics || {})) {
    if (name.startsWith('baseline_')) metrics[name] = metric;
  }
  const values = (name) => metrics[name]?.values || {};
  const totalRequests = values('baseline_requests').count || 0;
  const errors = values('baseline_errors').count || 0;
  const observedLastCompletedRequestMs = values('baseline_elapsed_ms').max || 0;
  const testRunDurationMs = data.state?.testRunDurationMs || 0;
  const completed = totalRequests > 0 && values('baseline_vus_started').count === vus
    && values('baseline_vus_completed').count === vus
    && observedLastCompletedRequestMs >= durationSeconds * 1000 - 1000
    && testRunDurationMs >= (durationSeconds + warmupSeconds) * 1000 - 250;
  const summary = {
    version: 1, phase: 'phase1', workload: 'authenticated-mixed-read-v1', completed,
    generatedAt: new Date().toISOString(), provenance: sanitizedProvenance(),
    config: {
      baseUrl, virtualUsers: vus, warmupSeconds, durationSeconds, thinkTimeSeconds,
      gracefulStopSeconds: 0, timeoutSeconds: 10,
      requestMix: endpoints.map(({ name, path }) => ({ name, method: 'GET', path, expectedStatus: 200 })),
      summaryFormat: 'k6-legacy-custom-v1',
    },
    measurement: {
      totalRequests, errors, errorRate: totalRequests ? errors / totalRequests : null,
      throughputRequestsPerSecond: totalRequests / durationSeconds,
      measurementWindowSeconds: durationSeconds,
      observedLastCompletedRequestMs, testRunDurationMs,
      windowBasis: 'fixed scheduled baseline interval; gracefulStop=0; completed responses only',
    },
    metrics,
  };
  const outputPath = __ENV.SUMMARY_FILE || `benchmarks/results/${fixture.provenance.runId}.summary.json`;
  return {
    [outputPath]: JSON.stringify(summary, null, 2),
    stdout: `Baseline ${completed ? 'completed' : 'incomplete'}: ${totalRequests} measured requests, ${errors} errors. Summary: ${outputPath}\n`,
  };
}
