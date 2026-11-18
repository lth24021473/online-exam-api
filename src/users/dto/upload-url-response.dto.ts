import { ApiProperty } from '@nestjs/swagger';

export class UploadUrlResponseDto {
  @ApiProperty({
    example:
      'https://s3.example.com/online-exam-storage/avatars/507f1f77bcf86cd799439011-1700000000000-uuid.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300',
    description:
      'Presigned S3 PUT URL. Upload binary image bytes directly here with a matching Content-Type header (no Authorization header).',
    format: 'uri',
  })
  uploadUrl: string;

  @ApiProperty({
    example: 'https://s3.example.com/avatars/user-123.jpg',
    description:
      'Public S3/CDN URL of the uploaded image. Send this value as `avatar` or `cover` to PATCH /api/v1/users/me after the S3 PUT succeeds.',
    format: 'uri',
  })
  filePublicUrl: string;

  @ApiProperty({
    example: 'avatars/507f1f77bcf86cd799439011-1700000000000-uuid.jpg',
    description: 'Object storage key generated for the uploaded file.',
  })
  key: string;

  @ApiProperty({
    example: 300,
    description: 'Presigned upload URL validity duration in seconds.',
    type: Number,
  })
  expiresIn: number;
}
