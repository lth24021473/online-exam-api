import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ViolationType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class RecordViolationDto {
  @ApiProperty({ enum: ViolationType, example: ViolationType.TAB_SWITCH })
  @IsEnum(ViolationType)
  type: ViolationType;

  @ApiPropertyOptional({ example: 'Rời khỏi tab thi 5 giây', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  detail?: string;
}
