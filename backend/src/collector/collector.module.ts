import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { EnergyModule } from '../energy/energy.module';
import { CarbonClient } from './clients/carbon.client';
import { MetricsAggregatorClient } from './clients/metrics-aggregator.client';
import { CollectorRepository } from './collector.repository';
import { CollectorService } from './collector.service';

@Module({
  imports: [
    // Timeout curto: um serviço lento não pode travar o ciclo de coleta (RNF04/RNF05).
    HttpModule.register({ timeout: 5000, maxRedirects: 3 }),
    EnergyModule,
  ],
  providers: [
    CollectorService,
    CollectorRepository,
    MetricsAggregatorClient,
    CarbonClient,
  ],
})
export class CollectorModule {}
