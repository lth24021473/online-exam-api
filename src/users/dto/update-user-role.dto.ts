import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateUserRoleDto {
  @ApiProperty({ enum: Role, example: Role.EXAM_MANAGER, description: 'New role to assign' })
  @IsEnum(Role)
  role: Role;
}
