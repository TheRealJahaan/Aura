import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [AssistantModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
