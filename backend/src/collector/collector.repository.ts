import { Injectable } from '@nestjs/common';
import {
  CarbonIntensity,
  Prisma,
  Service,
  ServiceStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ExternalService } from './dto/external-api.types';

/**
 * Camada de acesso a dados do coletor.
 * metric_snapshots e carbon_intensities são APPEND-ONLY: aqui só existem inserts.
 */
@Injectable()
export class CollectorRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Cria o serviço (RF03: novos serviços) ou atualiza metadados e lastSeenAt. */
  upsertService(external: ExternalService, seenAt: Date): Promise<Service> {
    const { location } = external;
    const metadata = {
      name: external.name,
      regionCode: location.region_code,
      country: location.country,
      region: location.region,
      city: location.city ?? null,
      latitude: location.latitude,
      longitude: location.longitude,
      lastSeenAt: seenAt,
    };

    return this.prisma.service.upsert({
      where: { externalId: external.id },
      create: { externalId: external.id, ...metadata },
      update: metadata,
    });
  }

  /** RF03: serviços que sumiram de GET /services passam a UNAVAILABLE. */
  async markMissingAsUnavailable(listedExternalIds: string[]): Promise<number> {
    const { count } = await this.prisma.service.updateMany({
      where: {
        externalId: { notIn: listedExternalIds },
        status: { not: ServiceStatus.UNAVAILABLE },
      },
      data: { status: ServiceStatus.UNAVAILABLE },
    });
    return count;
  }

  async setServiceStatus(id: string, status: ServiceStatus): Promise<void> {
    await this.prisma.service.update({ where: { id }, data: { status } });
  }

  async insertSnapshot(
    data: Prisma.MetricSnapshotUncheckedCreateInput,
  ): Promise<void> {
    await this.prisma.metricSnapshot.create({ data });
  }

  findLatestCarbonIntensity(regionCode: string): Promise<CarbonIntensity | null> {
    return this.prisma.carbonIntensity.findFirst({
      where: { regionCode },
      orderBy: { recordedAt: 'desc' },
    });
  }

  async insertCarbonIntensity(
    data: Prisma.CarbonIntensityUncheckedCreateInput,
  ): Promise<void> {
    await this.prisma.carbonIntensity.create({ data });
  }
}
