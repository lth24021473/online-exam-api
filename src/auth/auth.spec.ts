import {
  Controller,
  Get,
  INestApplication,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TokenRevocationService } from './token-revocation.service';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { UsersRepository } from '../users/users.repository';
import { UsersController } from '../users/users.controller';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { Role } from '@prisma/client';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

@Controller('protected-test')
class ProtectedTestController {
  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  admin() {
    return { ok: true };
  }

  @Get('manager')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EXAM_MANAGER)
  manager() {
    return { ok: true };
  }

  @Get('student')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  student() {
    return { ok: true };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  get() {
    return { ok: true };
  }
}

describe('Authentication HTTP flow', () => {
  let app: INestApplication;
  let savedUser: any;
  const revokedTokens = new Map<string, unknown>();
  const revokedToken = {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  };
  const repository = {
    findByEmail: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
  };
  const prismaUser = { findUnique: jest.fn() };
  const registration = {
    email: ' Student@Example.com ',
    fullName: ' Nguyen Van An ',
    password: 'Student123',
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'registration-test-secret',
          signOptions: { expiresIn: 3600 },
        }),
      ],
      controllers: [AuthController, ProtectedTestController, UsersController],
      providers: [
        AuthService,
        UsersService,
        JwtAuthGuard,
        RolesGuard,
        TokenRevocationService,
        {
          provide: PrismaService,
          useValue: { revokedToken, user: prismaUser },
        },
        { provide: UsersRepository, useValue: repository },
      ],
    }).compile();
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
  });

  beforeEach(() => {
    jest.resetAllMocks();
    revokedTokens.clear();
    revokedToken.findUnique.mockImplementation(
      async ({ where }) => revokedTokens.get(where.tokenHash) ?? null,
    );
    revokedToken.upsert.mockImplementation(async ({ create }) => {
      revokedTokens.set(create.tokenHash, create);
      return create;
    });
    savedUser = undefined;
    repository.findById.mockImplementation(async (id) =>
      savedUser?.id === id ? savedUser : null,
    );
    prismaUser.findUnique.mockImplementation(async ({ where }) =>
      savedUser?.id === where.id ? savedUser : null,
    );
    repository.findByEmail.mockImplementation(async (email) =>
      savedUser?.email === email ? savedUser : null,
    );
    repository.create.mockImplementation(async (data) => {
      savedUser = {
        id: '507f1f77bcf86cd799439011',
        role: 'STUDENT',
        authVersion: 0,
        ...data,
      };
      return savedUser;
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('documents me with Swagger bearer security', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    expect(document.paths['/api/v1/users/me'].get?.security).toContainEqual({
      bearer: [],
    });
    expect(document.paths['/api/v1/users/me'].get?.responses).toHaveProperty(
      '401',
    );
  });

  it('returns the authenticated user without passwordHash and rejects deleted accounts', async () => {
    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registration)
      .expect(201);
    const me = () =>
      request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${registered.body.accessToken}`);
    const response = await me().expect(200);
    expect(response.body).toEqual(registered.body.user);
    expect(response.body).not.toHaveProperty('passwordHash');
    expect(repository.findById).toHaveBeenCalledWith(savedUser.id);
    savedUser = undefined;
    await me().expect(401);
  });

  it('rejects missing, malformed, expired, wrongly signed and revoked tokens on me', async () => {
    await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
    const jwt = app.get(JwtService);
    const claims = {
      sub: '507f1f77bcf86cd799439011',
      email: 'student@example.com',
      role: Role.STUDENT,
    };
    const tokens = [
      'invalid',
      jwt.sign(claims, { expiresIn: -1 }),
      jwt.sign(claims, { secret: 'wrong-secret' }),
      jwt.sign({ ...claims, role: 'UNKNOWN_ROLE' }),
      jwt.sign({ ...claims, sub: 'invalid-id' }),
      new JwtService({ secret: 'registration-test-secret' }).sign(claims),
    ];
    const revoked = jwt.sign(claims);
    await app
      .get(TokenRevocationService)
      .revoke(revoked, jwt.decode(revoked).exp!);
    for (const token of [...tokens, revoked]) {
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    }
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it.each([Role.STUDENT, Role.EXAM_MANAGER, Role.ADMIN])(
    'enforces role boundaries for %s',
    async (role) => {
      savedUser = {
        id: '507f1f77bcf86cd799439011',
        email: 'user@example.com',
        role,
        authVersion: 0,
      };
      const token = app.get(JwtService).sign({
        sub: '507f1f77bcf86cd799439011',
        email: 'user@example.com',
        role,
      });
      for (const [route, required] of [
        ['student', Role.STUDENT],
        ['manager', Role.EXAM_MANAGER],
        ['admin', Role.ADMIN],
      ]) {
        await request(app.getHttpServer())
          .get(`/api/v1/protected-test/${route}`)
          .expect(401);
        await request(app.getHttpServer())
          .get(`/api/v1/protected-test/${route}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(role === required ? 200 : 403);
      }
    },
  );

  it('registers with a hashed password and allows subsequent login', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registration)
      .expect(201);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.user).toMatchObject({
      email: 'student@example.com',
      fullName: 'Nguyen Van An',
      role: 'STUDENT',
    });
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(savedUser.passwordHash).not.toBe(registration.password);
    expect(
      await bcrypt.compare(registration.password, savedUser.passwordHash),
    ).toBe(true);
    expect(repository.create.mock.calls[0][0]).not.toHaveProperty('role');
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: registration.email, password: registration.password })
      .expect(200);
    expect(login.body.user).toEqual(response.body.user);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: registration.email, password: 'incorrect' })
      .expect(401);
  });

  it('rejects an already registered email', async () => {
    savedUser = { email: 'student@example.com' };
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registration)
      .expect(409);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('handles a concurrent duplicate registration', async () => {
    repository.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Duplicate', {
        code: 'P2002',
        clientVersion: '6.19.0',
      }),
    );
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registration)
      .expect(409);
  });

  it.each([
    { email: 'invalid' },
    { fullName: '   ' },
    { fullName: 123 },
    { password: '12345' },
    { password: 'a'.repeat(73) },
    { password: '界'.repeat(25) },
    { role: 'EXAM_MANAGER' },
    { password: null },
  ])('rejects invalid input %j', async (change) => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ ...registration, ...change })
      .expect(400);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('requires all registration fields', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({})
      .expect(400);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('revokes only the current token and permits a fresh login', async () => {
    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registration)
      .expect(201);
    const token = registered.body.accessToken;
    const login = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: registration.email, password: registration.password });
    const second = await login().expect(200);
    expect(second.body.accessToken).not.toBe(token);
    const protectedRequest = (value: string) =>
      request(app.getHttpServer())
        .get('/api/v1/protected-test')
        .set('Authorization', `Bearer ${value}`);
    await protectedRequest(token).expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(204)
      .expect('');
    const stored = revokedToken.upsert.mock.calls[0][0].create;
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.expiresAt).toBeInstanceOf(Date);
    await protectedRequest(token).expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    await protectedRequest(second.body.accessToken).expect(200);
    const fresh = await login().expect(200);
    await protectedRequest(fresh.body.accessToken).expect(200);
  });

  it.each(['', 'Basic abc', 'Bearer invalid', 'Bearer abc extra'])(
    'rejects invalid authorization %j',
    async (authorization) => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', authorization)
        .expect(401);
      expect(revokedToken.upsert).not.toHaveBeenCalled();
    },
  );

  it('rejects expired, incorrectly signed and non-expiring tokens', async () => {
    const jwt = app.get(JwtService);
    const tokens = [
      jwt.sign({ sub: 'user' }, { expiresIn: -1 }),
      jwt.sign({ sub: 'user' }, { secret: 'wrong-secret' }),
      new JwtService({ secret: 'registration-test-secret' }).sign({
        sub: 'user',
      }),
    ];
    for (const token of tokens) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    }
    expect(revokedToken.upsert).not.toHaveBeenCalled();
  });
});
