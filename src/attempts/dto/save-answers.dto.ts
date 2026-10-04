import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsInt, IsMongoId, IsNotEmpty, Min, ValidateNested,
} from 'class-validator';

export class AnswerItemDto {
  @ApiProperty({ example: '665f1a2b3c4d5e6f7a8b9c0e', description: 'Question ID' })
  @IsMongoId()
  @IsNotEmpty()
  questionId: string;

  @ApiProperty({ example: 2, description: '0-based index of the selected option' })
  @IsInt()
  @Min(0)
  selectedOptionIndex: number;
}

export class SaveAnswersDto {
  @ApiProperty({ type: [AnswerItemDto], description: 'List of answers to save/update' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AnswerItemDto)
  answers: AnswerItemDto[];
}
