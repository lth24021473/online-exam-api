import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('Health')
@SkipThrottle()
@Controller(['health', 'api/v1/health'])
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly redisService: RedisService,
  ) {}

  private checkRedis() {
    return this.healthIndicatorService
      .check('redis')
      .attempt(async () => {
        const response = await this.redisService.ping();
        if (response !== 'PONG') {
          throw new Error(
            `Unexpected Redis ping response: ${String(response)}`,
          );
        }
      })
      .withTimeout(2000);
  }

  @Get()
  @HealthCheck()
  @ApiOperation({
    summary:
      'Health check for container orchestration, database, and Redis connectivity',
  })
  @ApiOkResponse({
    description: 'Service is healthy and dependencies are reachable',
  })
  @ApiServiceUnavailableResponse({
    description: 'Service or dependencies are unhealthy',
  })
  check() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma),
      () => this.checkRedis(),
    ]);
  }

  @Get('live')
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness check for container orchestration' })
  @ApiOkResponse({ description: 'Service is alive and running' })
  live() {
    return this.health.check([]);
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({
    summary:
      'Readiness check for container orchestration, database, and Redis connectivity',
  })
  @ApiOkResponse({
    description:
      'Service is ready to accept traffic and dependencies are reachable',
  })
  @ApiServiceUnavailableResponse({
    description: 'Service or dependencies are unhealthy',
  })
  ready() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma),
      () => this.checkRedis(),
    ]);
  }
}

