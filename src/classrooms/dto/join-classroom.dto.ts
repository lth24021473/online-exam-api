import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

export class JoinClassroomDto {
  @ApiProperty({ example: 'ABC234', description: 'Mã lớp 6 ký tự' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ example: '123456', description: 'Mật khẩu lớp' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  password: string;
}
