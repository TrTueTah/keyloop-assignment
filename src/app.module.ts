import { DynamicModule, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { PlatformModule, PlatformOptions } from './modules/platform.module';
import { ReferenceModule } from './modules/reference.module';
import { SchedulingModule } from './modules/scheduling.module';
import { HealthController } from './presentation/http/controllers/health.controller';

@Module({})
export class AppModule {
  static forRoot(options: PlatformOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [PlatformModule.forRoot(options), TerminusModule, SchedulingModule, ReferenceModule],
      controllers: [HealthController],
    };
  }
}
