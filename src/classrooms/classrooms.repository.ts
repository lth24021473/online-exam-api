import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export function stripPassword<T extends Record<string, any>>(
  entity: T,
): Omit<T, 'password'> {
  const copy = { ...entity };
  delete copy.password;
  return copy;
}

@Injectable()
export class ClassroomsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    name: string;
    description?: string;
    password: string;
    code: string;
    managerId: string;
  }) {
    const classroom = await this.prisma.classroom.create({
      data: {
        name: data.name,
        description: data.description,
        password: data.password,
        code: data.code,
        manager: {
          connect: { id: data.managerId },
        },
      },
      include: {
        _count: {
          select: {
            members: true,
            exams: true,
          },
        },
      },
    });
    return stripPassword(classroom);
  }

  async findByCode(code: string) {
    return this.prisma.classroom.findUnique({
      where: { code },
      include: {
        manager: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            members: true,
            exams: true,
          },
        },
      },
    });
  }

  async findById(id: string) {
    const classroom = await this.prisma.classroom.findUnique({
      where: { id },
      include: {
        manager: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            members: true,
            exams: true,
          },
        },
      },
    });
    return classroom ? stripPassword(classroom) : null;
  }

  async findManaged(managerId: string) {
    const classrooms = await this.prisma.classroom.findMany({
      where: { managerId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            members: true,
            exams: true,
          },
        },
      },
    });
    return classrooms.map((classroom) => stripPassword(classroom));
  }

  async findJoined(userId: string) {
    const memberships = await this.prisma.classroomMember.findMany({
      where: { userId },
      orderBy: { joinedAt: 'desc' },
      include: {
        classroom: {
          include: {
            manager: {
              select: {
                id: true,
                fullName: true,
                email: true,
                avatar: true,
              },
            },
            _count: {
              select: {
                members: true,
                exams: true,
              },
            },
          },
        },
      },
    });

    return memberships.map((membership) => ({
      ...stripPassword(membership.classroom),
      joinedAt: membership.joinedAt,
    }));
  }

  async findMember(classroomId: string, userId: string) {
    return this.prisma.classroomMember.findUnique({
      where: {
        classroomId_userId: {
          classroomId,
          userId,
        },
      },
    });
  }

  async addMember(classroomId: string, userId: string) {
    return this.prisma.classroomMember.create({
      data: {
        classroom: { connect: { id: classroomId } },
        user: { connect: { id: userId } },
      },
      include: {
        classroom: {
          include: {
            manager: {
              select: {
                id: true,
                fullName: true,
                email: true,
                avatar: true,
              },
            },
            _count: {
              select: {
                members: true,
                exams: true,
              },
            },
          },
        },
      },
    });
  }

  async findMembers(classroomId: string) {
    const members = await this.prisma.classroomMember.findMany({
      where: { classroomId },
      orderBy: { joinedAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatar: true,
            role: true,
          },
        },
      },
    });

    return members.map((member) => ({
      id: member.user.id,
      userId: member.user.id,
      fullName: member.user.fullName,
      email: member.user.email,
      avatar: member.user.avatar,
      role: member.user.role,
      joinedAt: member.joinedAt,
    }));
  }

  async removeMember(classroomId: string, userId: string) {
    return this.prisma.classroomMember.deleteMany({
      where: {
        classroomId,
        userId,
      },
    });
  }

  async countExams(classroomId: string) {
    return this.prisma.exam.count({
      where: { classroomId },
    });
  }

  async deleteClassroom(id: string) {
    await this.prisma.classroomMember.deleteMany({
      where: { classroomId: id },
    });
    return this.prisma.classroom.delete({
      where: { id },
    });
  }
}
