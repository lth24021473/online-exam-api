import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  S3ClientConfig,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

const MIN_PRESIGNED_EXPIRY_SECONDS = 1;
const MAX_PRESIGNED_EXPIRY_SECONDS = 604800; // 7 days (AWS S3 SigV4 limit)
const PRESIGNED_UPLOAD_URL_EXPIRY_SECONDS = 300 as const; // 5 minutes

export type UploadFolder = 'avatars' | 'covers';

export interface GeneratePresignedUploadUrlParams {
  userId: string;
  fileName: string;
  mimeType: string;
  folder: UploadFolder;
}

export interface PresignedUploadUrlResult {
  uploadUrl: string;
  filePublicUrl: string;
  key: string;
  expiresIn: 300;
}

export interface UploadResult {
  key: string;
  url: string;
}

const ALLOWED_UPLOAD_FOLDERS = new Set<UploadFolder>(['avatars', 'covers']);
const VALID_USER_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const VALID_MIME_TYPE_PATTERN =
  /^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*$/;
const VALID_EXTENSION_PATTERN = /^[a-z0-9]{1,16}$/;
const IMAGE_MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly endpoint?: string;
  private readonly region: string;
  private readonly publicUrlPrefix?: string;
  private readonly forcePathStyle: boolean;

  constructor(private readonly configService: ConfigService) {
    this.endpoint =
      this.configService.get<string>('S3_ENDPOINT')?.trim() || undefined;
    this.region =
      this.configService.get<string>('S3_REGION')?.trim() || 'us-east-1';
    this.bucket =
      this.configService.get<string>('S3_BUCKET')?.trim() ||
      'online-exam-storage';
    const accessKeyId =
      this.configService.get<string>('S3_ACCESS_KEY_ID')?.trim() || undefined;
    const secretAccessKey =
      this.configService.get<string>('S3_SECRET_ACCESS_KEY')?.trim() ||
      undefined;
    this.publicUrlPrefix =
      this.configService.get<string>('S3_PUBLIC_URL_PREFIX')?.trim() ||
      undefined;

    if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
      throw new Error(
        'Incomplete S3 credentials configuration: both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be provided together',
      );
    }

    const forcePathStyleEnv = this.configService
      .get<string>('S3_FORCE_PATH_STYLE')
      ?.trim()
      .toLowerCase();
    this.forcePathStyle =
      forcePathStyleEnv === 'true'
        ? true
        : forcePathStyleEnv === 'false'
          ? false
          : Boolean(this.endpoint);

    const clientConfig: S3ClientConfig = {
      region: this.region,
      ...(this.endpoint ? { endpoint: this.endpoint } : {}),
      ...(accessKeyId && secretAccessKey
        ? {
            credentials: {
              accessKeyId,
              secretAccessKey,
            },
          }
        : {}),
      forcePathStyle: this.forcePathStyle,
      // Disable default empty-payload CRC32 query params in presigned PUT URLs
      // (AWS SDK v3.1170+ defaults to WHEN_SUPPORTED, breaking non-empty client uploads).
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    };

    if (!accessKeyId && !secretAccessKey) {
      this.logger.warn(
        'S3 static credentials not provided; falling back to AWS SDK default credential provider chain',
      );
    }

    this.s3Client = new S3Client(clientConfig);
    this.logger.log(
      `StorageService initialized (bucket: ${this.bucket}, region: ${this.region}, endpoint: ${this.endpoint ?? 'default-aws'}, forcePathStyle: ${this.forcePathStyle})`,
    );
  }

  getClient(): S3Client {
    return this.s3Client;
  }

  getBucket(): string {
    return this.bucket;
  }

  private normalizeKey(key: string): string {
    if (typeof key !== 'string') {
      throw new Error('Storage key must be a non-empty string');
    }

    const normalized = key.trim().replace(/^\/+/, '');
    if (!normalized) {
      throw new Error('Storage key must not be empty');
    }

    if (
      normalized
        .split(/[/\\]/)
        .some((segment) => segment === '.' || segment === '..')
    ) {
      throw new Error(
        'Invalid storage key: path traversal ("." or "..") is not allowed',
      );
    }

    return normalized;
  }

  private validateExpiresIn(expiresIn: number): void {
    if (
      !Number.isInteger(expiresIn) ||
      expiresIn < MIN_PRESIGNED_EXPIRY_SECONDS ||
      expiresIn > MAX_PRESIGNED_EXPIRY_SECONDS
    ) {
      throw new Error(
        `Presigned URL expiresIn must be an integer between ${MIN_PRESIGNED_EXPIRY_SECONDS} and ${MAX_PRESIGNED_EXPIRY_SECONDS} seconds`,
      );
    }
  }

  getPublicUrl(key: string): string {
    const cleanKey = this.normalizeKey(key);
    const encodedKey = cleanKey.split('/').map(encodeURIComponent).join('/');

    if (this.publicUrlPrefix) {
      return `${this.publicUrlPrefix.replace(/\/+$/, '')}/${encodedKey}`;
    }

    const encodedBucket = encodeURIComponent(this.bucket);

    if (this.endpoint) {
      const cleanEndpoint = this.endpoint.replace(/\/+$/, '');
      if (this.forcePathStyle) {
        return `${cleanEndpoint}/${encodedBucket}/${encodedKey}`;
      }
      const url = new URL(cleanEndpoint);
      const basePath = url.pathname.replace(/\/+$/, '');
      return `${url.protocol}//${encodedBucket}.${url.host}${basePath}/${encodedKey}`;
    }

    if (this.forcePathStyle) {
      return `https://s3.${this.region}.amazonaws.com/${encodedBucket}/${encodedKey}`;
    }

    return `https://${encodedBucket}.s3.${this.region}.amazonaws.com/${encodedKey}`;
  }

  async uploadFile(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType?: string,
  ): Promise<UploadResult> {
    const cleanKey = this.normalizeKey(key);
    const trimmedContentType = contentType?.trim();
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: cleanKey,
      Body: body,
      ...(trimmedContentType ? { ContentType: trimmedContentType } : {}),
    });

    try {
      await this.s3Client.send(command);
      return {
        key: cleanKey,
        url: this.getPublicUrl(cleanKey),
      };
    } catch (error) {
      this.logger.error(
        `Failed to upload file "${cleanKey}": ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  private resolveUploadExtension(
    fileName: string,
    cleanMimeType: string,
  ): string {
    const rawFileName = typeof fileName === 'string' ? fileName.trim() : '';
    if (
      !rawFileName ||
      rawFileName === '.' ||
      rawFileName === '..' ||
      rawFileName.includes('..') ||
      /[/\\]/.test(rawFileName)
    ) {
      throw new BadRequestException(
        'Invalid fileName: must be a non-empty file name without path separators or traversal sequences',
      );
    }

    const lastDotIndex = rawFileName.lastIndexOf('.');
    if (lastDotIndex === 0 || lastDotIndex === rawFileName.length - 1) {
      throw new BadRequestException(
        'Invalid fileName: dotfiles and trailing-dot file names are not allowed',
      );
    }

    if (lastDotIndex === -1) {
      const mappedExtension =
        IMAGE_MIME_EXTENSION_MAP[cleanMimeType.toLowerCase()];
      if (!mappedExtension) {
        throw new BadRequestException(
          `Invalid fileName: missing file extension and unsupported MIME type "${cleanMimeType}" for fallback`,
        );
      }
      return mappedExtension;
    }

    const extension = rawFileName.slice(lastDotIndex + 1).toLowerCase();
    if (!VALID_EXTENSION_PATTERN.test(extension)) {
      throw new BadRequestException(
        'Invalid fileName: file extension must be 1 to 16 lowercase alphanumeric characters',
      );
    }

    return extension;
  }

  /**
   * Generates a 5-minute (300s) pre-signed S3 PUT URL and corresponding public URL
   * using the Valet Key Pattern for direct browser-to-S3 uploads.
   *
   * Note: `ContentLength` is intentionally NOT set on `PutObjectCommand` because
   * presigned PUT URLs sign `content-length` as an exact byte-count match rather
   * than a maximum size ceiling, causing `403 SignatureDoesNotMatch` on variable
   * browser uploads (e.g., client compression or EXIF stripping). File size limits
   * belong at controller DTO pre-checks, post-upload `HeadObjectCommand` checks,
   * or S3 Presigned POST policies (`content-length-range`).
   */
  async generatePresignedUploadUrl(
    params: GeneratePresignedUploadUrlParams,
  ): Promise<PresignedUploadUrlResult> {
    if (!params || typeof params !== 'object') {
      throw new BadRequestException('Upload parameters must be an object');
    }

    const { userId, fileName, mimeType, folder } = params;

    if (typeof folder !== 'string' || !ALLOWED_UPLOAD_FOLDERS.has(folder)) {
      throw new BadRequestException(
        'Invalid folder: must be either "avatars" or "covers"',
      );
    }

    const cleanUserId = typeof userId === 'string' ? userId.trim() : '';
    if (
      !cleanUserId ||
      cleanUserId.includes('.') ||
      /[/\\]/.test(cleanUserId) ||
      !VALID_USER_ID_PATTERN.test(cleanUserId)
    ) {
      throw new BadRequestException(
        'Invalid userId: must be a non-empty alphanumeric, hyphen, or underscore identifier without dots or path separators',
      );
    }

    const cleanMimeType = typeof mimeType === 'string' ? mimeType.trim() : '';
    if (!cleanMimeType || !VALID_MIME_TYPE_PATTERN.test(cleanMimeType)) {
      throw new BadRequestException(
        'Invalid mimeType: must be a valid "type/subtype" media type',
      );
    }

    const extension = this.resolveUploadExtension(fileName, cleanMimeType);
    const key = `${folder}/${cleanUserId}-${Date.now()}-${randomUUID()}.${extension}`;

    const uploadUrl = await this.getPresignedUploadUrl(
      key,
      PRESIGNED_UPLOAD_URL_EXPIRY_SECONDS,
      cleanMimeType,
    );
    const filePublicUrl = this.getPublicUrl(key);

    return {
      uploadUrl,
      filePublicUrl,
      key,
      expiresIn: PRESIGNED_UPLOAD_URL_EXPIRY_SECONDS,
    };
  }

  async getPresignedUploadUrl(
    key: string,
    expiresIn = 3600,
    contentType?: string,
  ): Promise<string> {
    const cleanKey = this.normalizeKey(key);
    this.validateExpiresIn(expiresIn);
    const trimmedContentType = contentType?.trim();
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: cleanKey,
      ...(trimmedContentType ? { ContentType: trimmedContentType } : {}),
    });

    try {
      return await getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error) {
      this.logger.error(
        `Failed to generate presigned upload URL for "${cleanKey}": ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async getPresignedDownloadUrl(
    key: string,
    expiresIn = 3600,
  ): Promise<string> {
    const cleanKey = this.normalizeKey(key);
    this.validateExpiresIn(expiresIn);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: cleanKey,
    });

    try {
      return await getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error) {
      this.logger.error(
        `Failed to generate presigned download URL for "${cleanKey}": ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async deleteFile(key: string): Promise<void> {
    const cleanKey = this.normalizeKey(key);
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: cleanKey,
    });

    try {
      await this.s3Client.send(command);
    } catch (error) {
      this.logger.error(
        `Failed to delete file "${cleanKey}": ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async getFile(key: string): Promise<GetObjectCommandOutput> {
    const cleanKey = this.normalizeKey(key);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: cleanKey,
    });

    try {
      return await this.s3Client.send(command);
    } catch (error) {
      this.logger.error(
        `Failed to fetch file "${cleanKey}": ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async fileExists(key: string): Promise<boolean> {
    const cleanKey = this.normalizeKey(key);
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: cleanKey,
        }),
      );
      return true;
    } catch (error) {
      const err = error as {
        name?: string;
        message?: string;
        $metadata?: { httpStatusCode?: number };
      };
      if (
        err?.name === 'NotFound' ||
        err?.name === 'NoSuchKey' ||
        err?.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }

      this.logger.error(
        `Failed to check existence of file "${cleanKey}": ${err?.message ?? String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  onModuleDestroy() {
    this.s3Client.destroy();
  }
}
