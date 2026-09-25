import { Injectable } from '@nestjs/common';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async findByEmail(email: string) {
    return this.usersRepository.findByEmail(email);
  }

  async findById(id: string) {
    return this.usersRepository.findById(id);
  }

  async getPublicUserById(id: string) {
    const user = await this.usersRepository.findById(id);

    if (!user) {
      return null;
    }

    const { passwordHash, ...publicUser } = user;

    return publicUser;
  }
}
