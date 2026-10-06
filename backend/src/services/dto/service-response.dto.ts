import { ServiceStatus } from '@prisma/client';

export class ServiceLocationDto {
  regionCode!: string | null;
  country!: string | null;
  region!: string | null;
  city!: string | null;
  latitude!: number | null;
  longitude!: number | null;
}

export class LatestSnapshotDto {
  collectedAt!: Date;
  cpuPercent!: number | null;
  memoryGb!: number | null;
  diskGb!: number | null;
  networkGb!: number | null;
  energyKwh!: number | null;
  co2eGrams!: number | null;
  carbonIntensityGco2!: number | null;
  isStale!: boolean;
  errorMessage!: string | null;
}

export class AccumulatedTotalsDto {
  energyKwh!: number;
  co2eGrams!: number;
  snapshotCount!: number;
}

export class ServiceResponseDto {
  id!: string;
  externalId!: string;
  name!: string;
  status!: ServiceStatus;
  location!: ServiceLocationDto;
  lastSeenAt!: Date | null;
  latestSnapshot!: LatestSnapshotDto | null;
  accumulated!: AccumulatedTotalsDto;
}

/** Indicadores globais agregados (RF08) + transparência da última coleta (RNF03). */
export class ServicesSummaryDto {
  totalServices!: number;
  activeServices!: number;
  unavailableServices!: number;
  staleServices!: number;
  accumulatedEnergyKwh!: number;
  accumulatedCo2eGrams!: number;
  lastCollectionAt!: Date | null;
}

export class ServiceListResponseDto {
  summary!: ServicesSummaryDto;
  services!: ServiceResponseDto[];
}
