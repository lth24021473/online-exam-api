import { plainToInstance, Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  validateSync,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const trimLowercaseToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed === '' ? undefined : trimmed;
};

const toOptionalInt = ({
  value,
  obj,
  key,
}: {
  value: unknown;
  obj?: Record<string, unknown>;
  key?: string;
}): unknown => {
  const raw =
    obj && key && Object.prototype.hasOwnProperty.call(obj, key)
      ? obj[key]
      : value;

  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') {
      return undefined;
    }
    if (!/^-?\d+$/.test(trimmed)) {
      return Number.NaN;
    }
    return Number(trimmed);
  }
  if (typeof raw === 'number') {
    return raw;
  }
  return Number.NaN;
};

@ValidatorConstraint({ name: 'isRedisUrl', async: false })
class IsRedisUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    try {
      const parsed = new URL(value);
      return (
        (parsed.protocol === 'redis:' || parsed.protocol === 'rediss:') &&
        Boolean(parsed.hostname)
      );
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return 'REDIS_URL must be a valid redis:// or rediss:// URL';
  }
}

export class EnvironmentVariables {
  // S3 / Object Storage Configuration (AWS S3, Cloudflare R2, MinIO)
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
    protocols: ['http', 'https'],
  })
  S3_ENDPOINT?: string;

  @ValidateIf((o: EnvironmentVariables) => o.NODE_ENV !== 'test')
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  S3_REGION?: string;

  @ValidateIf((o: EnvironmentVariables) => o.NODE_ENV !== 'test')
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  S3_BUCKET?: string;

  @ValidateIf((o: EnvironmentVariables) => o.NODE_ENV !== 'test')
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  S3_ACCESS_KEY_ID?: string;

  @ValidateIf((o: EnvironmentVariables) => o.NODE_ENV !== 'test')
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  S3_SECRET_ACCESS_KEY?: string;

  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
    protocols: ['http', 'https'],
  })
  S3_PUBLIC_URL_PREFIX?: string;

  @IsOptional()
  @Transform(trimLowercaseToUndefined)
  @IsIn(['true', 'false'])
  S3_FORCE_PATH_STYLE?: string;

  // Existing App Configuration (optional to allow seamless testing and dev)
  @IsOptional()
  @IsString()
  NODE_ENV?: string;

  @IsOptional()
  PORT?: string | number;

  @IsOptional()
  @IsString()
  DATABASE_URL?: string;

  @IsOptional()
  @IsString()
  JWT_SECRET?: string;

  @IsOptional()
  JWT_EXPIRES_IN?: string | number;

  @IsOptional()
  @IsString()
  FRONTEND_URL?: string;

  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  SMTP_PORT?: string | number;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASS?: string;

  @IsOptional()
  @IsString()
  SMTP_FROM?: string;

  @IsOptional()
  @IsString()
  SMTP_SERVICE?: string;

  @IsOptional()
  @IsString()
  SMTP_SECURE?: string;

  // Optional Redis Configuration (must remain optional so unconfigured startup stays alive)
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @Validate(IsRedisUrlConstraint)
  REDIS_URL?: string;

  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  REDIS_HOST?: string;

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT?: number;

  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  REDIS_PASSWORD?: string;

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  @Min(0)
  REDIS_DB?: number;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(`Environment validation failed: ${errors.toString()}`);
  }

  return validatedConfig;
}
