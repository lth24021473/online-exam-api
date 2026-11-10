import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';

export class ReopenExamDto {
  @ApiPropertyOptional({
    example: '2026-10-21T17:00:00.000Z',
    description: 'Optional new closing time when reopening',
  })
  @IsOptional()
  closesAt?: string | null;
}
