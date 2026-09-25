import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const studentPasswordHash = await bcrypt.hash('Student123', 10);
  const managerPasswordHash = await bcrypt.hash('Manager123', 10);

  await prisma.user.upsert({
    where: {
      email: 'student@example.com',
    },
    update: {},
    create: {
      email: 'student@example.com',
      fullName: 'Student Demo',
      passwordHash: studentPasswordHash,
      role: Role.STUDENT,
    },
  });

  await prisma.user.upsert({
    where: {
      email: 'manager@example.com',
    },
    update: {},
    create: {
      email: 'manager@example.com',
      fullName: 'Exam Manager Demo',
      passwordHash: managerPasswordHash,
      role: Role.EXAM_MANAGER,
    },
  });

  console.log('Seed completed');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
