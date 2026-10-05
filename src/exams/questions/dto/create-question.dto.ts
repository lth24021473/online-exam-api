import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateQuestionDto {
  @ApiProperty({ example: 'So nguyen to nho nhat la?' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({
    example: ['1', '2', '3', '4'],
    description: 'At least 2 options',
    type: [String],
  })
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((option: unknown) =>
          typeof option === 'string' ? option.trim() : option,
        )
      : value,
  )
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  options: string[];

  @ApiProperty({
    example: 1,
    description: '0-based index of the correct option',
  })
  @IsInt()
  @Min(0)
  correctOptionIndex: number;

  @ApiProperty({ example: 1, description: 'Display order position (>= 1)' })
  @IsInt()
  @Min(1)
  position: number;
}
