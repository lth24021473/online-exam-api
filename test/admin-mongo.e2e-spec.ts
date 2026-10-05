import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

const databaseUrl = process.env.MONGO_TEST_DATABASE_URL;
const describeMongo = databaseUrl ? describe : describe.skip;

describeMongo('Admin sessions with real MongoDB', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: User;
  let account: User;
  let adminToken: string;
  let passwordHash: string;
  const ownedUserIds: string[] = [];
  const ownedExamIds: string[] = [];
  const ownedRevokedHashes: string[] = [];
  const password = 'AdminSessionTest123!';
  const api = '/api/v1';

  beforeAll(async () => {
    if (
      !databaseUrl ||
      !new URL(databaseUrl).pathname.endsWith('_codex_test')
    ) {
      throw new Error('MONGO_TEST_DATABASE_URL must end in _codex_test');
    }
    prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    passwordHash = await bcrypt.hash(password, 4);
  }, 30000);

  async function createUser(role: Role) {
    const user = await prisma.user.create({
      data: {
        email: `admin-session-${randomUUID()}@example.com`,
        fullName: `Session test ${role}`,
        role,
        passwordHash,
      },
    });
    ownedUserIds.push(user.id);
    return user;
  }

  async function login(user: User) {
    const response = await request(app.getHttpServer())
      .post(`${api}/auth/login`)
      .send({ email: user.email, password })
      .expect(200);
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(response.body.user).not.toHaveProperty('authVersion');
    return response.body.accessToken as string;
  }

  const me = (token: string) =>
    request(app.getHttpServer())
      .get(`${api}/users/me`)
      .auth(token, { type: 'bearer' });
  const changeRole = (id: string, role: Role) =>
    request(app.getHttpServer())
      .patch(`${api}/admin/users/${id}/role`)
      .auth(adminToken, { type: 'bearer' })
      .send({ role });

  beforeEach(async () => {
    admin = await createUser(Role.ADMIN);
    account = await createUser(Role.STUDENT);
    adminToken = await login(admin);
  });

  afterEach(async () => {
    await prisma.revokedToken.deleteMany({
      where: { tokenHash: { in: ownedRevokedHashes } },
    });
    await prisma.exam.deleteMany({ where: { id: { in: ownedExamIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownedUserIds } } });
    ownedRevokedHashes.length = 0;
    ownedExamIds.length = 0;
    ownedUserIds.length = 0;
  });

  afterAll(async () => {
    if (app) await app.close();
    else if (prisma) await prisma.$disconnect();
  });

  it('registers a student and revokes only the current token when logging out', async () => {
    const email = `auth-flow-${randomUUID()}@example.test`;
    const registered = await request(app.getHttpServer())
      .post(`${api}/auth/register`)
      .send({
        email: ` ${email.toUpperCase()} `,
        fullName: ' Student Auth Integration ',
        password,
      })
      .expect(201);
    ownedUserIds.push(registered.body.user.id);
    expect(registered.body.user).toMatchObject({
      email,
      fullName: 'Student Auth Integration',
      role: Role.STUDENT,
    });
    expect(registered.body.user).not.toHaveProperty('passwordHash');
    expect(registered.body.user).not.toHaveProperty('authVersion');
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: registered.body.user.id },
    });
    expect(stored.passwordHash).not.toBe(password);
    expect(await bcrypt.compare(password, stored.passwordHash)).toBe(true);

    const token = registered.body.accessToken as string;
    const otherToken = await login(stored);
    expect(otherToken).not.toBe(token);
    await me(token).expect(200);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    ownedRevokedHashes.push(tokenHash);
    await request(app.getHttpServer())
      .post(`${api}/auth/logout`)
      .auth(token, { type: 'bearer' })
      .expect(204);
    const revoked = await prisma.revokedToken.findUniqueOrThrow({
      where: { tokenHash },
    });
    expect(revoked.expiresAt.getTime()).toBe(
      app.get(JwtService).decode(token).exp * 1000,
    );
    await me(token).expect(401);
    await me(otherToken).expect(200);
    await me(await login(stored)).expect(200);
  });

  it('invalidates every session on role change and never revives tokens after a role cycle', async () => {
    const oldTokens = [await login(account), await login(account)];
    await changeRole(account.id, Role.EXAM_MANAGER).expect(200);
    for (const token of oldTokens) await me(token).expect(401);
    const managerToken = await login(account);
    expect((await me(managerToken).expect(200)).body.role).toBe(
      Role.EXAM_MANAGER,
    );
    await changeRole(account.id, Role.STUDENT).expect(200);
    for (const token of [...oldTokens, managerToken])
      await me(token).expect(401);
    await me(await login(account)).expect(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: account.id } }))
        .authVersion,
    ).toBe(2);
    await me(adminToken).expect(200);
  });

  it('supports legacy Mongo documents and versionless JWTs, then revokes them permanently', async () => {
    await prisma.$runCommandRaw({
      update: 'User',
      updates: [
        {
          q: { _id: { $oid: account.id } },
          u: { $unset: { authVersion: '' } },
        },
      ],
    });
    const legacyToken = app.get(JwtService).sign({
      sub: account.id,
      email: account.email,
      role: Role.STUDENT,
    });
    await me(legacyToken).expect(200);
    await changeRole(account.id, Role.ADMIN).expect(200);
    await me(legacyToken).expect(401);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: account.id } }))
        .authVersion,
    ).toBe(1);
    const promotedToken = await login(account);
    await request(app.getHttpServer())
      .get(`${api}/admin/users`)
      .auth(promotedToken, { type: 'bearer' })
      .expect(200);
    await changeRole(account.id, Role.STUDENT).expect(200);
    await me(legacyToken).expect(401);
    await me(promotedToken).expect(401);
  });

  it('keeps sessions valid when the role is unchanged, including a null legacy version', async () => {
    await prisma.user.update({
      where: { id: account.id },
      data: { authVersion: null },
    });
    const token = await login(account);
    await changeRole(account.id, Role.STUDENT).expect(200);
    await me(token).expect(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: account.id } }))
        .authVersion,
    ).toBe(0);
  });

  it('rejects deleted users across me, exams and attempts, while retaining other sessions', async () => {
    const token = await login(account);
    await request(app.getHttpServer())
      .delete(`${api}/admin/users/${account.id}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(204);
    for (const endpoint of ['users/me', 'exams', 'attempts']) {
      await request(app.getHttpServer())
        .get(`${api}/${endpoint}`)
        .auth(token, { type: 'bearer' })
        .expect(401);
    }
    await me(adminToken).expect(200);
  });

  it('invalidates the admin own session after downgrade and requires login with the new role', async () => {
    await changeRole(admin.id, Role.STUDENT).expect(200);
    await me(adminToken).expect(401);
    const token = await login(admin);
    expect((await me(token).expect(200)).body.role).toBe(Role.STUDENT);
    await request(app.getHttpServer())
      .get(`${api}/admin/users`)
      .auth(token, { type: 'bearer' })
      .expect(403);
  });

  it('invalidates the admin own session after account deletion', async () => {
    await request(app.getHttpServer())
      .delete(`${api}/admin/users/${admin.id}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(204);
    await me(adminToken).expect(401);
    await request(app.getHttpServer())
      .post(`${api}/auth/login`)
      .send({ email: admin.email, password })
      .expect(401);
  });

  it('rejects deleting an exam owner without invalidating or erasing the account', async () => {
    const manager = await createUser(Role.EXAM_MANAGER);
    const exam = await prisma.exam.create({
      data: {
        title: 'Owned admin session test',
        durationMinutes: 10,
        managerId: manager.id,
      },
    });
    ownedExamIds.push(exam.id);
    const token = await login(manager);
    const response = await request(app.getHttpServer())
      .delete(`${api}/admin/users/${manager.id}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(409);
    expect(response.body.message).toBe(
      'User cannot be deleted while they own exams or attempts',
    );
    await me(token).expect(200);
    expect(
      await prisma.exam.findUnique({ where: { id: exam.id } }),
    ).not.toBeNull();
  });
});
