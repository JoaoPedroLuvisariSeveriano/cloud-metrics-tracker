import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { CollectorModule } from './collector/collector.module';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { EnergyModule } from './energy/energy.module';
import { ServicesModule } from './services/services.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    EnergyModule,
    CollectorModule,
    ServicesModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
