import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateExamDto {
  @ApiProperty({ example: 'Kiem tra Toan lop 10', maxLength: 200 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ example: 'De kiem tra giua ky' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'Hoc sinh lam bai doc lap' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsOptional()
  instructions?: string;

  @ApiProperty({ example: 45, description: 'Duration in minutes, min 1' })
  @IsInt()
  @Min(1)
  durationMinutes: number;

  @ApiPropertyOptional({ example: '2026-10-20T08:00:00.000Z' })
  @IsOptional()
  opensAt?: string | null;

  @ApiPropertyOptional({ example: '2026-10-20T17:00:00.000Z' })
  @IsOptional()
  closesAt?: string | null;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxAttempts?: number;

  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description: 'Classroom ID if the exam belongs to a class',
  })
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() ? value.trim() : value === '' ? undefined : value,
  )
  @IsOptional()
  @IsString()
  classroomId?: string;
}
