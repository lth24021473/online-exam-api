import { ApiProperty } from '@nestjs/swagger';
import {
  IsByteLength,
  IsNotEmpty,
  IsString,
  MinLength,
} from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    example: 'OldPassword123',
    description: 'Current password',
  })
  @IsString()
  @IsNotEmpty({ message: 'Current password is required' })
  currentPassword: string;

  @ApiProperty({
    example: 'NewPassword123',
    minLength: 6,
    description: 'New password (at least 6 characters, at most 72 UTF-8 bytes)',
  })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  @IsByteLength(0, 72, { message: 'Password cannot exceed 72 bytes' })
  newPassword: string;
}

