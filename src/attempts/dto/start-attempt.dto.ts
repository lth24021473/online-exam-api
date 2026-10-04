import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty } from 'class-validator';

export class StartAttemptDto {
  @ApiProperty({ example: '665f1a2b3c4d5e6f7a8b9c0d', description: 'ID of the published exam to attempt' })
  @IsMongoId()
  @IsNotEmpty()
  examId: string;
}
