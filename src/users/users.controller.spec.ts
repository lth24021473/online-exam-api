import 'reflect-metadata';
import {
  BadRequestException,
  HttpStatus,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import request from 'supertest';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TokenRevocationService } from '../auth/token-revocation.service';
import { PrismaService } from '../database/prisma.service';
import {
  PresignedUploadUrlResult,
  StorageService,
} from '../storage/storage.service';
import { GenerateUploadUrlDto } from './dto/generate-upload-url.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('GenerateUploadUrlDto validation', () => {
  it.each([
    ['image/jpeg', 'avatars'],
    ['image/png', 'avatars'],
    ['image/webp', 'avatars'],
    ['image/jpeg', 'covers'],
    ['image/png', 'covers'],
    ['image/webp', 'covers'],
  ] as const)(
    'accepts valid mimeType %s and folder %s',
    async (mimeType, folder) => {
      const dto = plainToInstance(GenerateUploadUrlDto, {
        fileName: '  profile-photo.png  ',
        mimeType,
        folder,
      });

      const errors = await validate(dto);

      expect(errors).toHaveLength(0);
      expect(dto.fileName).toBe('profile-photo.png');
      expect(dto.mimeType).toBe(mimeType);
      expect(dto.folder).toBe(folder);
    },
  );

  it.each(['', '   ', undefined, null, 123])(
    'rejects invalid fileName (%p)',
    async (fileName) => {
      const dto = plainToInstance(GenerateUploadUrlDto, {
        fileName,
        mimeType: 'image/png',
        folder: 'avatars',
      });

      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'fileName')).toBe(true);
    },
  );

  it.each([
    'image/gif',
    'application/pdf',
    'text/plain',
    '',
    undefined,
    null,
    123,
  ])('rejects unsupported mimeType (%p)', async (mimeType) => {
    const dto = plainToInstance(GenerateUploadUrlDto, {
      fileName: 'avatar.png',
      mimeType,
      folder: 'avatars',
    });

    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'mimeType')).toBe(true);
  });

  it.each([
    ['exe', 'application/x-msdownload'],
    ['exe', 'application/x-dosexec'],
    ['exe', 'application/vnd.microsoft.portable-executable'],
    ['js', 'application/javascript'],
    ['js', 'text/javascript'],
    ['html', 'text/html'],
    ['html', 'application/xhtml+xml'],
    ['sh', 'application/x-sh'],
    ['sh', 'text/x-shellscript'],
    ['svg', 'image/svg+xml'],
    ['uppercase-image', 'IMAGE/PNG'],
    ['null', null],
  ] as const)(
    'rejects non-image or malicious %s mimeType (%p)',
    async (_category, mimeType) => {
      const dto = plainToInstance(GenerateUploadUrlDto, {
        fileName: 'payload.png',
        mimeType,
        folder: 'avatars',
      });

      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'mimeType')).toBe(true);
    },
  );

  it.each(['exams', 'profiles', '../avatars', '', undefined, 123])(
    'rejects invalid folder (%p)',
    async (folder) => {
      const dto = plainToInstance(GenerateUploadUrlDto, {
        fileName: 'avatar.png',
        mimeType: 'image/png',
        folder,
      });

      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'folder')).toBe(true);
    },
  );
});

describe('UsersController unit & metadata', () => {
  let controller: UsersController;

  const mockUsersService = {
    updateProfile: jest.fn(),
  };

  const mockStorageService = {
    generatePresignedUploadUrl: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        { provide: StorageService, useValue: mockStorageService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('protects UsersController with JwtAuthGuard and sets HTTP 200 on generateUploadUrl', () => {
    const classGuards = Reflect.getMetadata(GUARDS_METADATA, UsersController);
    const httpCode = Reflect.getMetadata(
      HTTP_CODE_METADATA,
      UsersController.prototype.generateUploadUrl,
    );

    expect(classGuards).toContain(JwtAuthGuard);
    expect(httpCode).toBe(HttpStatus.OK);
  });

  it('delegates generateUploadUrl to StorageService with authenticated user id', async () => {
    const expected: PresignedUploadUrlResult = {
      uploadUrl: 'https://s3.example.com/presigned-put',
      filePublicUrl: 'https://cdn.example.com/avatars/u1-avatar.png',
      key: 'avatars/507f1f77bcf86cd799439011-1700000000-uuid.png',
      expiresIn: 300,
    };
    mockStorageService.generatePresignedUploadUrl.mockResolvedValue(expected);

    const req = {
      user: {
        id: '507f1f77bcf86cd799439011',
      },
    } as AuthenticatedRequest;
    const dto: GenerateUploadUrlDto = {
      fileName: 'avatar.png',
      mimeType: 'image/png',
      folder: 'avatars',
    };

    const result = await controller.generateUploadUrl(req, dto);

    expect(mockStorageService.generatePresignedUploadUrl).toHaveBeenCalledTimes(
      1,
    );
    expect(mockStorageService.generatePresignedUploadUrl).toHaveBeenCalledWith({
      userId: '507f1f77bcf86cd799439011',
      fileName: 'avatar.png',
      mimeType: 'image/png',
      folder: 'avatars',
    });
    expect(result).toEqual(expected);
  });

  it('delegates updateProfile to UsersService with authenticated user id and dto', async () => {
    const dto: UpdateProfileDto = {
      avatar: 'https://s3.example.com/avatars/user-123.jpg',
      cover: null,
    };
    const expected = {
      id: '507f1f77bcf86cd799439011',
      email: 'student@example.com',
      fullName: 'Nguyen Van An',
      role: Role.STUDENT,
      avatar: 'https://s3.example.com/avatars/user-123.jpg',
      cover: null,
    };
    mockUsersService.updateProfile.mockResolvedValue(expected);

    const req = {
      user: {
        id: '507f1f77bcf86cd799439011',
      },
    } as AuthenticatedRequest;

    const result = await controller.updateProfile(req, dto);

    expect(mockUsersService.updateProfile).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      dto,
    );
    expect(result).toEqual(expected);
  });
});

describe('UsersController HTTP flow (POST /api/v1/users/me/upload-url)', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const userId = '507f1f77bcf86cd799439011';
  const authUser = {
    id: userId,
    email: 'student@example.com',
    role: Role.STUDENT,
    authVersion: 0,
    fullName: 'Nguyen Van An',
    avatar: null,
    cover: null,
    workplace: null,
    currentResidence: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const mockRevokedToken = {
    findUnique: jest.fn(),
  };

  const mockPrismaUser = {
    findUnique: jest.fn(),
  };

  const mockUsersService = {
    updateProfile: jest.fn(),
  };

  const mockStorageService = {
    generatePresignedUploadUrl: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'users-upload-url-test-secret',
          signOptions: { expiresIn: 3600 },
        }),
      ],
      controllers: [UsersController],
      providers: [
        JwtAuthGuard,
        TokenRevocationService,
        {
          provide: PrismaService,
          useValue: {
            revokedToken: mockRevokedToken,
            user: mockPrismaUser,
          },
        },
        { provide: UsersService, useValue: mockUsersService },
        { provide: StorageService, useValue: mockStorageService },
      ],
    }).compile();

    jwtService = module.get(JwtService);
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
    mockRevokedToken.findUnique.mockResolvedValue(null);
    mockPrismaUser.findUnique.mockResolvedValue(authUser);
  });

  afterAll(async () => {
    await app.close();
  });

  const signAccessToken = (overrides?: Record<string, unknown>) =>
    jwtService.signAsync({
      sub: authUser.id,
      email: authUser.email,
      role: authUser.role,
      authVersion: authUser.authVersion,
      ...overrides,
    });

  it('rejects unauthenticated requests without Authorization header (401)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/users/me/upload-url')
      .send({
        fileName: 'avatar.png',
        mimeType: 'image/png',
        folder: 'avatars',
      })
      .expect(401);

    expect(
      mockStorageService.generatePresignedUploadUrl,
    ).not.toHaveBeenCalled();
  });

  it.each([
    ['non-Bearer scheme', 'Basic dXNlcjpwYXNz'],
    ['empty Bearer token', 'Bearer '],
    ['malformed Bearer token', 'Bearer invalid.jwt.token'],
  ])('rejects %s Authorization header (401)', async (_label, authHeader) => {
    await request(app.getHttpServer())
      .post('/api/v1/users/me/upload-url')
      .set('Authorization', authHeader)
      .send({
        fileName: 'avatar.png',
        mimeType: 'image/png',
        folder: 'avatars',
      })
      .expect(401);

    expect(
      mockStorageService.generatePresignedUploadUrl,
    ).not.toHaveBeenCalled();
  });

  it('rejects expired JWT tokens (401)', async () => {
    const expiredToken = await jwtService.signAsync(
      {
        sub: authUser.id,
        email: authUser.email,
        role: authUser.role,
        authVersion: authUser.authVersion,
      },
      { expiresIn: -10 },
    );

    await request(app.getHttpServer())
      .post('/api/v1/users/me/upload-url')
      .set('Authorization', `Bearer ${expiredToken}`)
      .send({
        fileName: 'avatar.png',
        mimeType: 'image/png',
        folder: 'avatars',
      })
      .expect(401);

    expect(
      mockStorageService.generatePresignedUploadUrl,
    ).not.toHaveBeenCalled();
  });

  it('rejects JWT tokens signed with wrong secret (401)', async () => {
    const wrongSecretJwt = new JwtService({
      secret: 'wrong-upload-url-test-secret',
    });
    const wrongSecretToken = await wrongSecretJwt.signAsync({
      sub: authUser.id,
      email: authUser.email,
      role: authUser.role,
      authVersion: authUser.authVersion,
    });

    await request(app.getHttpServer())
      .post('/api/v1/users/me/upload-url')
      .set('Authorization', `Bearer ${wrongSecretToken}`)
      .send({
        fileName: 'avatar.png',
        mimeType: 'image/png',
        folder: 'avatars',
      })
      .expect(401);

    expect(
      mockStorageService.generatePresignedUploadUrl,
    ).not.toHaveBeenCalled();
  });

  it('rejects refresh tokens used as access token (401)', async () => {
    const refreshToken = await signAccessToken({ tokenType: 'refresh' });

    await request(app.getHttpServer())
      .post('/api/v1/users/me/upload-url')
      .set('Authorization', `Bearer ${refreshToken}`)
      .send({
        fileName: 'avatar.png',
        mimeType: 'image/png',
        folder: 'avatars',
      })
      .expect(401);

    expect(
      mockStorageService.generatePresignedUploadUrl,
    ).not.toHaveBeenCalled();
  });

  it('rejects revoked tokens (401)', async () => {
    const token = await signAccessToken();
    mockRevokedToken.findUnique.mockResolvedValue({ id: 'revoked-1' });

    await request(app.getHttpServer())
      .post('/api/v1/users/me/upload-url')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'avatar.png',
        mimeType: 'image/png',
        folder: 'avatars',
      })
      .expect(401);

    expect(
      mockStorageService.generatePresignedUploadUrl,
    ).not.toHaveBeenCalled();
  });

  it('rejects tokens for deleted user accounts (401)', async () => {
    const token = await signAccessToken();
    mockPrismaUser.findUnique.mockResolvedValueOnce(null);

    await request(app.getHttpServer())
      .post('/api/v1/users/me/upload-url')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'avatar.png',
        mimeType: 'image/png',
        folder: 'avatars',
      })
      .expect(401);

    expect(
      mockStorageService.generatePresignedUploadUrl,
    ).not.toHaveBeenCalled();
  });

  it('rejects tokens with stale authVersion or mismatched role (401)', async () => {
    const token = await signAccessToken({ authVersion: 0, role: Role.STUDENT });

    mockPrismaUser.findUnique.mockResolvedValueOnce({
      ...authUser,
      authVersion: 1,
    });
    await request(app.getHttpServer())
      .post('/api/v1/users/me/upload-url')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'avatar.png',
        mimeType: 'image/png',
        folder: 'avatars',
      })
      .expect(401);

    mockPrismaUser.findUnique.mockResolvedValueOnce({
      ...authUser,
      role: Role.ADMIN,
    });
    await request(app.getHttpServer())
      .post('/api/v1/users/me/upload-url')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'avatar.png',
        mimeType: 'image/png',
        folder: 'avatars',
      })
      .expect(401);

    expect(
      mockStorageService.generatePresignedUploadUrl,
    ).not.toHaveBeenCalled();
  });

  it('rejects empty fileName with 400 without calling StorageService', async () => {
    const token = await signAccessToken();

    await request(app.getHttpServer())
      .post('/api/v1/users/me/upload-url')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: '',
        mimeType: 'image/png',
        folder: 'avatars',
      })
      .expect(400);

    expect(
      mockStorageService.generatePresignedUploadUrl,
    ).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only fileName with 400 without calling StorageService', async () => {
    const token = await signAccessToken();

    await request(app.getHttpServer())
      .post('/api/v1/users/me/upload-url')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: '   ',
        mimeType: 'image/png',
        folder: 'avatars',
      })
      .expect(400);

    expect(
      mockStorageService.generatePresignedUploadUrl,
    ).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'exe (application/x-msdownload)',
      fileName: 'payload.exe',
      mimeType: 'application/x-msdownload',
    },
    {
      label: 'exe (application/x-dosexec)',
      fileName: 'installer.exe',
      mimeType: 'application/x-dosexec',
    },
    {
      label: 'exe (application/vnd.microsoft.portable-executable)',
      fileName: 'app.exe',
      mimeType: 'application/vnd.microsoft.portable-executable',
    },
    {
      label: 'js (application/javascript)',
      fileName: 'evil.js',
      mimeType: 'application/javascript',
    },
    {
      label: 'js (text/javascript)',
      fileName: 'script.js',
      mimeType: 'text/javascript',
    },
    {
      label: 'html (text/html)',
      fileName: 'xss.html',
      mimeType: 'text/html',
    },
    {
      label: 'html (application/xhtml+xml)',
      fileName: 'page.xhtml',
      mimeType: 'application/xhtml+xml',
    },
    {
      label: 'sh (application/x-sh)',
      fileName: 'run.sh',
      mimeType: 'application/x-sh',
    },
    {
      label: 'sh (text/x-shellscript)',
      fileName: 'deploy.sh',
      mimeType: 'text/x-shellscript',
    },
    {
      label: 'svg (image/svg+xml)',
      fileName: 'vector.svg',
      mimeType: 'image/svg+xml',
    },
    {
      label: 'gif (image/gif)',
      fileName: 'avatar.gif',
      mimeType: 'image/gif',
    },
    {
      label: 'pdf (application/pdf)',
      fileName: 'document.pdf',
      mimeType: 'application/pdf',
    },
    {
      label: 'uppercase IMAGE/PNG',
      fileName: 'avatar.png',
      mimeType: 'IMAGE/PNG',
    },
    {
      label: 'null mimeType',
      fileName: 'avatar.png',
      mimeType: null,
    },
  ])(
    'rejects non-image or malicious mimeType ($label) with 400 without calling StorageService',
    async ({ fileName, mimeType }) => {
      const token = await signAccessToken();

      const response = await request(app.getHttpServer())
        .post('/api/v1/users/me/upload-url')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fileName,
          mimeType,
          folder: 'avatars',
        })
        .expect(400);

      expect(JSON.stringify(response.body.message)).toContain('mimeType');
      expect(
        mockStorageService.generatePresignedUploadUrl,
      ).not.toHaveBeenCalled();
    },
  );

  it('rejects invalid folder with 400 without calling StorageService', async () => {
    const token = await signAccessToken();

    await request(app.getHttpServer())
      .post('/api/v1/users/me/upload-url')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'avatar.png',
        mimeType: 'image/png',
        folder: 'exams',
      })
      .expect(400);

    expect(
      mockStorageService.generatePresignedUploadUrl,
    ).not.toHaveBeenCalled();
  });

  it('rejects non-whitelisted extra fields with 400 without calling StorageService', async () => {
    const token = await signAccessToken();

    await request(app.getHttpServer())
      .post('/api/v1/users/me/upload-url')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'avatar.png',
        mimeType: 'image/png',
        folder: 'avatars',
        userId: 'attacker-id',
      })
      .expect(400);

    expect(
      mockStorageService.generatePresignedUploadUrl,
    ).not.toHaveBeenCalled();
  });

  it('returns HTTP 200 and upload info when authenticated user submits valid avatar payload', async () => {
    const token = await signAccessToken();
    const expected: PresignedUploadUrlResult = {
      uploadUrl: 'https://bucket.s3.amazonaws.com/avatars/presigned',
      filePublicUrl: 'https://cdn.example.com/avatars/507f1f77-avatar.png',
      key: 'avatars/507f1f77bcf86cd799439011-1700000000-uuid.png',
      expiresIn: 300,
    };
    mockStorageService.generatePresignedUploadUrl.mockResolvedValue(expected);

    const response = await request(app.getHttpServer())
      .post('/api/v1/users/me/upload-url')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: '  avatar.png  ',
        mimeType: 'image/png',
        folder: 'avatars',
      })
      .expect(200);

    expect(response.body).toEqual(expected);
    expect(mockStorageService.generatePresignedUploadUrl).toHaveBeenCalledTimes(
      1,
    );
    expect(mockStorageService.generatePresignedUploadUrl).toHaveBeenCalledWith({
      userId: authUser.id,
      fileName: 'avatar.png',
      mimeType: 'image/png',
      folder: 'avatars',
    });
  });

  it('returns HTTP 200 for avatar uploads with image/jpeg', async () => {
    const token = await signAccessToken();
    const expected: PresignedUploadUrlResult = {
      uploadUrl: 'https://bucket.s3.amazonaws.com/avatars/presigned-jpeg',
      filePublicUrl: 'https://cdn.example.com/avatars/507f1f77-photo.jpg',
      key: 'avatars/507f1f77bcf86cd799439011-1700000000-uuid.jpg',
      expiresIn: 300,
    };
    mockStorageService.generatePresignedUploadUrl.mockResolvedValue(expected);

    const response = await request(app.getHttpServer())
      .post('/api/v1/users/me/upload-url')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        folder: 'avatars',
      })
      .expect(200);

    expect(response.body).toEqual(expected);
    expect(mockStorageService.generatePresignedUploadUrl).toHaveBeenCalledWith({
      userId: authUser.id,
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      folder: 'avatars',
    });
  });

  it('returns HTTP 200 for cover uploads with image/webp', async () => {
    const token = await signAccessToken();
    const expected: PresignedUploadUrlResult = {
      uploadUrl: 'https://bucket.s3.amazonaws.com/covers/presigned',
      filePublicUrl: 'https://cdn.example.com/covers/507f1f77-cover.webp',
      key: 'covers/507f1f77bcf86cd799439011-1700000000-uuid.webp',
      expiresIn: 300,
    };
    mockStorageService.generatePresignedUploadUrl.mockResolvedValue(expected);

    const response = await request(app.getHttpServer())
      .post('/api/v1/users/me/upload-url')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'cover.webp',
        mimeType: 'image/webp',
        folder: 'covers',
      })
      .expect(200);

    expect(response.body).toEqual(expected);
    expect(mockStorageService.generatePresignedUploadUrl).toHaveBeenCalledWith({
      userId: authUser.id,
      fileName: 'cover.webp',
      mimeType: 'image/webp',
      folder: 'covers',
    });
  });

  it('propagates BadRequestException (400) from StorageService', async () => {
    const token = await signAccessToken();
    mockStorageService.generatePresignedUploadUrl.mockRejectedValue(
      new BadRequestException('Invalid fileName'),
    );

    await request(app.getHttpServer())
      .post('/api/v1/users/me/upload-url')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: '../secret.png',
        mimeType: 'image/png',
        folder: 'avatars',
      })
      .expect(400);
  });
});

describe('UsersController HTTP flow (PATCH /api/v1/users/me) & Swagger contract', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const userId = '507f1f77bcf86cd799439011';
  const authUser = {
    id: userId,
    email: 'student@example.com',
    role: Role.STUDENT,
    authVersion: 0,
    fullName: 'Nguyen Van An',
    avatar: null,
    cover: null,
    workplace: null,
    currentResidence: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const mockRevokedToken = {
    findUnique: jest.fn(),
  };

  const mockPrismaUser = {
    findUnique: jest.fn(),
  };

  const mockUsersService = {
    updateProfile: jest.fn(),
  };

  const mockStorageService = {
    generatePresignedUploadUrl: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'users-profile-http-test-secret',
          signOptions: { expiresIn: 3600 },
        }),
      ],
      controllers: [UsersController],
      providers: [
        JwtAuthGuard,
        TokenRevocationService,
        {
          provide: PrismaService,
          useValue: {
            revokedToken: mockRevokedToken,
            user: mockPrismaUser,
          },
        },
        { provide: UsersService, useValue: mockUsersService },
        { provide: StorageService, useValue: mockStorageService },
      ],
    }).compile();

    jwtService = module.get(JwtService);
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
    mockRevokedToken.findUnique.mockResolvedValue(null);
    mockPrismaUser.findUnique.mockResolvedValue(authUser);
  });

  afterAll(async () => {
    await app.close();
  });

  const signAccessToken = () =>
    jwtService.signAsync({
      sub: authUser.id,
      email: authUser.email,
      role: authUser.role,
      authVersion: authUser.authVersion,
    });

  it('rejects unauthenticated PATCH /api/v1/users/me with 401', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .send({ avatar: 'https://s3.example.com/avatars/user-123.jpg' })
      .expect(401);

    expect(mockUsersService.updateProfile).not.toHaveBeenCalled();
  });

  it('accepts valid avatar and cover URLs on PATCH /api/v1/users/me (200)', async () => {
    const token = await signAccessToken();
    const payload = {
      avatar: 'https://s3.example.com/avatars/user-123.jpg',
      cover: 'https://s3.example.com/covers/user-123.jpg',
    };
    mockUsersService.updateProfile.mockResolvedValue({
      ...authUser,
      ...payload,
    });

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
      .expect(200);

    expect(response.body.avatar).toBe(payload.avatar);
    expect(response.body.cover).toBe(payload.cover);
    expect(mockUsersService.updateProfile).toHaveBeenCalledWith(
      userId,
      expect.objectContaining(payload),
    );
  });

  it('accepts null values to clear avatar and cover on PATCH /api/v1/users/me (200)', async () => {
    const token = await signAccessToken();
    mockUsersService.updateProfile.mockResolvedValue({
      ...authUser,
      avatar: null,
      cover: null,
    });

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ avatar: null, cover: null })
      .expect(200);

    expect(response.body.avatar).toBeNull();
    expect(response.body.cover).toBeNull();
    expect(mockUsersService.updateProfile).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ avatar: null, cover: null }),
    );
  });

  it('accepts omitted avatar and cover when updating other fields (200)', async () => {
    const token = await signAccessToken();
    mockUsersService.updateProfile.mockResolvedValue({
      ...authUser,
      fullName: 'Updated Name',
    });

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Updated Name' })
      .expect(200);

    expect(response.body.fullName).toBe('Updated Name');
    expect(mockUsersService.updateProfile).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'Base64 avatar data URI',
      { avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' },
    ],
    [
      'Base64 cover data URI',
      { cover: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' },
    ],
    ['invalid avatar URL', { avatar: 'not-a-valid-url' }],
    ['invalid cover URL', { cover: 'not-a-valid-url' }],
    [
      'avatar URL > 500 characters',
      {
        avatar:
          'https://s3.example.com/avatars/' +
          'a'.repeat(501 - 'https://s3.example.com/avatars/'.length),
      },
    ],
    [
      'cover URL > 500 characters',
      {
        cover:
          'https://s3.example.com/covers/' +
          'a'.repeat(501 - 'https://s3.example.com/covers/'.length),
      },
    ],
    ['non-whitelisted field', { role: 'ADMIN' }],
  ])('rejects %s with 400 without calling UsersService', async (_label, body) => {
    const token = await signAccessToken();

    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(400);

    expect(mockUsersService.updateProfile).not.toHaveBeenCalled();
  });

  it('documents UpdateProfileDto URL examples and 3-step upload flow in Swagger OpenAPI spec', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );

    const updateProfileSchema = document.components?.schemas
      ?.UpdateProfileDto as any;
    expect(updateProfileSchema).toBeDefined();
    expect(updateProfileSchema.properties.avatar.example).toBe(
      'https://s3.example.com/avatars/user-123.jpg',
    );
    expect(updateProfileSchema.properties.avatar.maxLength).toBe(500);
    expect(updateProfileSchema.properties.avatar.nullable).toBe(true);
    expect(updateProfileSchema.properties.avatar.format).toBe('uri');
    expect(updateProfileSchema.properties.cover.example).toBe(
      'https://s3.example.com/covers/user-123.jpg',
    );
    expect(updateProfileSchema.properties.cover.maxLength).toBe(500);
    expect(updateProfileSchema.properties.cover.nullable).toBe(true);
    expect(updateProfileSchema.properties.cover.format).toBe('uri');
    expect(JSON.stringify(updateProfileSchema).toLowerCase()).not.toContain(
      'base64',
    );
    expect(JSON.stringify(updateProfileSchema).toLowerCase()).not.toContain(
      'data:image',
    );

    const uploadUrlResponseSchema = document.components?.schemas
      ?.UploadUrlResponseDto as any;
    expect(uploadUrlResponseSchema).toBeDefined();
    expect(uploadUrlResponseSchema.properties).toHaveProperty('uploadUrl');
    expect(uploadUrlResponseSchema.properties).toHaveProperty('filePublicUrl');
    expect(uploadUrlResponseSchema.properties).toHaveProperty('key');
    expect(uploadUrlResponseSchema.properties).toHaveProperty('expiresIn');

    const uploadOp = document.paths['/api/v1/users/me/upload-url']?.post;
    const updateOp = document.paths['/api/v1/users/me']?.patch;
    expect(uploadOp?.security).toContainEqual({ bearer: [] });
    expect(updateOp?.security).toContainEqual({ bearer: [] });
    expect(uploadOp?.description).toContain('PUT');
    expect(uploadOp?.description).toContain('filePublicUrl');
    expect(updateOp?.description).toContain('filePublicUrl');
    expect(updateOp?.description).toContain('POST /api/v1/users/me/upload-url');
  });
});
