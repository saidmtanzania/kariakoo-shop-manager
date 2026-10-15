import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService } from './health.service.js';
import { LivenessDto, ReadinessDto } from './health.dto.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness: the process is up. Never touches the database. */
  @Get()
  @ApiOkResponse({ type: LivenessDto })
  live(): LivenessDto {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Readiness: the API can serve traffic (database reachable). */
  @Get('ready')
  @ApiOkResponse({ type: ReadinessDto })
  @ApiServiceUnavailableResponse({ type: ReadinessDto })
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReadinessDto> {
    const readiness = await this.health.readiness();
    if (readiness.status !== 'ok') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return readiness;
  }
}
