import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { UsersService } from './users.service';
import { StorageService } from '../storage/storage.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { GenerateUploadUrlDto } from './dto/generate-upload-url.dto';
import { UploadUrlResponseDto } from './dto/upload-url-response.dto';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly storageService: StorageService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated account' })
  @ApiOkResponse({ description: 'Current account without passwordHash' })
  @ApiUnauthorizedResponse({
    description:
      'Missing, invalid, expired or revoked token, or deleted account',
  })
  me(@Req() request: AuthenticatedRequest) {
    return request.user;
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update profile information for the authenticated account',
    description:
      'Updates profile fields for the authenticated user. For `avatar` and `cover`, submit a valid public S3/CDN URL (<= 500 chars) obtained as `filePublicUrl` from the 3-step Valet Key flow: (1) POST /api/v1/users/me/upload-url -> (2) PUT binary image to `uploadUrl` with matching `Content-Type` -> (3) PATCH /api/v1/users/me with `{ avatar: filePublicUrl }` or `{ cover: filePublicUrl }`. Pass `null` to clear `avatar` or `cover`. Base64 `data:image/...` strings are rejected with HTTP 400.',
  })
  @ApiOkResponse({ description: 'Updated account information' })
  @ApiBadRequestResponse({ description: 'Invalid profile data' })
  @ApiUnauthorizedResponse({
    description:
      'Missing, invalid, expired or revoked token, or deleted account',
  })
  async updateProfile(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(request.user.id, dto);
  }

  @Post('me/upload-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate a presigned S3 upload URL for avatar or cover',
    description:
      'Step 1 of the 3-step Valet Key profile image upload flow: (1) Call POST /api/v1/users/me/upload-url with `{ fileName, mimeType, folder }` to obtain `{ uploadUrl, filePublicUrl, key, expiresIn }`. (2) Upload the binary image directly to S3/MinIO using `PUT <uploadUrl>` with header `Content-Type: <mimeType>` (no `Authorization` header). (3) Call PATCH /api/v1/users/me with `{ avatar: filePublicUrl }` or `{ cover: filePublicUrl }`.',
  })
  @ApiOkResponse({
    type: UploadUrlResponseDto,
    description:
      'Presigned upload URL, public URL, storage key, and expiration in seconds',
  })
  @ApiBadRequestResponse({ description: 'Invalid upload request data' })
  @ApiUnauthorizedResponse({
    description:
      'Missing, invalid, expired or revoked token, or deleted account',
  })
  async generateUploadUrl(
    @Req() request: AuthenticatedRequest,
    @Body() dto: GenerateUploadUrlDto,
  ) {
    return this.storageService.generatePresignedUploadUrl({
      userId: request.user.id,
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      folder: dto.folder,
    });
  }
}
