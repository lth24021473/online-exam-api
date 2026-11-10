import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsByteLength,
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
} from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    example: 'student@example.com',
    description: 'Registered user email address',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Invalid email address' })
  email: string;

  @ApiProperty({
    example: '123456',
    description: '6-digit password reset verification code received via email',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Reset token is required' })
  token: string;

  @ApiProperty({
    example: 'NewSecret123',
    minLength: 6,
    description: 'New password (at least 6 characters, at most 72 UTF-8 bytes)',
  })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  @IsByteLength(0, 72, { message: 'Password cannot exceed 72 bytes' })
  newPassword: string;
}

