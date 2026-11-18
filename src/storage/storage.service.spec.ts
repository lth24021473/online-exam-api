import 'reflect-metadata';
import { BadRequestException, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  S3Client,
  S3ClientConfig,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageModule } from './storage.module';
import {
  GeneratePresignedUploadUrlParams,
  StorageService,
  UploadFolder,
} from './storage.service';

const mockS3ClientInit = jest.fn();
const mockS3Send = jest.fn();
const mockS3Destroy = jest.fn();

const defaultGetSignedUrlImpl = async (
  _client: S3Client,
  command: { input?: { Key?: string } },
  options?: { expiresIn?: number },
) => {
  const key = command?.input?.Key ?? 'file';
  return `https://mock-signed-url.com/${key}?expiresIn=${options?.expiresIn ?? 3600}`;
};

jest.mock('@aws-sdk/client-s3', () => {
  const actual =
    jest.requireActual<typeof import('@aws-sdk/client-s3')>(
      '@aws-sdk/client-s3',
    );
  class MockS3Client extends actual.S3Client {
    constructor(config: S3ClientConfig) {
      super(config);
      mockS3ClientInit(config);
      this.send = mockS3Send as unknown as typeof this.send;
      this.destroy = mockS3Destroy as unknown as typeof this.destroy;
    }
  }
  return {
    ...actual,
    S3Client: MockS3Client,
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

describe('StorageService', () => {
  let service: StorageService;

  const mockConfig: Record<string, string | undefined> = {
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'online-exam-storage',
    S3_ACCESS_KEY_ID: 'minioadmin',
    S3_SECRET_ACCESS_KEY: 'minioadmin',
    S3_PUBLIC_URL_PREFIX: 'http://localhost:9000/online-exam-storage',
  };

  const createConfigService = (
    overrides: Record<string, string | undefined>,
  ): ConfigService =>
    ({
      get: jest.fn((key: string) =>
        key in overrides ? overrides[key] : mockConfig[key],
      ),
    }) as unknown as ConfigService;

  beforeEach(async () => {
    mockS3ClientInit.mockReset();
    mockS3Send.mockReset();
    mockS3Destroy.mockReset();
    (getSignedUrl as jest.Mock).mockReset();
    (getSignedUrl as jest.Mock).mockImplementation(defaultGetSignedUrlImpl);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => mockConfig[key]),
          },
        },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockS3ClientInit.mockReset();
    mockS3Send.mockReset();
    mockS3Destroy.mockReset();
    (getSignedUrl as jest.Mock).mockReset();
    (getSignedUrl as jest.Mock).mockImplementation(defaultGetSignedUrlImpl);
  });

  describe('StorageModule DI compilation', () => {
    it('should compile StorageModule and provide StorageService', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [() => ({ ...mockConfig })],
          }),
          StorageModule,
        ],
      }).compile();

      const resolved = moduleRef.get<StorageService>(StorageService);
      expect(resolved).toBeInstanceOf(StorageService);
      expect(resolved.getBucket()).toBe('online-exam-storage');
      await moduleRef.close();
    });
  });

  describe('initialization and multi-provider S3ClientConfig', () => {
    it('should be defined and expose S3Client and bucket', () => {
      expect(service).toBeDefined();
      expect(service.getClient()).toBeInstanceOf(S3Client);
      expect(service.getBucket()).toBe('online-exam-storage');
    });

    it('should configure MinIO with custom endpoint, static credentials, and forcePathStyle=true', async () => {
      expect(mockS3ClientInit).toHaveBeenCalledTimes(1);
      expect(mockS3ClientInit).toHaveBeenCalledWith({
        region: 'us-east-1',
        endpoint: 'http://localhost:9000',
        credentials: {
          accessKeyId: 'minioadmin',
          secretAccessKey: 'minioadmin',
        },
        forcePathStyle: true,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });

      const client = service.getClient();
      expect(await client.config.region()).toBe('us-east-1');
      expect(client.config.forcePathStyle).toBe(true);
      expect(await client.config.requestChecksumCalculation()).toBe(
        'WHEN_REQUIRED',
      );
      expect(await client.config.responseChecksumValidation()).toBe(
        'WHEN_REQUIRED',
      );
      const endpoint = await client.config.endpoint?.();
      expect(endpoint?.hostname).toBe('localhost');
      expect(endpoint?.port).toBe(9000);
      expect(await client.config.credentials()).toMatchObject({
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
      });
    });

    it('should configure Cloudflare R2 with auto region, custom endpoint, and forcePathStyle=true', async () => {
      const r2Service = new StorageService(
        createConfigService({
          S3_ENDPOINT: 'https://account123.r2.cloudflarestorage.com',
          S3_REGION: 'auto',
          S3_BUCKET: 'r2-exams',
          S3_ACCESS_KEY_ID: 'r2-key',
          S3_SECRET_ACCESS_KEY: 'r2-secret',
          S3_PUBLIC_URL_PREFIX: 'https://cdn.example.com',
        }),
      );

      expect(mockS3ClientInit).toHaveBeenLastCalledWith({
        region: 'auto',
        endpoint: 'https://account123.r2.cloudflarestorage.com',
        credentials: {
          accessKeyId: 'r2-key',
          secretAccessKey: 'r2-secret',
        },
        forcePathStyle: true,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });

      const client = r2Service.getClient();
      expect(r2Service.getBucket()).toBe('r2-exams');
      expect(await client.config.region()).toBe('auto');
      expect(client.config.forcePathStyle).toBe(true);
      const endpoint = await client.config.endpoint?.();
      expect(endpoint?.hostname).toBe('account123.r2.cloudflarestorage.com');
      expect(await client.config.credentials()).toMatchObject({
        accessKeyId: 'r2-key',
        secretAccessKey: 'r2-secret',
      });
    });

    it('should configure AWS S3 without endpoint using virtual-hosted style (forcePathStyle=false)', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const awsService = new StorageService(
        createConfigService({
          S3_ENDPOINT: '   ',
          S3_REGION: 'ap-southeast-1',
          S3_BUCKET: 'aws-exam-bucket',
          S3_ACCESS_KEY_ID: 'aws-key',
          S3_SECRET_ACCESS_KEY: 'aws-secret',
          S3_PUBLIC_URL_PREFIX: '',
        }),
      );

      const awsInitConfig = mockS3ClientInit.mock.calls.at(
        -1,
      )?.[0] as S3ClientConfig;
      expect(awsInitConfig).toEqual({
        region: 'ap-southeast-1',
        credentials: {
          accessKeyId: 'aws-key',
          secretAccessKey: 'aws-secret',
        },
        forcePathStyle: false,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
      expect(awsInitConfig).not.toHaveProperty('endpoint');

      const client = awsService.getClient();
      expect(await client.config.region()).toBe('ap-southeast-1');
      expect(client.config.forcePathStyle).toBe(false);
      expect(client.config.endpoint).toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('endpoint: default-aws'),
      );
    });

    it('should allow S3_FORCE_PATH_STYLE override and fallback to Boolean(endpoint) for unrecognized values', () => {
      const awsForcedPath = new StorageService(
        createConfigService({
          S3_ENDPOINT: undefined,
          S3_FORCE_PATH_STYLE: 'true',
        }),
      );
      expect(awsForcedPath.getClient().config.forcePathStyle).toBe(true);
      expect(mockS3ClientInit).toHaveBeenLastCalledWith(
        expect.objectContaining({ forcePathStyle: true }),
      );

      const minioVirtualHosted = new StorageService(
        createConfigService({
          S3_ENDPOINT: 'http://localhost:9000',
          S3_FORCE_PATH_STYLE: 'false',
        }),
      );
      expect(minioVirtualHosted.getClient().config.forcePathStyle).toBe(false);
      expect(mockS3ClientInit).toHaveBeenLastCalledWith(
        expect.objectContaining({ forcePathStyle: false }),
      );

      const unrecognizedWithEndpoint = new StorageService(
        createConfigService({
          S3_ENDPOINT: 'http://localhost:9000',
          S3_FORCE_PATH_STYLE: 'invalid-bool',
        }),
      );
      expect(unrecognizedWithEndpoint.getClient().config.forcePathStyle).toBe(
        true,
      );
      expect(mockS3ClientInit).toHaveBeenLastCalledWith(
        expect.objectContaining({ forcePathStyle: true }),
      );

      const unrecognizedWithoutEndpoint = new StorageService(
        createConfigService({
          S3_ENDPOINT: undefined,
          S3_FORCE_PATH_STYLE: 'yes',
        }),
      );
      expect(
        unrecognizedWithoutEndpoint.getClient().config.forcePathStyle,
      ).toBe(false);
      expect(mockS3ClientInit).toHaveBeenLastCalledWith(
        expect.objectContaining({ forcePathStyle: false }),
      );
    });

    it('should trim env vars and fall back to defaults for whitespace-only S3_REGION and S3_BUCKET', () => {
      const whitespaceDefaultsService = new StorageService(
        createConfigService({
          S3_ENDPOINT: undefined,
          S3_REGION: '   ',
          S3_BUCKET: '   ',
          S3_ACCESS_KEY_ID: undefined,
          S3_SECRET_ACCESS_KEY: undefined,
          S3_PUBLIC_URL_PREFIX: '   ',
        }),
      );
      expect(whitespaceDefaultsService.getBucket()).toBe('online-exam-storage');
      expect(mockS3ClientInit).toHaveBeenLastCalledWith(
        expect.objectContaining({ region: 'us-east-1', forcePathStyle: false }),
      );

      const trimmedService = new StorageService(
        createConfigService({
          S3_ENDPOINT: '  http://localhost:9000  ',
          S3_REGION: '  eu-west-1  ',
          S3_BUCKET: '  trimmed-bucket  ',
          S3_ACCESS_KEY_ID: '  trimmed-key  ',
          S3_SECRET_ACCESS_KEY: '  trimmed-secret  ',
          S3_PUBLIC_URL_PREFIX: '  https://cdn.example.com/assets/  ',
          S3_FORCE_PATH_STYLE: '  FALSE  ',
        }),
      );
      expect(trimmedService.getBucket()).toBe('trimmed-bucket');
      expect(trimmedService.getPublicUrl('a.png')).toBe(
        'https://cdn.example.com/assets/a.png',
      );
      expect(mockS3ClientInit).toHaveBeenLastCalledWith({
        region: 'eu-west-1',
        endpoint: 'http://localhost:9000',
        credentials: {
          accessKeyId: 'trimmed-key',
          secretAccessKey: 'trimmed-secret',
        },
        forcePathStyle: false,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
    });

    it('should omit static credentials and log a warning when neither credential is provided (IAM chain)', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const iamService = new StorageService(
        createConfigService({
          S3_ENDPOINT: undefined,
          S3_REGION: undefined,
          S3_BUCKET: undefined,
          S3_ACCESS_KEY_ID: undefined,
          S3_SECRET_ACCESS_KEY: undefined,
          S3_PUBLIC_URL_PREFIX: undefined,
        }),
      );

      const iamInitConfig = mockS3ClientInit.mock.calls.at(
        -1,
      )?.[0] as S3ClientConfig;
      expect(iamInitConfig).toEqual({
        region: 'us-east-1',
        forcePathStyle: false,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
      expect(iamInitConfig).not.toHaveProperty('endpoint');
      expect(iamInitConfig).not.toHaveProperty('credentials');

      expect(iamService.getBucket()).toBe('online-exam-storage');
      expect(await iamService.getClient().config.region()).toBe('us-east-1');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('default credential provider chain'),
      );
    });

    it('should throw a configuration error when only one of S3_ACCESS_KEY_ID or S3_SECRET_ACCESS_KEY is provided', () => {
      expect(
        () =>
          new StorageService(
            createConfigService({
              S3_ACCESS_KEY_ID: 'only-key-id',
              S3_SECRET_ACCESS_KEY: undefined,
            }),
          ),
      ).toThrow(/Incomplete S3 credentials configuration/);

      expect(
        () =>
          new StorageService(
            createConfigService({
              S3_ACCESS_KEY_ID: 'only-key-id',
              S3_SECRET_ACCESS_KEY: '   ',
            }),
          ),
      ).toThrow(/Incomplete S3 credentials configuration/);

      expect(
        () =>
          new StorageService(
            createConfigService({
              S3_ACCESS_KEY_ID: '   ',
              S3_SECRET_ACCESS_KEY: 'only-secret',
            }),
          ),
      ).toThrow(/Incomplete S3 credentials configuration/);
    });
  });

  describe('getPublicUrl', () => {
    it('should format URL with configured public URL prefix and clean key', () => {
      const url = service.getPublicUrl('avatars/user-1.png');
      expect(url).toBe(
        'http://localhost:9000/online-exam-storage/avatars/user-1.png',
      );
    });

    it('should strip leading slashes and percent-encode path segments', () => {
      const url = service.getPublicUrl('/documents/final exam #1.pdf');
      expect(url).toBe(
        'http://localhost:9000/online-exam-storage/documents/final%20exam%20%231.pdf',
      );
    });

    it('should normalize trailing slashes from publicUrlPrefix', () => {
      const customService = new StorageService(
        createConfigService({
          S3_PUBLIC_URL_PREFIX: 'http://localhost:9000/online-exam-storage///',
        }),
      );
      expect(customService.getPublicUrl('file.png')).toBe(
        'http://localhost:9000/online-exam-storage/file.png',
      );
    });

    it('should fallback to endpoint/bucket/key when prefix is not set', () => {
      const noPrefixService = new StorageService(
        createConfigService({ S3_PUBLIC_URL_PREFIX: undefined }),
      );
      expect(noPrefixService.getPublicUrl('file.png')).toBe(
        'http://localhost:9000/online-exam-storage/file.png',
      );
    });

    it('should fallback to standard AWS S3 URL when both prefix and endpoint are not set', () => {
      const awsService = new StorageService(
        createConfigService({
          S3_PUBLIC_URL_PREFIX: undefined,
          S3_ENDPOINT: undefined,
          S3_REGION: 'ap-southeast-1',
          S3_BUCKET: 'my-aws-bucket',
          S3_ACCESS_KEY_ID: 'key',
          S3_SECRET_ACCESS_KEY: 'secret',
        }),
      );
      expect(awsService.getPublicUrl('folder/my file.png')).toBe(
        'https://my-aws-bucket.s3.ap-southeast-1.amazonaws.com/folder/my%20file.png',
      );
    });

    it('should respect S3_FORCE_PATH_STYLE in getPublicUrl when S3_PUBLIC_URL_PREFIX is unset', () => {
      const awsPathStyleService = new StorageService(
        createConfigService({
          S3_PUBLIC_URL_PREFIX: undefined,
          S3_ENDPOINT: undefined,
          S3_REGION: 'ap-southeast-1',
          S3_BUCKET: 'my-aws-bucket',
          S3_FORCE_PATH_STYLE: 'true',
        }),
      );
      expect(awsPathStyleService.getPublicUrl('folder/my file.png')).toBe(
        'https://s3.ap-southeast-1.amazonaws.com/my-aws-bucket/folder/my%20file.png',
      );

      const endpointVirtualHostedService = new StorageService(
        createConfigService({
          S3_PUBLIC_URL_PREFIX: undefined,
          S3_ENDPOINT: 'http://localhost:9000',
          S3_FORCE_PATH_STYLE: 'false',
        }),
      );
      expect(
        endpointVirtualHostedService.getPublicUrl('folder/my file.png'),
      ).toBe('http://online-exam-storage.localhost:9000/folder/my%20file.png');

      const endpointWithBasePathService = new StorageService(
        createConfigService({
          S3_PUBLIC_URL_PREFIX: undefined,
          S3_ENDPOINT: 'https://s3.example.com/custom-base/',
          S3_FORCE_PATH_STYLE: 'false',
        }),
      );
      expect(endpointWithBasePathService.getPublicUrl('file.png')).toBe(
        'https://online-exam-storage.s3.example.com/custom-base/file.png',
      );
    });

    it('should normalize trailing slashes from S3_ENDPOINT and trim surrounding spaces on key', () => {
      const noPrefixService = new StorageService(
        createConfigService({
          S3_PUBLIC_URL_PREFIX: undefined,
          S3_ENDPOINT: 'http://localhost:9000///',
        }),
      );
      expect(noPrefixService.getPublicUrl('  /avatars/user 1.png  ')).toBe(
        'http://localhost:9000/online-exam-storage/avatars/user%201.png',
      );
    });

    it('should reject empty keys, non-string keys, and path traversal segments including single-dot segments', () => {
      expect(() => service.getPublicUrl(null as unknown as string)).toThrow(
        /Storage key must be a non-empty string/,
      );
      expect(() =>
        service.getPublicUrl(undefined as unknown as string),
      ).toThrow(/Storage key must be a non-empty string/);
      expect(() => service.getPublicUrl(123 as unknown as string)).toThrow(
        /Storage key must be a non-empty string/,
      );
      expect(() => service.getPublicUrl('')).toThrow(
        /Storage key must not be empty/,
      );
      expect(() => service.getPublicUrl('  ///  ')).toThrow(
        /Storage key must not be empty/,
      );
      expect(() => service.getPublicUrl('../secret/file.txt')).toThrow(
        /path traversal/,
      );
      expect(() => service.getPublicUrl('folder/../secret.txt')).toThrow(
        /path traversal/,
      );
      expect(() => service.getPublicUrl('./a/./b')).toThrow(/path traversal/);
      expect(() => service.getPublicUrl('./file.txt')).toThrow(
        /path traversal/,
      );
      expect(() => service.getPublicUrl('folder/.')).toThrow(/path traversal/);
      expect(() => service.getPublicUrl('folder\\.\\file.txt')).toThrow(
        /path traversal/,
      );
      expect(service.getPublicUrl('docs/v1..v2.pdf')).toBe(
        'http://localhost:9000/online-exam-storage/docs/v1..v2.pdf',
      );
      expect(service.getPublicUrl('docs/.hidden')).toBe(
        'http://localhost:9000/online-exam-storage/docs/.hidden',
      );
    });
  });

  describe('uploadFile', () => {
    it('should upload a file buffer with normalized key and return key and public URL', async () => {
      mockS3Send.mockResolvedValueOnce({});

      const buffer = Buffer.from('test file content');
      const result = await service.uploadFile(
        '/tests/sample file.txt',
        buffer,
        'text/plain',
      );

      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const command = mockS3Send.mock.calls[0][0] as PutObjectCommand;
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'online-exam-storage',
        Key: 'tests/sample file.txt',
        Body: buffer,
        ContentType: 'text/plain',
      });
      expect(result).toEqual({
        key: 'tests/sample file.txt',
        url: 'http://localhost:9000/online-exam-storage/tests/sample%20file.txt',
      });
    });

    it('should upload a string body and trim ContentType', async () => {
      mockS3Send.mockResolvedValueOnce({});

      const result = await service.uploadFile(
        'tests/notes.txt',
        'hello world',
        '  text/plain; charset=utf-8  ',
      );

      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const command = mockS3Send.mock.calls[0][0] as PutObjectCommand;
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'online-exam-storage',
        Key: 'tests/notes.txt',
        Body: 'hello world',
        ContentType: 'text/plain; charset=utf-8',
      });
      expect(result).toEqual({
        key: 'tests/notes.txt',
        url: 'http://localhost:9000/online-exam-storage/tests/notes.txt',
      });
    });

    it('should omit ContentType when contentType is not provided or blank', async () => {
      mockS3Send.mockResolvedValueOnce({});

      await service.uploadFile(
        'tests/raw.bin',
        Uint8Array.from([1, 2, 3]),
        '  ',
      );

      const command = mockS3Send.mock.calls[0][0] as PutObjectCommand;
      expect(command.input.ContentType).toBeUndefined();
      expect('ContentType' in command.input).toBe(false);
    });

    it('should reject invalid or non-string keys before calling S3Client.send', async () => {
      await expect(
        service.uploadFile(null as unknown as string, 'data'),
      ).rejects.toThrow(/Storage key must be a non-empty string/);
      await expect(service.uploadFile('   ', 'data')).rejects.toThrow(
        /Storage key must not be empty/,
      );
      await expect(service.uploadFile('../evil.txt', 'data')).rejects.toThrow(
        /path traversal/,
      );

      expect(mockS3Send).not.toHaveBeenCalled();
    });

    it('should log and rethrow when upload fails with Error or non-Error value', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      mockS3Send.mockRejectedValueOnce(new Error('S3 PutObject error'));

      await expect(
        service.uploadFile('tests/fail.txt', 'data'),
      ).rejects.toThrow('S3 PutObject error');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to upload file "tests/fail.txt"'),
        expect.any(String),
      );

      mockS3Send.mockRejectedValueOnce('raw-upload-failure');
      await expect(
        service.uploadFile('tests/fail-raw.txt', 'data'),
      ).rejects.toBe('raw-upload-failure');
      expect(errorSpy).toHaveBeenLastCalledWith(
        expect.stringContaining(
          'Failed to upload file "tests/fail-raw.txt": raw-upload-failure',
        ),
        undefined,
      );
    });
  });

  describe('presigned URLs', () => {
    it('should generate a presigned upload URL and pass expected PutObjectCommand and options', async () => {
      const url = await service.getPresignedUploadUrl(
        '/uploads/image.png',
        1800,
        'image/png',
      );

      expect(url).toBe(
        'https://mock-signed-url.com/uploads/image.png?expiresIn=1800',
      );
      expect(getSignedUrl).toHaveBeenCalledTimes(1);
      const [clientArg, commandArg, optionsArg] = (getSignedUrl as jest.Mock)
        .mock.calls[0];
      expect(clientArg).toBe(service.getClient());
      expect(commandArg).toBeInstanceOf(PutObjectCommand);
      expect((commandArg as PutObjectCommand).input).toEqual({
        Bucket: 'online-exam-storage',
        Key: 'uploads/image.png',
        ContentType: 'image/png',
      });
      expect(optionsArg).toEqual({ expiresIn: 1800 });
    });

    it('should omit ContentType in presigned upload URL when not specified or blank', async () => {
      const urlUndefined =
        await service.getPresignedUploadUrl('uploads/raw.bin');
      expect(urlUndefined).toBe(
        'https://mock-signed-url.com/uploads/raw.bin?expiresIn=3600',
      );

      const urlBlank = await service.getPresignedUploadUrl(
        'uploads/raw-blank.bin',
        3600,
        '   ',
      );
      expect(urlBlank).toBe(
        'https://mock-signed-url.com/uploads/raw-blank.bin?expiresIn=3600',
      );

      expect(getSignedUrl).toHaveBeenCalledTimes(2);
      const [client0, cmd0, opts0] = (getSignedUrl as jest.Mock).mock.calls[0];
      expect(client0).toBe(service.getClient());
      expect(cmd0).toBeInstanceOf(PutObjectCommand);
      expect((cmd0 as PutObjectCommand).input).toEqual({
        Bucket: 'online-exam-storage',
        Key: 'uploads/raw.bin',
      });
      expect('ContentType' in (cmd0 as PutObjectCommand).input).toBe(false);
      expect(opts0).toEqual({ expiresIn: 3600 });

      const [client1, cmd1, opts1] = (getSignedUrl as jest.Mock).mock.calls[1];
      expect(client1).toBe(service.getClient());
      expect(cmd1).toBeInstanceOf(PutObjectCommand);
      expect((cmd1 as PutObjectCommand).input).toEqual({
        Bucket: 'online-exam-storage',
        Key: 'uploads/raw-blank.bin',
      });
      expect('ContentType' in (cmd1 as PutObjectCommand).input).toBe(false);
      expect(opts1).toEqual({ expiresIn: 3600 });
    });

    it('should trim whitespace-padded ContentType in getPresignedUploadUrl', async () => {
      const url = await service.getPresignedUploadUrl(
        'uploads/trimmed.png',
        900,
        '  image/png  ',
      );

      expect(url).toBe(
        'https://mock-signed-url.com/uploads/trimmed.png?expiresIn=900',
      );
      const [clientArg, commandArg, optionsArg] = (getSignedUrl as jest.Mock)
        .mock.calls[0];
      expect(clientArg).toBe(service.getClient());
      expect(commandArg).toBeInstanceOf(PutObjectCommand);
      expect((commandArg as PutObjectCommand).input).toEqual({
        Bucket: 'online-exam-storage',
        Key: 'uploads/trimmed.png',
        ContentType: 'image/png',
      });
      expect(optionsArg).toEqual({ expiresIn: 900 });
    });

    it('should generate a presigned download URL with default and custom expiration and GetObjectCommand', async () => {
      const defaultUrl =
        await service.getPresignedDownloadUrl('/private/exam.pdf');

      expect(defaultUrl).toBe(
        'https://mock-signed-url.com/private/exam.pdf?expiresIn=3600',
      );
      const [clientArg, commandArg, optionsArg] = (getSignedUrl as jest.Mock)
        .mock.calls[0];
      expect(clientArg).toBe(service.getClient());
      expect(commandArg).toBeInstanceOf(GetObjectCommand);
      expect((commandArg as GetObjectCommand).input).toEqual({
        Bucket: 'online-exam-storage',
        Key: 'private/exam.pdf',
      });
      expect(optionsArg).toEqual({ expiresIn: 3600 });

      const customUrl = await service.getPresignedDownloadUrl(
        '/private/exam-custom.pdf',
        600,
      );
      expect(customUrl).toBe(
        'https://mock-signed-url.com/private/exam-custom.pdf?expiresIn=600',
      );
      const [customClient, customCommand, customOptions] = (
        getSignedUrl as jest.Mock
      ).mock.calls[1];
      expect(customClient).toBe(service.getClient());
      expect(customCommand).toBeInstanceOf(GetObjectCommand);
      expect((customCommand as GetObjectCommand).input).toEqual({
        Bucket: 'online-exam-storage',
        Key: 'private/exam-custom.pdf',
      });
      expect(customOptions).toEqual({ expiresIn: 600 });
    });

    it('should reject invalid or non-string keys before calling getSignedUrl', async () => {
      await expect(
        service.getPresignedUploadUrl(null as unknown as string),
      ).rejects.toThrow(/Storage key must be a non-empty string/);
      await expect(service.getPresignedUploadUrl('   ')).rejects.toThrow(
        /Storage key must not be empty/,
      );
      await expect(
        service.getPresignedUploadUrl('../secret.png'),
      ).rejects.toThrow(/path traversal/);

      await expect(
        service.getPresignedDownloadUrl(123 as unknown as string),
      ).rejects.toThrow(/Storage key must be a non-empty string/);
      await expect(service.getPresignedDownloadUrl('')).rejects.toThrow(
        /Storage key must not be empty/,
      );
      await expect(
        service.getPresignedDownloadUrl('folder/../secret.pdf'),
      ).rejects.toThrow(/path traversal/);

      expect(getSignedUrl).not.toHaveBeenCalled();
    });

    it('should validate integer expiresIn bounds (1..604800) before calling getSignedUrl', async () => {
      await expect(
        service.getPresignedUploadUrl('a.txt', 1),
      ).resolves.toContain('expiresIn=1');
      await expect(
        service.getPresignedDownloadUrl('a.txt', 604800),
      ).resolves.toContain('expiresIn=604800');

      (getSignedUrl as jest.Mock).mockClear();

      await expect(service.getPresignedUploadUrl('a.txt', 0)).rejects.toThrow(
        /expiresIn/,
      );
      await expect(service.getPresignedUploadUrl('a.txt', -1)).rejects.toThrow(
        /expiresIn/,
      );
      await expect(
        service.getPresignedDownloadUrl('a.txt', -1),
      ).rejects.toThrow(/expiresIn/);
      await expect(
        service.getPresignedDownloadUrl('a.txt', 604801),
      ).rejects.toThrow(/expiresIn/);
      await expect(
        service.getPresignedUploadUrl('a.txt', Number.NaN),
      ).rejects.toThrow(/expiresIn/);
      await expect(
        service.getPresignedUploadUrl('a.txt', Number.POSITIVE_INFINITY),
      ).rejects.toThrow(/expiresIn/);
      await expect(
        service.getPresignedDownloadUrl('a.txt', Number.NEGATIVE_INFINITY),
      ).rejects.toThrow(/expiresIn/);
      await expect(service.getPresignedUploadUrl('a.txt', 1.5)).rejects.toThrow(
        /expiresIn/,
      );
      await expect(
        service.getPresignedDownloadUrl('a.txt', 1.5),
      ).rejects.toThrow(/expiresIn/);
      await expect(
        service.getPresignedUploadUrl('a.txt', '300' as unknown as number),
      ).rejects.toThrow(/expiresIn/);
      await expect(
        service.getPresignedDownloadUrl('a.txt', '300' as unknown as number),
      ).rejects.toThrow(/expiresIn/);

      expect(getSignedUrl).not.toHaveBeenCalled();
    });

    it('should sign real unmocked presigned PUT URLs without empty-body CRC32 checksum query params', async () => {
      const actualPresigner = jest.requireActual<
        typeof import('@aws-sdk/s3-request-presigner')
      >('@aws-sdk/s3-request-presigner');
      (getSignedUrl as jest.Mock).mockImplementationOnce(
        actualPresigner.getSignedUrl,
      );

      expect(
        await service.getClient().config.requestChecksumCalculation(),
      ).toBe('WHEN_REQUIRED');

      const signedUrl = await service.getPresignedUploadUrl(
        'folder/test file.pdf',
        300,
        'application/pdf',
      );
      const parsed = new URL(signedUrl);

      expect(`${parsed.origin}${parsed.pathname}`).toBe(
        'http://localhost:9000/online-exam-storage/folder/test%20file.pdf',
      );
      expect(parsed.searchParams.get('X-Amz-Algorithm')).toBe(
        'AWS4-HMAC-SHA256',
      );
      expect(parsed.searchParams.get('X-Amz-Credential')).toContain(
        'minioadmin/',
      );
      expect(parsed.searchParams.get('X-Amz-Credential')).toContain(
        '/us-east-1/s3/aws4_request',
      );
      expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toBeTruthy();
      expect(parsed.searchParams.get('X-Amz-Expires')).toBe('300');
      expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(
        /^[0-9a-f]{64}$/,
      );
      expect(parsed.searchParams.has('x-amz-checksum-crc32')).toBe(false);
      expect(parsed.searchParams.has('x-amz-sdk-checksum-algorithm')).toBe(
        false,
      );
      expect(signedUrl).not.toContain('x-amz-checksum-crc32');
      expect(signedUrl).not.toContain('x-amz-sdk-checksum-algorithm');
    });

    it('should sign real unmocked presigned GET URLs with expected SigV4 format and query params', async () => {
      const actualPresigner = jest.requireActual<
        typeof import('@aws-sdk/s3-request-presigner')
      >('@aws-sdk/s3-request-presigner');
      (getSignedUrl as jest.Mock).mockImplementationOnce(
        actualPresigner.getSignedUrl,
      );

      const signedUrl = await service.getPresignedDownloadUrl(
        'private/exam 1.pdf',
        600,
      );
      const parsed = new URL(signedUrl);

      expect(`${parsed.origin}${parsed.pathname}`).toBe(
        'http://localhost:9000/online-exam-storage/private/exam%201.pdf',
      );
      expect(parsed.searchParams.get('X-Amz-Algorithm')).toBe(
        'AWS4-HMAC-SHA256',
      );
      expect(parsed.searchParams.get('X-Amz-Credential')).toContain(
        'minioadmin/',
      );
      expect(parsed.searchParams.get('X-Amz-Credential')).toContain(
        '/us-east-1/s3/aws4_request',
      );
      expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toBeTruthy();
      expect(parsed.searchParams.get('X-Amz-Expires')).toBe('600');
      expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(
        /^[0-9a-f]{64}$/,
      );
    });

    it('should sign real unmocked AWS S3 virtual-hosted presigned PUT URL when S3_ENDPOINT is unset', async () => {
      const actualPresigner = jest.requireActual<
        typeof import('@aws-sdk/s3-request-presigner')
      >('@aws-sdk/s3-request-presigner');
      (getSignedUrl as jest.Mock).mockImplementationOnce(
        actualPresigner.getSignedUrl,
      );

      const awsService = new StorageService(
        createConfigService({
          S3_ENDPOINT: undefined,
          S3_REGION: 'ap-southeast-1',
          S3_BUCKET: 'my-aws-bucket',
          S3_ACCESS_KEY_ID: 'aws-key',
          S3_SECRET_ACCESS_KEY: 'aws-secret',
          S3_PUBLIC_URL_PREFIX: undefined,
        }),
      );

      const result = await awsService.generatePresignedUploadUrl({
        userId: 'user-1',
        fileName: 'avatar.png',
        mimeType: 'image/png',
        folder: 'avatars',
      });
      const parsed = new URL(result.uploadUrl);

      expect(`${parsed.origin}${parsed.pathname}`).toBe(
        `https://my-aws-bucket.s3.ap-southeast-1.amazonaws.com/${result.key}`,
      );
      expect(result.filePublicUrl).toBe(
        `https://my-aws-bucket.s3.ap-southeast-1.amazonaws.com/${result.key}`,
      );
      expect(parsed.searchParams.get('X-Amz-Algorithm')).toBe(
        'AWS4-HMAC-SHA256',
      );
      expect(parsed.searchParams.get('X-Amz-Credential')).toContain('aws-key/');
      expect(parsed.searchParams.get('X-Amz-Credential')).toContain(
        '/ap-southeast-1/s3/aws4_request',
      );
      expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toBeTruthy();
      expect(parsed.searchParams.get('X-Amz-Expires')).toBe('300');
      expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(
        /^[0-9a-f]{64}$/,
      );
    });

    it('should log and rethrow when getSignedUrl rejects in getPresignedUploadUrl', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      (getSignedUrl as jest.Mock).mockRejectedValueOnce(
        new Error('Upload signing failed'),
      );

      await expect(
        service.getPresignedUploadUrl('uploads/fail.png', 300, 'image/png'),
      ).rejects.toThrow('Upload signing failed');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to generate presigned upload URL for "uploads/fail.png"',
        ),
        expect.any(String),
      );
    });

    it('should log and rethrow when getSignedUrl rejects in getPresignedDownloadUrl', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      (getSignedUrl as jest.Mock).mockRejectedValueOnce(
        new Error('Signing failed'),
      );

      await expect(
        service.getPresignedDownloadUrl('private/exam.pdf'),
      ).rejects.toThrow('Signing failed');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to generate presigned download URL for "private/exam.pdf"',
        ),
        expect.any(String),
      );
    });
  });

  describe('deleteFile', () => {
    it('should delete a file using DeleteObjectCommand with normalized key', async () => {
      mockS3Send.mockResolvedValueOnce({});

      await service.deleteFile('/old/file.txt');

      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const command = mockS3Send.mock.calls[0][0] as DeleteObjectCommand;
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'online-exam-storage',
        Key: 'old/file.txt',
      });
    });

    it('should reject invalid or non-string keys before calling S3Client.send in deleteFile', async () => {
      await expect(
        service.deleteFile(null as unknown as string),
      ).rejects.toThrow(/Storage key must be a non-empty string/);
      await expect(service.deleteFile('../old.txt')).rejects.toThrow(
        /path traversal/,
      );
      expect(mockS3Send).not.toHaveBeenCalled();
    });

    it('should log and rethrow when deleteFile fails', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      mockS3Send.mockRejectedValueOnce(new Error('Delete error'));

      await expect(service.deleteFile('old/file.txt')).rejects.toThrow(
        'Delete error',
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete file "old/file.txt"'),
        expect.any(String),
      );
    });
  });

  describe('getFile', () => {
    it('should fetch a file using GetObjectCommand with normalized key', async () => {
      const mockOutput = { Body: 'mock-stream' };
      mockS3Send.mockResolvedValueOnce(mockOutput);

      const result = await service.getFile('/data/report.json');

      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const command = mockS3Send.mock.calls[0][0] as GetObjectCommand;
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'online-exam-storage',
        Key: 'data/report.json',
      });
      expect(result).toBe(mockOutput);
    });

    it('should reject invalid or non-string keys before calling S3Client.send in getFile', async () => {
      await expect(
        service.getFile(undefined as unknown as string),
      ).rejects.toThrow(/Storage key must be a non-empty string/);
      await expect(service.getFile('   ')).rejects.toThrow(
        /Storage key must not be empty/,
      );
      expect(mockS3Send).not.toHaveBeenCalled();
    });

    it('should log and rethrow when getFile fails', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      mockS3Send.mockRejectedValueOnce(new Error('NoSuchKey'));

      await expect(service.getFile('data/missing.json')).rejects.toThrow(
        'NoSuchKey',
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch file "data/missing.json"'),
        expect.any(String),
      );
    });
  });

  describe('fileExists', () => {
    it('should return true when HeadObjectCommand succeeds', async () => {
      mockS3Send.mockResolvedValueOnce({});

      const exists = await service.fileExists('/exists.txt');
      expect(exists).toBe(true);
      const command = mockS3Send.mock.calls[0][0] as HeadObjectCommand;
      expect(command).toBeInstanceOf(HeadObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'online-exam-storage',
        Key: 'exists.txt',
      });
    });

    it('should reject invalid or non-string keys before calling S3Client.send in fileExists', async () => {
      await expect(
        service.fileExists(123 as unknown as string),
      ).rejects.toThrow(/Storage key must be a non-empty string/);
      await expect(service.fileExists('./exists.txt')).rejects.toThrow(
        /path traversal/,
      );
      expect(mockS3Send).not.toHaveBeenCalled();
    });

    it('should return false for NotFound, NoSuchKey, and 404 metadata errors', async () => {
      mockS3Send
        .mockRejectedValueOnce(
          Object.assign(new Error('Not Found'), { name: 'NotFound' }),
        )
        .mockRejectedValueOnce(
          Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }),
        )
        .mockRejectedValueOnce(
          Object.assign(new Error('HTTP 404'), {
            $metadata: { httpStatusCode: 404 },
          }),
        );

      expect(await service.fileExists('missing-1.txt')).toBe(false);
      expect(await service.fileExists('missing-2.txt')).toBe(false);
      expect(await service.fileExists('missing-3.txt')).toBe(false);
    });

    it('should log and rethrow non-404 errors including non-Error rejections', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      const forbiddenError = Object.assign(new Error('AccessDenied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      });
      mockS3Send.mockRejectedValueOnce(forbiddenError);

      await expect(service.fileExists('forbidden.txt')).rejects.toThrow(
        'AccessDenied',
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to check existence of file "forbidden.txt"',
        ),
        expect.any(String),
      );

      mockS3Send.mockRejectedValueOnce('network-down');
      await expect(service.fileExists('network-fail.txt')).rejects.toBe(
        'network-down',
      );
      expect(errorSpy).toHaveBeenLastCalledWith(
        expect.stringContaining(
          'Failed to check existence of file "network-fail.txt": network-down',
        ),
        undefined,
      );
    });
  });

  describe('generatePresignedUploadUrl', () => {
    const uuidV4Regex =
      '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

    it('should generate key, PutObjectCommand, 300s expiry, and payload for avatars folder', async () => {
      jest.spyOn(Date, 'now').mockReturnValueOnce(1700000000123);

      const result = await service.generatePresignedUploadUrl({
        userId: 'user-123',
        fileName: 'avatar.png',
        mimeType: 'image/png',
        folder: 'avatars',
      });

      expect(result.key).toMatch(
        new RegExp(`^avatars/user-123-1700000000123-${uuidV4Regex}\\.png$`),
      );
      expect(result.expiresIn).toBe(300);
      expect(result.uploadUrl).toBe(
        `https://mock-signed-url.com/${result.key}?expiresIn=300`,
      );
      expect(result.filePublicUrl).toBe(
        `http://localhost:9000/online-exam-storage/${result.key}`,
      );
      expect(result.filePublicUrl).toBe(service.getPublicUrl(result.key));

      expect(getSignedUrl).toHaveBeenCalledTimes(1);
      const [clientArg, commandArg, optionsArg] = (getSignedUrl as jest.Mock)
        .mock.calls[0];
      expect(clientArg).toBe(service.getClient());
      expect(commandArg).toBeInstanceOf(PutObjectCommand);
      expect((commandArg as PutObjectCommand).input).toEqual({
        Bucket: 'online-exam-storage',
        Key: result.key,
        ContentType: 'image/png',
      });
      expect('ContentLength' in (commandArg as PutObjectCommand).input).toBe(
        false,
      );
      expect(optionsArg).toEqual({ expiresIn: 300 });
    });

    it('should generate key and payload for covers folder', async () => {
      const result = await service.generatePresignedUploadUrl({
        userId: '507f1f77bcf86cd799439011',
        fileName: 'hero-banner.jpg',
        mimeType: 'image/jpeg',
        folder: 'covers',
      });

      expect(result.key).toMatch(
        new RegExp(
          `^covers/507f1f77bcf86cd799439011-\\d+-${uuidV4Regex}\\.jpg$`,
        ),
      );
      expect(result.expiresIn).toBe(300);
      expect(result.uploadUrl).toBe(
        `https://mock-signed-url.com/${result.key}?expiresIn=300`,
      );
      expect(result.filePublicUrl).toBe(service.getPublicUrl(result.key));

      expect(getSignedUrl).toHaveBeenCalledTimes(1);
      const [clientArg, commandArg, optionsArg] = (getSignedUrl as jest.Mock)
        .mock.calls[0];
      expect(clientArg).toBe(service.getClient());
      expect(commandArg).toBeInstanceOf(PutObjectCommand);
      expect((commandArg as PutObjectCommand).input).toEqual({
        Bucket: 'online-exam-storage',
        Key: result.key,
        ContentType: 'image/jpeg',
      });
      expect(optionsArg).toEqual({ expiresIn: 300 });
    });

    it('should produce distinct key, uploadUrl, and filePublicUrl across repeated calls in the same millisecond', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);

      const input = {
        userId: 'user-123',
        fileName: 'avatar.png',
        mimeType: 'image/png',
        folder: 'avatars' as const,
      };

      const first = await service.generatePresignedUploadUrl(input);
      const second = await service.generatePresignedUploadUrl(input);

      expect(first.key).not.toBe(second.key);
      expect(first.uploadUrl).not.toBe(second.uploadUrl);
      expect(first.filePublicUrl).not.toBe(second.filePublicUrl);
    });

    it('should return exact uploadUrl from getSignedUrl and respect S3_PUBLIC_URL_PREFIX override', async () => {
      const cdnService = new StorageService(
        createConfigService({
          S3_PUBLIC_URL_PREFIX: 'https://cdn.example.com/media/',
        }),
      );
      (getSignedUrl as jest.Mock).mockResolvedValueOnce(
        'https://signed-put.example.com/upload?X-Amz-Expires=300',
      );

      const result = await cdnService.generatePresignedUploadUrl({
        userId: 'user_456',
        fileName: 'cover.webp',
        mimeType: 'image/webp',
        folder: 'covers',
      });

      expect(result.uploadUrl).toBe(
        'https://signed-put.example.com/upload?X-Amz-Expires=300',
      );
      expect(result.filePublicUrl).toBe(
        `https://cdn.example.com/media/${result.key}`,
      );
      expect(result.expiresIn).toBe(300);

      expect(getSignedUrl).toHaveBeenCalledTimes(1);
      const [clientArg, commandArg, optionsArg] = (getSignedUrl as jest.Mock)
        .mock.calls[0];
      expect(clientArg).toBe(cdnService.getClient());
      expect(commandArg).toBeInstanceOf(PutObjectCommand);
      expect((commandArg as PutObjectCommand).input).toEqual({
        Bucket: 'online-exam-storage',
        Key: result.key,
        ContentType: 'image/webp',
      });
      expect(optionsArg).toEqual({ expiresIn: 300 });
    });

    it('should generate real unmocked SigV4 presigned PUT URL with X-Amz-Expires=300 and without CRC32 params', async () => {
      const actualPresigner = jest.requireActual<
        typeof import('@aws-sdk/s3-request-presigner')
      >('@aws-sdk/s3-request-presigner');
      (getSignedUrl as jest.Mock).mockImplementationOnce(
        actualPresigner.getSignedUrl,
      );

      const result = await service.generatePresignedUploadUrl({
        userId: 'user-789',
        fileName: 'avatar.png',
        mimeType: 'image/png',
        folder: 'avatars',
      });
      const parsed = new URL(result.uploadUrl);

      expect(`${parsed.origin}${parsed.pathname}`).toBe(
        `http://localhost:9000/online-exam-storage/${result.key}`,
      );
      expect(result.filePublicUrl).toBe(
        `http://localhost:9000/online-exam-storage/${result.key}`,
      );
      expect(parsed.searchParams.get('X-Amz-Algorithm')).toBe(
        'AWS4-HMAC-SHA256',
      );
      expect(parsed.searchParams.get('X-Amz-Credential')).toContain(
        'minioadmin/',
      );
      expect(parsed.searchParams.get('X-Amz-Credential')).toContain(
        '/us-east-1/s3/aws4_request',
      );
      expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toBeTruthy();
      expect(parsed.searchParams.get('X-Amz-Expires')).toBe('300');
      expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(
        /^[0-9a-f]{64}$/,
      );
      expect(parsed.searchParams.has('x-amz-checksum-crc32')).toBe(false);
    });

    it('should handle multi-dot filenames, uppercase extensions, extension length bounds, whitespace trimming, and preserve trimmed mimeType case', async () => {
      const multiDot = await service.generatePresignedUploadUrl({
        userId: '  user-123  ',
        fileName: '  my.avatar.webp  ',
        mimeType: '  Image/WEBP  ',
        folder: 'avatars',
      });

      expect(multiDot.key).toMatch(
        new RegExp(`^avatars/user-123-\\d+-${uuidV4Regex}\\.webp$`),
      );
      const firstCommand = (getSignedUrl as jest.Mock).mock
        .calls[0][1] as PutObjectCommand;
      expect(firstCommand.input.ContentType).toBe('Image/WEBP');

      const uppercase = await service.generatePresignedUploadUrl({
        userId: 'user-123',
        fileName: 'PHOTO.PNG',
        mimeType: 'image/png',
        folder: 'covers',
      });

      expect(uppercase.key).toMatch(
        new RegExp(`^covers/user-123-\\d+-${uuidV4Regex}\\.png$`),
      );

      const oneCharExt = await service.generatePresignedUploadUrl({
        userId: 'user-123',
        fileName: 'a.x',
        mimeType: 'image/png',
        folder: 'avatars',
      });
      expect(oneCharExt.key).toMatch(/\.x$/);

      const sixteenCharExt = await service.generatePresignedUploadUrl({
        userId: 'user-123',
        fileName: 'photo.1234567890abcdef',
        mimeType: 'image/png',
        folder: 'avatars',
      });
      expect(sixteenCharExt.key).toMatch(/\.1234567890abcdef$/);
    });

    it('should map all supported IMAGE_MIME_EXTENSION_MAP entries for extensionless filenames and reject malicious/non-image MIME fallbacks', async () => {
      const supportedMappings: Array<[string, string]> = [
        ['image/jpeg', 'jpg'],
        ['IMAGE/JPEG', 'jpg'],
        ['image/jpg', 'jpg'],
        ['image/png', 'png'],
        ['image/webp', 'webp'],
        ['image/gif', 'gif'],
        ['image/avif', 'avif'],
        ['image/bmp', 'bmp'],
        ['image/tiff', 'tiff'],
      ];

      for (const [mimeType, expectedExt] of supportedMappings) {
        const res = await service.generatePresignedUploadUrl({
          userId: 'user-123',
          fileName: 'blob',
          mimeType,
          folder: 'avatars',
        });
        expect(res.key).toMatch(new RegExp(`\\.${expectedExt}$`));
      }

      (getSignedUrl as jest.Mock).mockClear();

      for (const unsafeMime of [
        'application/octet-stream',
        'application/x-msdownload',
        'application/javascript',
        'text/html',
        'application/x-sh',
        'image/svg+xml',
      ]) {
        await expect(
          service.generatePresignedUploadUrl({
            userId: 'user-123',
            fileName: 'blob',
            mimeType: unsafeMime,
            folder: 'avatars',
          }),
        ).rejects.toThrow(BadRequestException);
      }

      expect(getSignedUrl).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException for non-object params, non-string fields, invalid folder/userId/mimeType, and unsafe fileName values', async () => {
      for (const badParams of [null, undefined, 'invalid', 123]) {
        await expect(
          service.generatePresignedUploadUrl(
            badParams as unknown as GeneratePresignedUploadUrlParams,
          ),
        ).rejects.toThrow(BadRequestException);
      }

      for (const badFolder of [
        'exams',
        ' avatars ',
        '',
        null,
        123,
      ] as unknown[]) {
        await expect(
          service.generatePresignedUploadUrl({
            userId: 'user-123',
            fileName: 'avatar.png',
            mimeType: 'image/png',
            folder: badFolder as UploadFolder,
          }),
        ).rejects.toThrow(BadRequestException);
      }

      for (const badUserId of [
        '',
        '   ',
        '.',
        '..',
        'user.1',
        'user@1',
        'user space',
        '../evil',
        'a/b',
        'a\\b',
        null,
        123,
      ] as unknown[]) {
        await expect(
          service.generatePresignedUploadUrl({
            userId: badUserId as string,
            fileName: 'avatar.png',
            mimeType: 'image/png',
            folder: 'avatars',
          }),
        ).rejects.toThrow(BadRequestException);
      }

      for (const badMime of [
        '',
        '   ',
        'image',
        'image/',
        '/png',
        '.image/png',
        'image/.png',
        'image/png; charset=utf-8',
        'image/png extra',
        null,
        123,
      ] as unknown[]) {
        await expect(
          service.generatePresignedUploadUrl({
            userId: 'user-123',
            fileName: 'avatar.png',
            mimeType: badMime as string,
            folder: 'avatars',
          }),
        ).rejects.toThrow(BadRequestException);
      }

      for (const badFileName of [
        '',
        '   ',
        '.',
        '..',
        'a..b',
        '../foo.png',
        'dir/file.png',
        'dir\\file.png',
        '.png',
        'photo.',
        'photo..png',
        'photo.png?x=1',
        'photo.p_ng',
        'photo.p-ng',
        'photo.1234567890abcdefg',
        null,
        123,
      ] as unknown[]) {
        await expect(
          service.generatePresignedUploadUrl({
            userId: 'user-123',
            fileName: badFileName as string,
            mimeType: 'image/png',
            folder: 'avatars',
          }),
        ).rejects.toThrow(BadRequestException);
      }

      expect(getSignedUrl).not.toHaveBeenCalled();
    });

    it('should log and rethrow when getSignedUrl fails', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      (getSignedUrl as jest.Mock).mockRejectedValueOnce(
        new Error('Signing failed'),
      );

      await expect(
        service.generatePresignedUploadUrl({
          userId: 'user-123',
          fileName: 'avatar.png',
          mimeType: 'image/png',
          folder: 'avatars',
        }),
      ).rejects.toThrow('Signing failed');

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to generate presigned upload URL for "avatars/user-123-',
        ),
        expect.any(String),
      );
    });
  });

  describe('onModuleDestroy', () => {
    it('should call destroy on the S3Client', () => {
      service.onModuleDestroy();
      expect(mockS3Destroy).toHaveBeenCalledTimes(1);
    });
  });
});
