import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async create(data: {
    email: string;
    passwordHash: string;
    fullName: string;
  }) {
    return this.usersRepository.create(data);
  }

  async findByEmail(email: string) {
    return this.usersRepository.findByEmail(email);
  }

  async findById(id: string) {
    return this.usersRepository.findById(id);
  }

  async findAllPublicUsers() {
    return this.usersRepository.findAll();
  }

  async findPublicUserOrFail(id: string) {
    const user = await this.getPublicUserById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateRole(id: string, role: Role) {
    await this.findPublicUserOrFail(id);
    return this.usersRepository.updateRole(id, role);
  }

  async remove(id: string) {
    await this.findPublicUserOrFail(id);
    await this.usersRepository.deleteById(id);
  }

  async getPublicUserById(id: string) {
    const user = await this.usersRepository.findById(id);

    if (!user) {
      return null;
    }

    const {
      passwordHash: _passwordHash,
      authVersion: _authVersion,
      ...publicUser
    } = user;

    return publicUser;
  }
}
