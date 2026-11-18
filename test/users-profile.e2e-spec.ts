import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

const USER_ID = '507f1f77bcf86cd799439011';

describe('Users Profile (e2e)', () => {
  let app: INestApplication<App>;
  let accessToken: string;

  let userRecord: {
    id: string;
    email: string;
    passwordHash: string;
    fullName: string;
    role: Role;
    avatar: string | null;
    cover: string | null;
    workplace: string | null;
    currentResidence: string | null;
    authVersion: number;
    createdAt: Date;
    updatedAt: Date;
  };

  const mockPrismaUser = {
    findUnique: jest.fn(),
    update: jest.fn(),
  };

  const mockRevokedToken = {
    findUnique: jest.fn(),
  };

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'users-profile-e2e-secret';
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    userRecord = {
      id: USER_ID,
      email: 'student@example.com',
      passwordHash: '$2b$12$hashedpassword',
      fullName: 'Nguyen Van An',
      role: Role.STUDENT,
      avatar: 'https://s3.example.com/avatars/old-avatar.jpg',
      cover: 'https://s3.example.com/covers/old-cover.jpg',
      workplace: 'HCMUT',
      currentResidence: 'Ho Chi Minh City',
      authVersion: 0,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    mockRevokedToken.findUnique.mockResolvedValue(null);
    mockPrismaUser.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        where.id === userRecord.id ? { ...userRecord } : null,
    );
    mockPrismaUser.update.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        if (where.id !== userRecord.id) return null;
        userRecord = {
          ...userRecord,
          ...data,
          updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        };
        return { ...userRecord };
      },
    );

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        revokedToken: mockRevokedToken,
        user: mockPrismaUser,
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    const jwt = app.get(JwtService);
    accessToken = jwt.sign({
      sub: userRecord.id,
      email: userRecord.email,
      role: userRecord.role,
      authVersion: userRecord.authVersion,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('PATCH /api/v1/users/me persists valid avatar and cover URLs and strips sensitive fields', async () => {
    const newAvatar = 'https://s3.example.com/avatars/user-123.jpg';
    const newCover = 'https://s3.example.com/covers/user-123.jpg';

    const res = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ avatar: newAvatar, cover: newCover })
      .expect(200);

    expect(res.body.avatar).toBe(newAvatar);
    expect(res.body.cover).toBe(newCover);
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(res.body).not.toHaveProperty('authVersion');
    expect(mockPrismaUser.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { avatar: newAvatar, cover: newCover },
    });
  });

  it('PATCH /api/v1/users/me accepts null to clear avatar and cover', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ avatar: null, cover: null })
      .expect(200);

    expect(res.body.avatar).toBeNull();
    expect(res.body.cover).toBeNull();
    expect(mockPrismaUser.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { avatar: null, cover: null },
    });
  });

  it('PATCH /api/v1/users/me rejects Base64 image data URIs with 400', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
      })
      .expect(400);

    expect(mockPrismaUser.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/v1/users/me rejects invalid URLs with 400', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ cover: 'not-a-valid-url' })
      .expect(400);

    expect(mockPrismaUser.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/v1/users/me rejects URLs longer than 500 characters with 400', async () => {
    const prefix = 'https://s3.example.com/avatars/';
    const longUrl = prefix + 'a'.repeat(501 - prefix.length);

    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ avatar: longUrl })
      .expect(400);

    expect(mockPrismaUser.update).not.toHaveBeenCalled();
  });
});
