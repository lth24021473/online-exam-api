import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class SaveAnswerDto {
  @ApiProperty({ example: 1, minimum: 0, description: 'Zero-based option index' })
  @IsInt()
  @Min(0)
  selectedOptionIndex: number;
}
