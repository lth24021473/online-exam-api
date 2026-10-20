import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateClassroomDto {
  @ApiProperty({ example: 'Lớp 10A1', maxLength: 100 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Lớp Toán nâng cao', maxLength: 300 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsOptional()
  @MaxLength(300)
  description?: string;

  @ApiProperty({ example: '123456', maxLength: 50 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  password: string;
}
