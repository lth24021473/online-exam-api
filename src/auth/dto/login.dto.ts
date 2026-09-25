import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    example: 'student@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'Student123',
  })
  @IsString()
  @MinLength(6)
  password: string;
}
