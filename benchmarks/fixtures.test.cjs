const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDatabaseUrl, validateDataset } = require('./fixtures.cjs');
test('benchmark refuses primary, remote and credential-bearing databases', () => {
  for (const value of [undefined, 'mongodb://127.0.0.1:27017/online_exam?replicaSet=rs0&directConnection=true', 'mongodb+srv://cluster.example/online_exam_x_benchmark', 'mongodb://remote.example:27017/online_exam_x_benchmark?replicaSet=rs0&directConnection=true', 'mongodb://u:p@127.0.0.1:27017/online_exam_x_benchmark?replicaSet=rs0&directConnection=true', 'mongodb://127.0.0.1:27017/online_exam_x_benchmark?replicaSet=rs0']) assert.throws(() => validateDatabaseUrl(value));
});
test('benchmark accepts explicit isolated loopback replica set', () => {
  const value = 'mongodb://127.0.0.1:27017/online_exam_phase1_abc_benchmark?replicaSet=rs0&directConnection=true';
  assert.equal(validateDatabaseUrl(value), value);
});
test('dataset metadata cannot claim extra exams or attempts that the seeder does not create', () => {
  const dataset = require('./config.json').dataset;
  assert.doesNotThrow(() => validateDataset(dataset));
  assert.throws(() => validateDataset({ ...dataset, exams: 2 }));
  assert.throws(() => validateDataset({ ...dataset, submittedAttemptsPerStudent: 2 }));
});
