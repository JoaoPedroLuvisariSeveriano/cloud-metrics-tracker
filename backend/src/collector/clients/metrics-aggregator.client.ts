import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import {
  ExternalService,
  MetricsFetchResult,
  isExternalMetrics,
  isExternalService,
  isRecord,
} from '../dto/external-api.types';

/**
 * Cliente HTTP do Agregador de Métricas (https://metrics.unilaunch.org).
 * Responsabilidade única: comunicação e tradução do contrato — sem regras de negócio.
 */
@Injectable()
export class MetricsAggregatorClient {
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.baseUrl = config
      .getOrThrow<string>('METRICS_API_URL')
      .replace(/\/+$/, '');
  }

  /**
   * GET /services — serviços atualmente registrados.
   * Lança erro se o agregador estiver inacessível ou responder fora do contrato;
   * o chamador decide como degradar (ex.: pular o ciclo).
   */
  async listServices(): Promise<ExternalService[]> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.baseUrl}/services`),
    );

    if (!Array.isArray(response.data)) {
      throw new Error('GET /services respondeu fora do contrato (não é array).');
    }
    return response.data.filter(isExternalService);
  }

  /**
   * GET /metrics/{service_id}. Nunca lança: todo desfecho vira um MetricsFetchResult.
   *  - 200 + payload válido → ok
   *  - 404                  → not_listed (serviço removido)
   *  - 500                  → unavailable | metrics_missing (conforme `error` do corpo)
   *  - sem resposta         → unreachable
   */
  async fetchMetrics(serviceId: string): Promise<MetricsFetchResult> {
    const url = `${this.baseUrl}/metrics/${encodeURIComponent(serviceId)}`;

    try {
      const response = await firstValueFrom(this.http.get<unknown>(url));
      if (!isExternalMetrics(response.data)) {
        return {
          kind: 'metrics_missing',
          message: 'Resposta de métricas fora do contrato esperado.',
        };
      }
      return { kind: 'ok', payload: response.data };
    } catch (error) {
      return this.translateError(serviceId, error);
    }
  }

  private translateError(serviceId: string, error: unknown): MetricsFetchResult {
    if (!isAxiosError(error)) {
      return {
        kind: 'unreachable',
        message: error instanceof Error ? error.message : 'Erro desconhecido.',
      };
    }

    const status = error.response?.status;
    const body: unknown = error.response?.data;
    const message =
      isRecord(body) && typeof body.message === 'string'
        ? body.message
        : error.message;

    if (status === undefined) {
      return { kind: 'unreachable', message };
    }
    if (status === 404) {
      return { kind: 'not_listed', message };
    }

    // 500 (e demais 5xx): serviço listado, porém sem responder ou sem métricas.
    const code =
      isRecord(body) && typeof body.error === 'string'
        ? body.error.toLowerCase()
        : '';
    const kind =
      code.includes('missing') || code.includes('no_metrics')
        ? 'metrics_missing'
        : 'unavailable';

    return { kind, message: message || `Falha ao coletar ${serviceId}` };
  }
}
