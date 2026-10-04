import 'dotenv/config';
import { PrismaClient, Role, ExamStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const studentPasswordHash = await bcrypt.hash('Student123', 10);
  const managerPasswordHash = await bcrypt.hash('Manager123', 10);

  await prisma.user.upsert({
    where: { email: 'student@example.com' },
    update: {},
    create: {
      email: 'student@example.com',
      fullName: 'Student Demo',
      passwordHash: studentPasswordHash,
      role: Role.STUDENT,
    },
  });

  const manager = await prisma.user.upsert({
    where: { email: 'manager@example.com' },
    update: {},
    create: {
      email: 'manager@example.com',
      fullName: 'Exam Manager Demo',
      passwordHash: managerPasswordHash,
      role: Role.EXAM_MANAGER,
    },
  });

  const questionsData = [
    {
      content: 'Ngôn ngữ nào chạy trên trình duyệt?',
      options: ['Python', 'JavaScript', 'C++', 'Go'],
      correctOptionIndex: 1,
      position: 1,
    },
    {
      content: 'HTTP status code nào nghĩa là "Not Found"?',
      options: ['200', '301', '404', '500'],
      correctOptionIndex: 2,
      position: 2,
    },
    {
      content: 'Prisma hỗ trợ database nào sau đây?',
      options: ['MongoDB', 'Redis', 'Elasticsearch', 'Neo4j'],
      correctOptionIndex: 0,
      position: 3,
    },
    {
      content: 'NestJS được xây dựng trên framework nào?',
      options: ['Express', 'Fastify', 'Cả Express và Fastify', 'Koajs'],
      correctOptionIndex: 2,
      position: 4,
    },
    {
      content:
        'Decorator nào dùng để đánh dấu một class là Controller trong NestJS?',
      options: ['@Injectable()', '@Controller()', '@Module()', '@Get()'],
      correctOptionIndex: 1,
      position: 5,
    },
  ];

  // Reuse the demo exam, including its existing attempts and questions.
  // Seeding must never clear data from an exam database.
  const existingExam = await prisma.exam.findFirst({
    where: {
      title: 'Đề thi Demo - Lập trình cơ bản',
      managerId: manager.id,
    },
  });

  const exam =
    existingExam ??
    (await prisma.exam.create({
      data: {
        title: 'Đề thi Demo - Lập trình cơ bản',
        description: 'Đề thi trắc nghiệm demo để test chức năng làm bài',
        instructions: 'Mỗi câu chỉ chọn 1 đáp án. Thời gian 15 phút.',
        durationMinutes: 15,
        status: ExamStatus.PUBLISHED,
        publishedAt: new Date(),
        managerId: manager.id,
        questions: {
          create: questionsData.map((q) => ({
            content: q.content,
            position: q.position,
            options: {
              create: q.options.map((content, position) => ({
                content,
                position,
                isCorrect: position === q.correctOptionIndex,
              })),
            },
          })),
        },
      },
    }));

  console.log('========== Seed completed ==========');
  console.log('Student  : student@example.com / Student123');
  console.log('Manager  : manager@example.com / Manager123');
  console.log(`Exam ID  : ${exam.id}`);
  console.log(
    existingExam
      ? 'Demo exam already exists; its questions and attempts were preserved.'
      : `Questions: ${questionsData.length}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
