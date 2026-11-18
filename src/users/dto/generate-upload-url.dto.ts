import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import type { UploadFolder } from '../../storage/storage.service';

export class GenerateUploadUrlDto {
  @ApiProperty({
    example: 'avatar.png',
    description: 'Original file name',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({
    enum: ['image/jpeg', 'image/png', 'image/webp'],
    example: 'image/png',
    description: 'MIME type of the image to upload',
  })
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';

  @ApiProperty({
    enum: ['avatars', 'covers'],
    example: 'avatars',
    description: 'Target storage folder',
  })
  @IsIn(['avatars', 'covers'])
  folder: UploadFolder;
}
