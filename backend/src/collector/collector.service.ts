import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, Service, ServiceStatus } from '@prisma/client';
import { runWithConcurrency } from '../common/utils/run-with-concurrency';
import {
  EnergyCalculatorService,
  InvalidMetricsError,
} from '../energy/energy-calculator.service';
import { CarbonClient } from './clients/carbon.client';
import { MetricsAggregatorClient } from './clients/metrics-aggregator.client';
import {
  ExternalCarbonIntensity,
  ExternalMetrics,
  ExternalService,
  MetricsFetchResult,
} from './dto/external-api.types';
import { CollectorRepository } from './collector.repository';

interface CarbonReading {
  readonly intensityGco2PerKwh: number;
  readonly source: 'live' | 'cache';
}

/** Cache por ciclo: serviços da mesma região compartilham uma única requisição. */
type CycleCarbonCache = Map<string, Promise<CarbonReading | null>>;

/** Persiste nova leitura de carbono se mudou ou se a última tem mais que 1h. */
const CARBON_REFRESH_PERSIST_MS = 60 * 60 * 1000;
const DEFAULT_MAX_CONCURRENT = 5;

/**
 * Orquestra a coleta periódica. Não contém fórmulas (EnergyCalculatorService),
 * nem HTTP (clients), nem SQL (CollectorRepository).
 *
 * Fluxo por ciclo (a cada 30s):
 *  1. GET /services → upsert de cada serviço; ausentes viram UNAVAILABLE (RF01–RF04)
 *  2. GET /metrics/{id} com concorrência limitada (RF02)
 *  3. Intensidade de carbono por region_code, com fallback ao cache do banco
 *  4. Cálculo de energia/CO₂e e INSERT append-only em metric_snapshots (RF07)
 *  5. Falhas viram snapshots com erro + status UNAVAILABLE/STALE (RF05, RF06)
 */
@Injectable()
export class CollectorService {
  private readonly logger = new Logger(CollectorService.name);
  private readonly maxConcurrent: number;
  private isRunning = false;

  constructor(
    private readonly metricsClient: MetricsAggregatorClient,
    private readonly carbonClient: CarbonClient,
    private readonly energyCalculator: EnergyCalculatorService,
    private readonly repository: CollectorRepository,
    config: ConfigService,
  ) {
    const configured = Number(config.get('COLLECTOR_MAX_CONCURRENT'));
    this.maxConcurrent =
      Number.isInteger(configured) && configured > 0
        ? configured
        : DEFAULT_MAX_CONCURRENT;
  }

  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'metrics-collection' })
  async handleCron(): Promise<void> {
    // Evita sobreposição caso um ciclo demore mais que o intervalo.
    if (this.isRunning) {
      this.logger.warn('Ciclo anterior ainda em execução; ciclo ignorado.');
      return;
    }

    this.isRunning = true;
    try {
      await this.collectCycle();
    } catch (error) {
      this.logger.error(`Falha inesperada no ciclo de coleta: ${this.describe(error)}`);
    } finally {
      this.isRunning = false;
    }
  }

  /** Um ciclo completo de coleta. Público para facilitar testes e execução manual. */
  async collectCycle(): Promise<void> {
    const startedAt = new Date();

    let listed: ExternalService[];
    try {
      listed = await this.metricsClient.listServices();
    } catch (error) {
      // RNF05: agregador fora do ar não derruba a aplicação nem altera o histórico.
      this.logger.warn(
        `Agregador de métricas indisponível; ciclo ignorado (${this.describe(error)}).`,
      );
      return;
    }

    const removed = await this.repository.markMissingAsUnavailable(
      listed.map((service) => service.id),
    );
    if (removed > 0) {
      this.logger.warn(`${removed} serviço(s) removido(s) do agregador → UNAVAILABLE.`);
    }

    const carbonCache: CycleCarbonCache = new Map();
    await runWithConcurrency(listed, this.maxConcurrent, (external) =>
      this.processService(external, startedAt, carbonCache),
    );

    this.logger.log(
      `Ciclo concluído: ${listed.length} serviço(s) em ${Date.now() - startedAt.getTime()}ms.`,
    );
  }

  /** Falha isolada: nunca propaga exceção para os demais serviços. */
  private async processService(
    external: ExternalService,
    collectedAt: Date,
    carbonCache: CycleCarbonCache,
  ): Promise<void> {
    try {
      const service = await this.repository.upsertService(external, collectedAt);
      const result = await this.metricsClient.fetchMetrics(external.id);

      if (result.kind === 'ok') {
        await this.handleSuccess(service, result.payload, collectedAt, carbonCache);
      } else {
        await this.handleFailure(service, result, collectedAt);
      }
    } catch (error) {
      this.logger.error(
        `Erro ao processar o serviço "${external.id}": ${this.describe(error)}`,
      );
    }
  }

  private async handleSuccess(
    service: Service,
    payload: ExternalMetrics,
    collectedAt: Date,
    carbonCache: CycleCarbonCache,
  ): Promise<void> {
    const { metrics } = payload;
    const base = {
      serviceId: service.id,
      collectedAt,
      cpuPercent: metrics.cpu_percent,
      memoryGb: metrics.memory_gb,
      diskGb: metrics.disk_gb,
      networkGb: metrics.network_gb,
      collectionIntervalSeconds: payload.collection_interval_seconds,
      rawPayload: payload as unknown as Prisma.InputJsonValue,
    };

    let energyKwh: number;
    try {
      energyKwh = this.energyCalculator.estimateEnergy({
        cpuPercent: metrics.cpu_percent,
        memoryGb: metrics.memory_gb,
        diskGb: metrics.disk_gb,
        networkGb: metrics.network_gb,
        intervalSeconds: payload.collection_interval_seconds,
      }).totalKwh;
    } catch (error) {
      if (!(error instanceof InvalidMetricsError)) throw error;
      // Métricas inválidas equivalem a "ativo mas sem métricas utilizáveis" (RF06).
      await this.repository.insertSnapshot({
        ...base,
        isStale: true,
        errorMessage: error.message,
      });
      await this.repository.setServiceStatus(service.id, ServiceStatus.STALE);
      return;
    }

    const carbon = service.regionCode
      ? await this.resolveCarbon(service.regionCode, carbonCache)
      : null;

    let co2eGrams: number | null = null;
    let errorMessage: string | null = null;
    if (carbon) {
      co2eGrams = this.energyCalculator.estimateCo2eGrams(
        energyKwh,
        carbon.intensityGco2PerKwh,
      );
      if (carbon.source === 'cache') {
        errorMessage = 'CO₂e calculado com intensidade de carbono em cache (API de carbono indisponível).';
      }
    } else {
      errorMessage = 'CO₂e não calculado: intensidade de carbono indisponível.';
    }

    await this.repository.insertSnapshot({
      ...base,
      energyKwh,
      co2eGrams,
      carbonIntensityGco2: carbon?.intensityGco2PerKwh ?? null,
      isStale: false,
      errorMessage,
    });
    await this.repository.setServiceStatus(service.id, ServiceStatus.ACTIVE);
  }

  /** RF05 / RF06: registra a falha no histórico e sinaliza o status do serviço. */
  private async handleFailure(
    service: Service,
    result: Exclude<MetricsFetchResult, { kind: 'ok' }>,
    collectedAt: Date,
  ): Promise<void> {
    const isMetricsMissing = result.kind === 'metrics_missing';
    const status = isMetricsMissing
      ? ServiceStatus.STALE
      : ServiceStatus.UNAVAILABLE;

    await this.repository.insertSnapshot({
      serviceId: service.id,
      collectedAt,
      isStale: isMetricsMissing,
      errorMessage: `[${result.kind}] ${result.message}`,
    });
    await this.repository.setServiceStatus(service.id, status);

    this.logger.warn(`Serviço "${service.externalId}" → ${status} (${result.kind}).`);
  }

  private resolveCarbon(
    regionCode: string,
    cache: CycleCarbonCache,
  ): Promise<CarbonReading | null> {
    let pending = cache.get(regionCode);
    if (!pending) {
      pending = this.fetchCarbonWithFallback(regionCode);
      cache.set(regionCode, pending);
    }
    return pending;
  }

  /** API de carbono → (falhou) → última leitura salva no banco → (vazio) → null. */
  private async fetchCarbonWithFallback(
    regionCode: string,
  ): Promise<CarbonReading | null> {
    try {
      const live = await this.carbonClient.getIntensity(regionCode);
      await this.persistCarbonIfRelevant(live);
      return {
        intensityGco2PerKwh: live.carbon_intensity_gco2e_per_kwh,
        source: 'live',
      };
    } catch (error) {
      this.logger.warn(
        `API de carbono falhou para "${regionCode}" (${this.describe(error)}); usando cache.`,
      );
      const cached = await this.repository.findLatestCarbonIntensity(regionCode);
      return cached
        ? {
            intensityGco2PerKwh: cached.intensityGco2.toNumber(),
            source: 'cache',
          }
        : null;
    }
  }

  /** Evita inserir uma linha por ciclo quando o fator regional não mudou. */
  private async persistCarbonIfRelevant(
    live: ExternalCarbonIntensity,
  ): Promise<void> {
    try {
      const latest = await this.repository.findLatestCarbonIntensity(
        live.region_code,
      );
      const changed =
        !latest ||
        latest.intensityGco2.toNumber() !== live.carbon_intensity_gco2e_per_kwh;
      const outdated =
        !!latest &&
        Date.now() - latest.recordedAt.getTime() > CARBON_REFRESH_PERSIST_MS;

      if (changed || outdated) {
        await this.repository.insertCarbonIntensity({
          regionCode: live.region_code,
          country: live.country,
          intensityGco2: live.carbon_intensity_gco2e_per_kwh,
          renewableSharePercent: live.renewable_share_percent,
        });
      }
    } catch (error) {
      // Falha ao cachear não invalida a leitura "live" já obtida.
      this.logger.warn(
        `Não foi possível persistir a intensidade de "${live.region_code}": ${this.describe(error)}`,
      );
    }
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
