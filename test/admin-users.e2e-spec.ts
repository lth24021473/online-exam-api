import {
  Controller,
  Get,
  INestApplication,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthModule } from '../src/auth/auth.module';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../src/auth/jwt-auth.guard';
import { Roles } from '../src/auth/roles.decorator';
import { RolesGuard } from '../src/auth/roles.guard';
import { PrismaService } from '../src/database/prisma.service';
import { PrismaModule } from '../src/database/prisma.module';
import { UsersRepository } from '../src/users/users.repository';

const ADMIN_ID = '111111111111111111111111';
const TARGET_ID = '222222222222222222222222';
const MISSING_ID = '999999999999999999999999';
const PASSWORD = 'Testing123';

type StoredUser = {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
  role: Role;
  authVersion?: number | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Emulate only persistence; the real repository, auth service and guards run. */
class InMemoryUsersPrisma {
  readonly users = new Map<string, StoredUser>();
  readonly revoked = new Map<string, { tokenHash: string; expiresAt: Date }>();
  readonly user = {
    findUnique: jest.fn(
      async ({
        where,
        select,
      }: {
        where: { id?: string; email?: string };
        select?: Record<string, boolean>;
      }) => {
        const stored = where.id
          ? this.users.get(where.id)
          : [...this.users.values()].find((user) => user.email === where.email);
        if (!stored) return null;
        // Prisma reads missing MongoDB fields with their schema default, but an
        // isSet filter still checks the original stored document.
        const user = { ...stored, authVersion: stored.authVersion ?? 0 };
        return select
          ? Object.fromEntries(
              Object.keys(select)
                .filter((key) => select[key])
                .map((key) => [key, user[key as keyof typeof user]]),
            )
          : user;
      },
    ),
    findMany: jest.fn(async ({ select }: { select: Record<string, boolean> }) =>
      [...this.users.values()].map((user) =>
        Object.fromEntries(
          Object.keys(select)
            .filter((key) => select[key])
            .map((key) => [key, user[key as keyof StoredUser]]),
        ),
      ),
    ),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: {
          id: string;
          role?: { not: Role };
          OR?: { authVersion: null | { isSet: boolean } }[];
        };
        data: { role?: Role; authVersion?: number | { increment: number } };
      }) => {
        const user = this.users.get(where.id);
        if (
          !user ||
          (where.role && user.role === where.role.not) ||
          (where.OR &&
            !where.OR.some(({ authVersion }) =>
              authVersion === null
                ? user.authVersion === null
                : Object.hasOwn(user, 'authVersion') === authVersion.isSet,
            ))
        ) {
          return { count: 0 };
        }
        if (data.role !== undefined) user.role = data.role;
        if (typeof data.authVersion === 'number')
          user.authVersion = data.authVersion;
        else if (data.authVersion) {
          // Increment on an absent field would not establish a valid counter.
          // The repository must initialize legacy documents first.
          if (user.authVersion == null) throw new Error('Missing authVersion');
          user.authVersion += data.authVersion.increment;
        }
        user.updatedAt = new Date();
        return { count: 1 };
      },
    ),
    delete: jest.fn(async ({ where }: { where: { id: string } }) => {
      const user = this.users.get(where.id);
      this.users.delete(where.id);
      return user;
    }),
  };
  readonly revokedToken = {
    findUnique: jest.fn(
      async ({ where }: { where: { tokenHash: string } }) =>
        this.revoked.get(where.tokenHash) ?? null,
    ),
    upsert: jest.fn(
      async ({
        create,
      }: {
        create: { tokenHash: string; expiresAt: Date };
      }) => {
        this.revoked.set(create.tokenHash, create);
        return create;
      },
    ),
  };
}

@Controller('permission-test')
@UseGuards(JwtAuthGuard, RolesGuard)
class PermissionTestController {
  @Get()
  authenticated(@Req() request: AuthenticatedRequest) {
    return request.user;
  }

  @Get('student')
  @Roles(Role.STUDENT)
  student() {
    return { ok: true };
  }

  @Get('manager')
  @Roles(Role.EXAM_MANAGER)
  manager() {
    return { ok: true };
  }

  @Get('admin')
  @Roles(Role.ADMIN)
  admin() {
    return { ok: true };
  }
}

describe('Admin user permissions and account sessions (HTTP)', () => {
  let app: INestApplication<App>;
  let prisma: InMemoryUsersPrisma;
  let jwt: JwtService;
  let adminToken: string;
  let studentToken: string;
  let passwordHash: string;
  const previousSecret = process.env.JWT_SECRET;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'admin-users-test-secret';
    passwordHash = await bcrypt.hash(PASSWORD, 4);
  });

  beforeEach(async () => {
    prisma = new InMemoryUsersPrisma();
    for (const [id, email, role] of [
      [ADMIN_ID, 'admin@example.test', Role.ADMIN],
      [TARGET_ID, 'student@example.test', Role.STUDENT],
    ] as const) {
      prisma.users.set(id, {
        id,
        email,
        role,
        passwordHash,
        authVersion: 0,
        fullName: email,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    const module = await Test.createTestingModule({
      imports: [AuthModule, PrismaModule],
      controllers: [PermissionTestController],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    jwt = app.get(JwtService);
    adminToken = await login('admin@example.test');
    studentToken = await login('student@example.test');
  });

  afterEach(async () => {
    await app?.close();
  });
  afterAll(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  async function login(email = 'student@example.test') {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(response.body.user).not.toHaveProperty('authVersion');
    return response.body.accessToken as string;
  }

  function get(path: string, token = studentToken) {
    return request(app.getHttpServer())
      .get(`/api/v1/${path}`)
      .auth(token, { type: 'bearer' });
  }

  function changeRole(role: Role, id = TARGET_ID, token = adminToken) {
    return request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${id}/role`)
      .auth(token, { type: 'bearer' })
      .send({ role });
  }

  function legacyToken(id = TARGET_ID) {
    const user = prisma.users.get(id)!;
    return jwt.sign({ sub: id, email: user.email, role: user.role });
  }

  function setLegacyVersion(value: 'missing' | 'null') {
    if (value === 'missing') delete prisma.users.get(TARGET_ID)!.authVersion;
    else prisma.users.get(TARGET_ID)!.authVersion = null;
  }

  it('lists and reads accounts for ADMIN while keeping password and session version private', async () => {
    const list = await get('admin/users', adminToken).expect(200);
    expect(list.body).toHaveLength(2);
    for (const user of list.body) {
      expect(user).not.toHaveProperty('passwordHash');
      expect(user).not.toHaveProperty('authVersion');
    }
    const detail = await get(`admin/users/${TARGET_ID}`, adminToken).expect(
      200,
    );
    expect(detail.body).toMatchObject({ id: TARGET_ID, role: Role.STUDENT });
    expect(detail.body).not.toHaveProperty('passwordHash');
    expect(detail.body).not.toHaveProperty('authVersion');
    await get(`admin/users/${MISSING_ID}`, adminToken).expect(404);
  });

  it('returns 401 without authentication and 403 for a valid STUDENT or EXAM_MANAGER session', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/users').expect(401);
    await get('admin/users').expect(403);
    await changeRole(Role.ADMIN, TARGET_ID, studentToken).expect(403);
    await request(app.getHttpServer())
      .delete(`/api/v1/admin/users/${ADMIN_ID}`)
      .auth(studentToken, { type: 'bearer' })
      .expect(403);
    await changeRole(Role.EXAM_MANAGER).expect(200);
    const managerToken = await login();
    await get('admin/users', managerToken).expect(403);
    expect(prisma.users.has(ADMIN_ID)).toBe(true);
  });

  it('invalidates every pre-upgrade session and grants the new role only after login', async () => {
    const secondSession = await login();
    expect(secondSession).not.toBe(studentToken);
    expect(jwt.decode(studentToken).authVersion).toBe(0);
    const updated = await changeRole(Role.EXAM_MANAGER).expect(200);
    expect(updated.body).toMatchObject({
      id: TARGET_ID,
      role: Role.EXAM_MANAGER,
    });
    expect(updated.body).not.toHaveProperty('authVersion');
    expect(prisma.users.get(TARGET_ID)?.authVersion).toBe(1);
    for (const token of [studentToken, secondSession]) {
      const denied = await get('permission-test', token).expect(401);
      expect(denied.body.message).toBe(
        'Account permissions have changed. Please sign in again',
      );
      await get('permission-test/manager', token).expect(401);
    }
    const fresh = await login();
    expect(jwt.decode(fresh).authVersion).toBe(1);
    await get('permission-test/manager', fresh).expect(200);
    await get('permission-test/student', fresh).expect(403);
  });

  it('invalidates a manager session on downgrade without denying fresh student access', async () => {
    await changeRole(Role.EXAM_MANAGER).expect(200);
    const managerToken = await login();
    await get('permission-test/manager', managerToken).expect(200);
    await changeRole(Role.STUDENT).expect(200);
    await get('permission-test/manager', managerToken).expect(401);
    const fresh = await login();
    await get('permission-test/student', fresh).expect(200);
    await get('permission-test/manager', fresh).expect(403);
  });

  it('keeps old sessions invalid after restoring their original role', async () => {
    await changeRole(Role.ADMIN).expect(200);
    const oldAdminSession = await login();
    await get('admin/users', oldAdminSession).expect(200);
    await changeRole(Role.STUDENT).expect(200);
    await changeRole(Role.ADMIN).expect(200);
    expect(prisma.users.get(TARGET_ID)?.authVersion).toBe(3);
    await get('admin/users', oldAdminSession).expect(401);
    await get('permission-test/student', studentToken).expect(401);
    await get('admin/users', await login()).expect(200);
  });

  it('preserves a session when ADMIN reassigns the same role', async () => {
    await changeRole(Role.STUDENT).expect(200);
    expect(prisma.users.get(TARGET_ID)?.authVersion).toBe(0);
    await get('permission-test/student').expect(200);
  });

  it('rejects all protected requests and all existing sessions after account deletion', async () => {
    const secondSession = await login();
    await request(app.getHttpServer())
      .delete(`/api/v1/admin/users/${TARGET_ID}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(204);
    expect(prisma.users.has(TARGET_ID)).toBe(false);
    for (const token of [studentToken, secondSession]) {
      for (const path of [
        'users/me',
        'permission-test',
        'permission-test/student',
        'permission-test/manager',
        'admin/users',
      ]) {
        const denied = await get(path, token).expect(401);
        expect(denied.body.message).toBe('Account no longer exists');
      }
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .auth(token, { type: 'bearer' })
        .expect(401);
    }
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'student@example.test', password: PASSWORD })
      .expect(401);
  });

  it('immediately invalidates an ADMIN session after self-demotion', async () => {
    await changeRole(Role.STUDENT, ADMIN_ID).expect(200);
    await get('admin/users', adminToken).expect(401);
    await changeRole(Role.ADMIN, ADMIN_ID).expect(401);
    const fresh = await login('admin@example.test');
    await get('admin/users', fresh).expect(403);
    await get('permission-test/student', fresh).expect(200);
  });

  it('immediately invalidates an ADMIN session after self-deletion', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/admin/users/${ADMIN_ID}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(204);
    await get('admin/users', adminToken).expect(401);
    await get('permission-test', adminToken).expect(401);
  });

  it.each(['missing', 'null'] as const)(
    'accepts a legacy token with %s account version and reads current account data',
    async (version) => {
      setLegacyVersion(version);
      const token = legacyToken();
      prisma.users.get(TARGET_ID)!.email = 'new-email@example.test';
      const response = await get('permission-test', token).expect(200);
      expect(response.body).toEqual({
        id: TARGET_ID,
        email: 'new-email@example.test',
        role: Role.STUDENT,
      });
      const fresh = await login('new-email@example.test');
      expect(jwt.decode(fresh).authVersion).toBe(0);
    },
  );

  it.each(['missing', 'null'] as const)(
    'initializes a %s legacy account version before incrementing it and never revives its old token',
    async (version) => {
      setLegacyVersion(version);
      const token = legacyToken();
      await changeRole(Role.EXAM_MANAGER).expect(200);
      expect(prisma.users.get(TARGET_ID)?.authVersion).toBe(1);
      await get('permission-test', token).expect(401);
      await changeRole(Role.STUDENT).expect(200);
      expect(prisma.users.get(TARGET_ID)?.authVersion).toBe(2);
      await get('permission-test/student', token).expect(401);
      await get('permission-test/student', await login()).expect(200);
    },
  );

  it.each(['missing', 'null'] as const)(
    'keeps a legacy session valid when reassigning its current role with %s account version',
    async (version) => {
      setLegacyVersion(version);
      const token = legacyToken();
      await changeRole(Role.STUDENT).expect(200);
      expect(prisma.users.get(TARGET_ID)?.authVersion).toBe(0);
      await get('permission-test/student', token).expect(200);
    },
  );

  it.each([-1, 0.5, '0', null, Number.MAX_SAFE_INTEGER + 1])(
    'rejects malformed authVersion claim %j before querying the account',
    async (authVersion) => {
      const token = jwt.sign({
        sub: TARGET_ID,
        email: 'student@example.test',
        role: Role.STUDENT,
        authVersion,
      });
      prisma.user.findUnique.mockClear();
      await get('permission-test', token).expect(401);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    },
  );

  it('rejects a validly shaped but mismatched version or role', async () => {
    const claims = {
      sub: TARGET_ID,
      email: 'student@example.test',
      role: Role.STUDENT,
      authVersion: 0,
    };
    for (const token of [
      jwt.sign({ ...claims, authVersion: 1 }),
      jwt.sign({ ...claims, role: Role.ADMIN }),
    ]) {
      await get('permission-test', token).expect(401);
    }
  });

  it.each([{}, { role: 'UNKNOWN_ROLE' }, { role: Role.STUDENT, extra: true }])(
    'rejects invalid role update %j without changing sessions',
    async (body) => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/users/${TARGET_ID}/role`)
        .auth(adminToken, { type: 'bearer' })
        .send(body)
        .expect(400);
      expect(prisma.users.get(TARGET_ID)?.authVersion).toBe(0);
      await get('permission-test/student').expect(200);
    },
  );

  it('returns 404 when attempting to update or delete a missing account', async () => {
    await changeRole(Role.EXAM_MANAGER, MISSING_ID).expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/admin/users/${MISSING_ID}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(404);
    await expect(
      app.get(UsersRepository).updateRole(MISSING_ID, Role.ADMIN),
    ).rejects.toMatchObject({ status: 404 });
  });

  it.each(['invalid-id', '22222222222222222222222z', '2222222222222222222222222'])(
    'rejects malformed account ID %s before querying or modifying it',
    async (id) => {
      prisma.user.findUnique.mockClear();
      await get(`admin/users/${id}`, adminToken).expect(400);
      await changeRole(Role.ADMIN, id).expect(400);
      await request(app.getHttpServer())
        .delete(`/api/v1/admin/users/${id}`)
        .auth(adminToken, { type: 'bearer' })
        .expect(400);
      for (const [{ where }] of prisma.user.findUnique.mock.calls) {
        expect(where.id).not.toBe(id);
      }
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.user.delete).not.toHaveBeenCalled();
      await get('permission-test/student').expect(200);
    },
  );

  it.each(['P2014', 'P2003'])(
    'returns 409 for a related-account deletion failure %s and preserves its sessions',
    async (code) => {
      prisma.user.delete.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Required relation', {
          code,
          clientVersion: '6.19.3',
        }),
      );
      const denied = await request(app.getHttpServer())
        .delete(`/api/v1/admin/users/${TARGET_ID}`)
        .auth(adminToken, { type: 'bearer' })
        .expect(409);
      expect(denied.body.message).toBe(
        'User cannot be deleted while they own exams or attempts',
      );
      expect(prisma.users.has(TARGET_ID)).toBe(true);
      await get('permission-test/student').expect(200);
    },
  );

  it('returns 404 when deletion loses a race with another deletion', async () => {
    prisma.user.delete.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '6.19.3',
      }),
    );
    await request(app.getHttpServer())
      .delete(`/api/v1/admin/users/${TARGET_ID}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(404);
  });

  it('fails closed with a server error when account storage is unavailable and permits the unchanged session after recovery', async () => {
    prisma.user.findUnique.mockRejectedValueOnce(
      new Error('Database unavailable'),
    );
    await get('permission-test/student').expect(500);
    expect(prisma.users.get(TARGET_ID)?.authVersion).toBe(0);
    await get('permission-test/student').expect(200);
  });
});
