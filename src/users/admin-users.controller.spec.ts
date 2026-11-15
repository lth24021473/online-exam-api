import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AdminUsersController } from './admin-users.controller';
import { UsersService } from './users.service';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';

describe('AdminUsersController & PaginationQueryDto', () => {
  let controller: AdminUsersController;

  const mockUsersService = {
    findAllPublicUsers: jest.fn(),
    findPublicUserOrFail: jest.fn(),
    updateRole: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminUsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminUsersController>(AdminUsersController);
  });

  describe('findAll', () => {
    it('passes pagination query to usersService', async () => {
      const query: PaginationQueryDto = { page: 2, limit: 10, search: 'alice' };
      const expectedResponse = {
        data: [{ id: 'u1', email: 'alice@example.com' }],
        meta: { total: 1, page: 2, limit: 10, totalPages: 1 },
      };
      mockUsersService.findAllPublicUsers.mockResolvedValue(expectedResponse);

      const result = await controller.findAll(query);

      expect(mockUsersService.findAllPublicUsers).toHaveBeenCalledWith(query);
      expect(result).toEqual(expectedResponse);
    });
  });

  describe('PaginationQueryDto validation', () => {
    it('sets default values when empty object is transformed', () => {
      const dto = plainToInstance(PaginationQueryDto, {});
      expect(dto.page).toBe(1);
      expect(dto.limit).toBe(20);
      expect(dto.search).toBeUndefined();
    });

    it('validates correct pagination query input', async () => {
      const dto = plainToInstance(PaginationQueryDto, {
        page: '2',
        limit: '50',
        search: 'test',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
      expect(dto.page).toBe(2);
      expect(dto.limit).toBe(50);
      expect(dto.search).toBe('test');
    });

    it('rejects page less than 1', async () => {
      const dto = plainToInstance(PaginationQueryDto, { page: '0' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('page');
    });

    it('rejects limit greater than 100', async () => {
      const dto = plainToInstance(PaginationQueryDto, { limit: '101' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('limit');
    });

    it('rejects limit less than 1', async () => {
      const dto = plainToInstance(PaginationQueryDto, { limit: '-5' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('limit');
    });
  });
});
