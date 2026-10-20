import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ParseObjectIdPipe } from '../attempts/parse-object-id.pipe';
import { ClassroomsService } from './classrooms.service';
import { CreateClassroomDto } from './dto/create-classroom.dto';
import { JoinClassroomDto } from './dto/join-classroom.dto';
import { ExamsService } from '../exams/exams.service';

@ApiTags('Classrooms')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai token xác thực' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('classrooms')
export class ClassroomsController {
  constructor(
    private readonly classroomsService: ClassroomsService,
    private readonly examsService: ExamsService,
  ) {}

  @Post()
  @Roles(Role.EXAM_MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[EXAM_MANAGER/ADMIN] Tạo lớp học mới' })
  @ApiCreatedResponse({ description: 'Lớp học đã được tạo thành công' })
  @ApiForbiddenResponse({ description: 'Không đủ quyền hạn' })
  create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateClassroomDto,
  ) {
    return this.classroomsService.create(req.user.id, dto);
  }

  @Get('managed')
  @Roles(Role.EXAM_MANAGER, Role.ADMIN)
  @ApiOperation({
    summary: '[EXAM_MANAGER/ADMIN] Danh sách lớp học do giáo viên quản lý',
  })
  @ApiOkResponse({ description: 'Danh sách các lớp học quản lý' })
  @ApiForbiddenResponse({ description: 'Không đủ quyền hạn' })
  findManaged(@Req() req: AuthenticatedRequest) {
    return this.classroomsService.findManaged(req.user.id);
  }

  @Get('joined')
  @Roles(Role.STUDENT, Role.EXAM_MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Danh sách lớp học đã tham gia' })
  @ApiOkResponse({ description: 'Danh sách các lớp học người dùng đã tham gia' })
  async findJoined(@Req() req: AuthenticatedRequest) {
    const classrooms = await this.classroomsService.findJoined(req.user.id);
    return classrooms.map((classroom: any) => {
      const { password, ...classroomWithoutPassword } = classroom;
      return classroomWithoutPassword;
    });
  }

  @Post('join')
  @Roles(Role.STUDENT, Role.EXAM_MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tham gia lớp học bằng mã code và mật khẩu' })
  @ApiOkResponse({ description: 'Tham gia lớp học thành công' })
  @ApiNotFoundResponse({ description: 'Mã lớp không tồn tại' })
  @ApiConflictResponse({ description: 'Đã tham gia lớp học từ trước' })
  async join(@Req() req: AuthenticatedRequest, @Body() dto: JoinClassroomDto) {
    const classroom = await this.classroomsService.join(req.user.id, dto);
    const { password, ...classroomWithoutPassword } = classroom as any;
    return classroomWithoutPassword;
  }

  @Get(':id')
  @Roles(Role.STUDENT, Role.EXAM_MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Xem chi tiết lớp học' })
  @ApiOkResponse({ description: 'Thông tin chi tiết lớp học' })
  @ApiNotFoundResponse({ description: 'Lớp học không tồn tại' })
  @ApiForbiddenResponse({
    description: 'Chỉ giáo viên quản lý hoặc thành viên mới có quyền xem',
  })
  async findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const classroom = await this.classroomsService.assertAccess(
      id,
      req.user.id,
      req.user.role as Role,
    );

    const result = { ...classroom };
    const isOwnerOrAdmin =
      req.user.role === Role.ADMIN || classroom.managerId === req.user.id;
    if (!isOwnerOrAdmin) {
      delete (result as any).password;
    }
    return result;
  }

  @Get(':id/members')
  @Roles(Role.STUDENT, Role.EXAM_MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Danh sách thành viên của lớp học' })
  @ApiOkResponse({ description: 'Danh sách thành viên lớp học' })
  @ApiNotFoundResponse({ description: 'Lớp học không tồn tại' })
  @ApiForbiddenResponse({ description: 'Không có quyền truy cập' })
  async findMembers(
    @Param('id', ParseObjectIdPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.classroomsService.assertAccess(
      id,
      req.user.id,
      req.user.role as Role,
    );
    return this.classroomsService.findMembers(id);
  }

  @Delete(':id/members/:userId')
  @Roles(Role.EXAM_MANAGER, Role.ADMIN)
  @ApiOperation({
    summary: '[EXAM_MANAGER/ADMIN] Xóa học sinh ra khỏi lớp học',
  })
  @ApiOkResponse({ description: 'Đã xóa học sinh khỏi lớp học' })
  @ApiNotFoundResponse({ description: 'Lớp học không tồn tại' })
  @ApiForbiddenResponse({ description: 'Bạn không quản lý lớp học này' })
  async removeMember(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('userId', ParseObjectIdPipe) memberUserId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.classroomsService.removeMember(
      id,
      memberUserId,
      req.user.id,
      req.user.role as Role,
    );
  }

  @Delete(':id')
  @Roles(Role.EXAM_MANAGER, Role.ADMIN)
  @ApiOperation({ summary: '[EXAM_MANAGER/ADMIN] Xóa lớp học' })
  @ApiOkResponse({ description: 'Xóa lớp học thành công' })
  @ApiNotFoundResponse({ description: 'Lớp học không tồn tại' })
  @ApiForbiddenResponse({ description: 'Bạn không quản lý lớp học này' })
  @ApiConflictResponse({
    description: 'Không thể xóa lớp đã có đề thi hoặc bài làm',
  })
  async deleteClassroom(
    @Param('id', ParseObjectIdPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.classroomsService.deleteClassroom(
      id,
      req.user.id,
      req.user.role as Role,
    );
  }

  @Get(':id/exams')
  @Roles(Role.STUDENT, Role.EXAM_MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Danh sách đề thi của lớp học' })
  @ApiOkResponse({ description: 'Danh sách đề thi của lớp học' })
  @ApiNotFoundResponse({ description: 'Lớp học không tồn tại' })
  @ApiForbiddenResponse({ description: 'Không có quyền truy cập' })
  async findExams(
    @Param('id', ParseObjectIdPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.classroomsService.assertAccess(
      id,
      req.user.id,
      req.user.role as Role,
    );
    return this.examsService.findByClassroom(id, req.user.role as Role);
  }
}
