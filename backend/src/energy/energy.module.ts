import { Module } from '@nestjs/common';
import { EnergyCalculatorService } from './energy-calculator.service';

@Module({
  providers: [EnergyCalculatorService],
  exports: [EnergyCalculatorService],
})
export class EnergyModule {}
