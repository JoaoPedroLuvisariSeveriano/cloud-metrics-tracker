import { Injectable } from '@nestjs/common';

/** Métricas de entrada, na mesma unidade devolvida por GET /metrics/{id}. */
export interface EnergyMetricsInput {
  /** Utilização de CPU, 0–100. */
  readonly cpuPercent: number;
  /** Memória em uso, em GB. */
  readonly memoryGb: number;
  /** Armazenamento em disco, em GB. */
  readonly diskGb: number;
  /** Volume de rede transferido no intervalo de coleta, em GB. */
  readonly networkGb: number;
  /** Janela de coleta (collection_interval_seconds), em segundos. */
  readonly intervalSeconds: number;
}

/** Coeficientes do modelo. Todos configuráveis para calibração futura. */
export interface EnergyCoefficients {
  /** Potência da CPU em repouso (W). */
  readonly cpuIdleWatts: number;
  /** Potência da CPU a 100% de utilização (W). */
  readonly cpuMaxWatts: number;
  /** Potência da memória por GB alocado (W/GB). */
  readonly memoryWattsPerGb: number;
  /** Energia de armazenamento (kWh por GB por hora). */
  readonly diskKwhPerGbHour: number;
  /** Energia de transmissão de dados (kWh por GB transferido). */
  readonly networkKwhPerGb: number;
  /** Power Usage Effectiveness do datacenter (>= 1). */
  readonly pue: number;
}

/** Consumo discriminado por componente, em kWh (já com PUE aplicado). */
export interface EnergyBreakdown {
  readonly cpuKwh: number;
  readonly memoryKwh: number;
  readonly diskKwh: number;
  readonly networkKwh: number;
  readonly totalKwh: number;
}

export interface EmissionEstimate {
  readonly breakdown: EnergyBreakdown;
  readonly energyKwh: number;
  readonly co2eGrams: number;
}

/**
 * Valores de referência inspirados no Cloud Carbon Footprint (CCF):
 *  - Memória: 0,3725 W/GB
 *  - HDD: 0,65 Wh/TB·h  => 6,5e-7 kWh/GB·h
 *  - Rede: 0,001 kWh/GB
 *  - PUE: 1,135
 * A faixa de CPU (idle→max) segue o modelo linear usado em estimadores
 * RAPL-like: P = P_idle + (P_max − P_idle) × utilização.
 */
export const DEFAULT_ENERGY_COEFFICIENTS: EnergyCoefficients = Object.freeze({
  cpuIdleWatts: 12,
  cpuMaxWatts: 65,
  memoryWattsPerGb: 0.3725,
  diskKwhPerGbHour: 6.5e-7,
  networkKwhPerGb: 0.001,
  pue: 1.135,
});

/** Lançado quando as métricas recebidas não permitem um cálculo confiável. */
export class InvalidMetricsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMetricsError';
  }
}

const SECONDS_PER_HOUR = 3600;
const WATTS_PER_KILOWATT = 1000;

/**
 * Calculadora pura de energia e CO₂e.
 *
 * Sem acesso a banco, HTTP ou estado: mesma entrada => mesma saída.
 * É consumida pelo CollectorService; controllers jamais devem calculá-la.
 */
@Injectable()
export class EnergyCalculatorService {
  /**
   * Estima a energia consumida (kWh) durante a janela de coleta.
   * @throws InvalidMetricsError se alguma métrica for ausente, não finita ou fora de faixa.
   */
  estimateEnergy(
    input: EnergyMetricsInput,
    coefficients: EnergyCoefficients = DEFAULT_ENERGY_COEFFICIENTS,
  ): EnergyBreakdown {
    this.assertValidInput(input);
    this.assertValidCoefficients(coefficients);

    const hours = input.intervalSeconds / SECONDS_PER_HOUR;
    const pue = coefficients.pue;

    const cpuWatts =
      coefficients.cpuIdleWatts +
      (coefficients.cpuMaxWatts - coefficients.cpuIdleWatts) *
        (input.cpuPercent / 100);

    const cpuKwh = ((cpuWatts * hours) / WATTS_PER_KILOWATT) * pue;
    const memoryKwh =
      ((input.memoryGb * coefficients.memoryWattsPerGb * hours) /
        WATTS_PER_KILOWATT) *
      pue;
    const diskKwh =
      input.diskGb * coefficients.diskKwhPerGbHour * hours * pue;
    const networkKwh = input.networkGb * coefficients.networkKwhPerGb * pue;

    return {
      cpuKwh,
      memoryKwh,
      diskKwh,
      networkKwh,
      totalKwh: cpuKwh + memoryKwh + diskKwh + networkKwh,
    };
  }

  /**
   * CO₂e (gramas) = energia (kWh) × intensidade (gCO₂e/kWh).
   * @throws InvalidMetricsError se energia ou intensidade forem inválidas.
   */
  estimateCo2eGrams(
    energyKwh: number,
    carbonIntensityGco2PerKwh: number,
  ): number {
    this.assertNonNegativeFinite('energyKwh', energyKwh);
    this.assertNonNegativeFinite(
      'carbonIntensityGco2PerKwh',
      carbonIntensityGco2PerKwh,
    );
    return energyKwh * carbonIntensityGco2PerKwh;
  }

  /** Conveniência: energia + CO₂e em uma única chamada. */
  estimateEmission(
    input: EnergyMetricsInput,
    carbonIntensityGco2PerKwh: number,
    coefficients: EnergyCoefficients = DEFAULT_ENERGY_COEFFICIENTS,
  ): EmissionEstimate {
    const breakdown = this.estimateEnergy(input, coefficients);
    return {
      breakdown,
      energyKwh: breakdown.totalKwh,
      co2eGrams: this.estimateCo2eGrams(
        breakdown.totalKwh,
        carbonIntensityGco2PerKwh,
      ),
    };
  }

  private assertValidInput(input: EnergyMetricsInput): void {
    if (input === null || typeof input !== 'object') {
      throw new InvalidMetricsError('Métricas ausentes.');
    }
    this.assertNonNegativeFinite('cpuPercent', input.cpuPercent);
    if (input.cpuPercent > 100) {
      throw new InvalidMetricsError(
        `cpuPercent fora da faixa 0–100: ${input.cpuPercent}`,
      );
    }
    this.assertNonNegativeFinite('memoryGb', input.memoryGb);
    this.assertNonNegativeFinite('diskGb', input.diskGb);
    this.assertNonNegativeFinite('networkGb', input.networkGb);
    this.assertNonNegativeFinite('intervalSeconds', input.intervalSeconds);
    if (input.intervalSeconds === 0) {
      throw new InvalidMetricsError('intervalSeconds deve ser maior que zero.');
    }
  }

  private assertValidCoefficients(c: EnergyCoefficients): void {
    if (c.cpuMaxWatts < c.cpuIdleWatts) {
      throw new InvalidMetricsError(
        'cpuMaxWatts não pode ser menor que cpuIdleWatts.',
      );
    }
    if (c.pue < 1) {
      throw new InvalidMetricsError('pue deve ser maior ou igual a 1.');
    }
  }

  private assertNonNegativeFinite(name: string, value: unknown): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new InvalidMetricsError(
        `${name} inválido (esperado número finito >= 0): ${String(value)}`,
      );
    }
  }
}
