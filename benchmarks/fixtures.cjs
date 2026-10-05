const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

function validateDatabaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('BENCH_DATABASE_URL must identify an isolated local benchmark database.'); }
  if (url.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || !/^\/online_exam_[a-z0-9_]+_benchmark$/.test(url.pathname)
    || url.searchParams.get('replicaSet') !== 'rs0' || url.searchParams.get('directConnection') !== 'true') {
    throw new Error('Only loopback MongoDB rs0 with directConnection=true and a database online_exam_*_benchmark is allowed.');
  }
  return value;
}
function makeClient(databaseUrl) {
  validateDatabaseUrl(databaseUrl);
  return new PrismaClient({ datasourceUrl: databaseUrl });
}
function validateDataset(dataset) {
  if (dataset?.version !== 1 || dataset.seed !== 'phase1-v1' || dataset.exams !== 1 || dataset.submittedAttemptsPerStudent !== 1
    || !Number.isInteger(dataset.students) || dataset.students < 1
    || !Number.isInteger(dataset.questionsPerExam) || dataset.questionsPerExam < 1
    || !Number.isInteger(dataset.optionsPerQuestion) || dataset.optionsPerQuestion < 2) {
    throw new Error('Unsupported dataset; phase1-v1 creates exactly one exam and one submitted attempt per student.');
  }
}
function saveOwnership(filename, ownership) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(ownership, null, 2), { mode: 0o600 });
}
async function seedFixture(databaseUrl, config, provenance, filename) {
  validateDataset(config.dataset);
  const client = makeClient(databaseUrl);
  const objectId = () => crypto.randomBytes(12).toString('hex');
  const ownership = { version: 1, runId: provenance.runId, userIds: [], examIds: [], questionIds: [], optionIds: [], attemptIds: [], answerIds: [] };
  const registerId = (collection) => {
    const id = objectId();
    ownership[collection].push(id);
    saveOwnership(filename, ownership);
    return id;
  };
  try {
    // Refuse reuse of a populated database; cleanup only knows IDs created by this run.
    const existing = await Promise.all(['user', 'exam', 'question', 'option', 'attempt', 'attemptAnswer', 'revokedToken'].map((model) => client[model].count()));
    if (existing.some((count) => count > 0)) throw new Error('Benchmark database is not empty; choose a fresh run database.');
    const password = `Bench-${crypto.randomBytes(18).toString('base64url')}!`;
    const passwordHash = await bcrypt.hash(password, 12);
    const managerId = registerId('userIds');
    await client.user.create({ data: { id: managerId, email: 'benchmark-manager@example.test', fullName: 'Benchmark Manager', passwordHash, role: 'EXAM_MANAGER', authVersion: 0 } });
    const students = [];
    for (let index = 0; index < config.dataset.students; index += 1) {
      const id = registerId('userIds');
      const email = `benchmark-student-${index + 1}@example.test`;
      await client.user.create({ data: { id, email, fullName: `Benchmark Student ${index + 1}`, passwordHash, role: 'STUDENT', authVersion: 0 } });
      students.push({ id, email, password, role: 'STUDENT' });
    }
    const examId = registerId('examIds');
    await client.exam.create({ data: { id: examId, managerId, title: 'Phase 1 CPU baseline', description: 'Deterministic synthetic fixture phase1-v1', instructions: 'Choose one answer per question.', durationMinutes: 30, status: 'PUBLISHED', publishedAt: new Date('2026-01-01T00:00:00Z') } });
    const questions = [];
    for (let index = 0; index < config.dataset.questionsPerExam; index += 1) {
      const questionId = registerId('questionIds');
      await client.question.create({ data: { id: questionId, examId, content: `Fixture question ${index + 1}`, position: index } });
      const options = [];
      for (let choice = 0; choice < config.dataset.optionsPerQuestion; choice += 1) {
        const id = registerId('optionIds');
        await client.option.create({ data: { id, questionId, content: `Choice ${choice + 1}`, position: choice, isCorrect: choice === index % config.dataset.optionsPerQuestion } });
        options.push(id);
      }
      questions.push({ id: questionId, options, correct: index % config.dataset.optionsPerQuestion });
    }
    for (const student of students) {
      const attemptId = registerId('attemptIds');
      const correctCount = Math.floor(questions.length * 0.75);
      await client.attempt.create({ data: { id: attemptId, userId: student.id, examId, status: 'SUBMITTED', startedAt: new Date('2026-01-01T01:00:00Z'), deadlineAt: new Date('2026-01-01T01:30:00Z'), submittedAt: new Date('2026-01-01T01:20:00Z'), totalQuestions: questions.length, correctCount, incorrectCount: questions.length - correctCount, score: correctCount / questions.length * 10, answerVersion: 1 } });
      for (const [index, question] of questions.entries()) {
        const id = registerId('answerIds');
        const choice = index < correctCount ? question.correct : (question.correct + 1) % question.options.length;
        await client.attemptAnswer.create({ data: { id, attemptId, questionId: question.id, selectedOptionId: question.options[choice] } });
      }
    }
    return { version: 1, examId, users: students.map(({ email, password: secret, role }) => ({ email, password: secret, role })), provenance };
  } finally { await client.$disconnect(); }
}
async function cleanupFixture(databaseUrl, filename) {
  if (!fs.existsSync(filename)) return;
  const ownership = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (ownership.version !== 1) throw new Error('Unsupported fixture ownership manifest.');
  const models = [['attemptAnswer', 'answerIds'], ['attempt', 'attemptIds'], ['option', 'optionIds'], ['question', 'questionIds'], ['exam', 'examIds'], ['user', 'userIds']];
  for (const [, key] of models) {
    if (!Array.isArray(ownership[key]) || ownership[key].some((id) => !/^[a-f\d]{24}$/.test(id))) throw new Error('Invalid fixture ownership IDs; cleanup refused.');
  }
  const client = makeClient(databaseUrl);
  try {
    for (const [model, key] of models) {
      if (ownership[key].length) await client[model].deleteMany({ where: { id: { in: ownership[key] } } });
    }
    fs.unlinkSync(filename);
  } finally { await client.$disconnect(); }
}
module.exports = { validateDatabaseUrl, validateDataset, makeClient, seedFixture, cleanupFixture };
