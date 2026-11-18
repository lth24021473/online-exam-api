import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Nguyen Van An', maxLength: 100 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName?: string;

  @ApiPropertyOptional({
    example: 'https://s3.example.com/avatars/user-123.jpg',
    description:
      'Public S3/CDN URL returned as `filePublicUrl` from POST /api/v1/users/me/upload-url (set to null to clear avatar)',
    type: String,
    nullable: true,
    maxLength: 500,
    format: 'uri',
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  avatar?: string | null;

  @ApiPropertyOptional({
    example: 'https://s3.example.com/covers/user-123.jpg',
    description:
      'Public S3/CDN URL returned as `filePublicUrl` from POST /api/v1/users/me/upload-url (set to null to clear cover)',
    type: String,
    nullable: true,
    maxLength: 500,
    format: 'uri',
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  cover?: string | null;

  @ApiPropertyOptional({ example: 'Đại học Bách Khoa', maxLength: 150 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(150)
  workplace?: string | null;

  @ApiPropertyOptional({ example: 'TP Hồ Chí Minh', maxLength: 150 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(150)
  currentResidence?: string | null;
}
