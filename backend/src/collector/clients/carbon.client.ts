import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  ExternalCarbonIntensity,
  isExternalCarbonIntensity,
} from '../dto/external-api.types';

/**
 * Cliente HTTP do Serviço de Intensidade de Carbono (https://carbon.unilaunch.org).
 * Usa o region_code retornado pelo agregador de métricas.
 */
@Injectable()
export class CarbonClient {
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.baseUrl = config
      .getOrThrow<string>('CARBON_API_URL')
      .replace(/\/+$/, '');
  }

  /**
   * GET /carbon-intensity/{code} → gCO₂e/kWh da região.
   * Lança erro em 404, indisponibilidade ou payload fora do contrato;
   * o CollectorService aplica o fallback para o cache do banco.
   */
  async getIntensity(regionCode: string): Promise<ExternalCarbonIntensity> {
    const response = await firstValueFrom(
      this.http.get<unknown>(
        `${this.baseUrl}/carbon-intensity/${encodeURIComponent(regionCode)}`,
      ),
    );

    if (!isExternalCarbonIntensity(response.data)) {
      throw new Error(
        `Intensidade de carbono fora do contrato para a região "${regionCode}".`,
      );
    }
    return response.data;
  }
}
