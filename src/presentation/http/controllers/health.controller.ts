import { Controller, Get, Inject } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { HEALTH_PROBE, HealthProbe } from '../../../application/ports/health-probe';

@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    @Inject(HEALTH_PROBE) private readonly probe: HealthProbe,
  ) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      async () => {
        const status = await this.probe.check();
        const indicator = this.indicators.check('postgres');
        return status.db && status.migrations
          ? indicator.up({ migrations: 'applied' })
          : indicator.down({
              reachable: status.db,
              migrations: status.migrations ? 'applied' : 'pending',
            });
      },
    ]);
  }
}
