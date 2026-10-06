import { Injectable, NotFoundException } from '@nestjs/common';
import { MetricSnapshot, Service, ServiceStatus } from '@prisma/client';
import { decimalToNumber } from '../common/utils/decimal';
import { PrismaService } from '../database/prisma.service';
import {
  AccumulatedTotalsDto,
  LatestSnapshotDto,
  ServiceListResponseDto,
  ServiceResponseDto,
} from './dto/service-response.dto';

const EMPTY_TOTALS: AccumulatedTotalsDto = {
  energyKwh: 0,
  co2eGrams: 0,
  snapshotCount: 0,
};

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista serviços com status atual, última coleta e totais acumulados + resumo global. */
  async findAll(): Promise<ServiceListResponseDto> {
    const [services, latestSnapshots, totals] = await Promise.all([
      this.prisma.service.findMany({ orderBy: { name: 'asc' } }),
      // Último snapshot de cada serviço (distinct + ordenação por data desc).
      this.prisma.metricSnapshot.findMany({
        distinct: ['serviceId'],
        orderBy: [{ serviceId: 'asc' }, { collectedAt: 'desc' }],
      }),
      this.prisma.metricSnapshot.groupBy({
        by: ['serviceId'],
        _sum: { energyKwh: true, co2eGrams: true },
        _count: { _all: true },
      }),
    ]);

    const latestByService = new Map(
      latestSnapshots.map((snapshot) => [snapshot.serviceId, snapshot]),
    );
    const totalsByService = new Map<string, AccumulatedTotalsDto>(
      totals.map((row) => [
        row.serviceId,
        {
          energyKwh: decimalToNumber(row._sum.energyKwh) ?? 0,
          co2eGrams: decimalToNumber(row._sum.co2eGrams) ?? 0,
          snapshotCount: row._count._all,
        },
      ]),
    );

    const items = services.map((service) =>
      this.toResponse(
        service,
        latestByService.get(service.id) ?? null,
        totalsByService.get(service.id) ?? EMPTY_TOTALS,
      ),
    );

    const countByStatus = (status: ServiceStatus): number =>
      services.filter((service) => service.status === status).length;

    const lastCollectionAt = latestSnapshots.reduce<Date | null>(
      (latest, snapshot) =>
        latest === null || snapshot.collectedAt > latest
          ? snapshot.collectedAt
          : latest,
      null,
    );

    return {
      summary: {
        totalServices: services.length,
        activeServices: countByStatus(ServiceStatus.ACTIVE),
        unavailableServices: countByStatus(ServiceStatus.UNAVAILABLE),
        staleServices: countByStatus(ServiceStatus.STALE),
        accumulatedEnergyKwh: items.reduce((sum, i) => sum + i.accumulated.energyKwh, 0),
        accumulatedCo2eGrams: items.reduce((sum, i) => sum + i.accumulated.co2eGrams, 0),
        lastCollectionAt,
      },
      services: items,
    };
  }

  /** @throws NotFoundException se o serviço não existir. */
  async findOne(id: string): Promise<ServiceResponseDto> {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) {
      throw new NotFoundException(`Serviço "${id}" não encontrado.`);
    }

    const [latest, totals] = await Promise.all([
      this.prisma.metricSnapshot.findFirst({
        where: { serviceId: id },
        orderBy: { collectedAt: 'desc' },
      }),
      this.prisma.metricSnapshot.aggregate({
        where: { serviceId: id },
        _sum: { energyKwh: true, co2eGrams: true },
        _count: { _all: true },
      }),
    ]);

    return this.toResponse(service, latest, {
      energyKwh: decimalToNumber(totals._sum.energyKwh) ?? 0,
      co2eGrams: decimalToNumber(totals._sum.co2eGrams) ?? 0,
      snapshotCount: totals._count._all,
    });
  }

  private toResponse(
    service: Service,
    latest: MetricSnapshot | null,
    accumulated: AccumulatedTotalsDto,
  ): ServiceResponseDto {
    return {
      id: service.id,
      externalId: service.externalId,
      name: service.name,
      status: service.status,
      location: {
        regionCode: service.regionCode,
        country: service.country,
        region: service.region,
        city: service.city,
        latitude: decimalToNumber(service.latitude),
        longitude: decimalToNumber(service.longitude),
      },
      lastSeenAt: service.lastSeenAt,
      latestSnapshot: latest ? this.toSnapshotDto(latest) : null,
      accumulated,
    };
  }

  private toSnapshotDto(snapshot: MetricSnapshot): LatestSnapshotDto {
    return {
      collectedAt: snapshot.collectedAt,
      cpuPercent: decimalToNumber(snapshot.cpuPercent),
      memoryGb: decimalToNumber(snapshot.memoryGb),
      diskGb: decimalToNumber(snapshot.diskGb),
      networkGb: decimalToNumber(snapshot.networkGb),
      energyKwh: decimalToNumber(snapshot.energyKwh),
      co2eGrams: decimalToNumber(snapshot.co2eGrams),
      carbonIntensityGco2: decimalToNumber(snapshot.carbonIntensityGco2),
      isStale: snapshot.isStale,
      errorMessage: snapshot.errorMessage,
    };
  }
}
