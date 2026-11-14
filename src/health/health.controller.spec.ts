import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaService } from '../database/prisma.service';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: jest.Mocked<HealthCheckService>;
  let prismaHealthIndicator: jest.Mocked<PrismaHealthIndicator>;
  let prismaService: PrismaService;

  beforeEach(async () => {
    healthCheckService = {
      check: jest.fn(),
    } as unknown as jest.Mocked<HealthCheckService>;

    prismaHealthIndicator = {
      pingCheck: jest.fn(),
    } as unknown as jest.Mocked<PrismaHealthIndicator>;

    prismaService = {} as PrismaService;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: healthCheckService,
        },
        {
          provide: PrismaHealthIndicator,
          useValue: prismaHealthIndicator,
        },
        {
          provide: PrismaService,
          useValue: prismaService,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('live', () => {
    it('returns health check with no indicators', async () => {
      const mockResult = {
        status: 'ok' as const,
        info: {},
        error: {},
        details: {},
      };
      healthCheckService.check.mockResolvedValue(mockResult);

      const result = await controller.live();

      expect(healthCheckService.check).toHaveBeenCalledWith([]);
      expect(result).toEqual(mockResult);
    });
  });

  describe('ready', () => {
    it('returns health check with database ping indicator', async () => {
      const mockResult = {
        status: 'ok' as const,
        info: { database: { status: 'up' } },
        error: {},
        details: { database: { status: 'up' } },
      };
      healthCheckService.check.mockImplementation(async (indicators) => {
        for (const indicator of indicators) {
          await indicator();
        }
        return mockResult;
      });
      prismaHealthIndicator.pingCheck.mockResolvedValue({
        database: { status: 'up' },
      });

      const result = await controller.ready();

      expect(healthCheckService.check).toHaveBeenCalled();
      expect(prismaHealthIndicator.pingCheck).toHaveBeenCalledWith(
        'database',
        prismaService,
      );
      expect(result).toEqual(mockResult);
    });
  });
});

