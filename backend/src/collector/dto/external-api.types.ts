/**
 * Tipos e type guards do contrato REAL das APIs externas
 * (https://metrics.unilaunch.org/openapi.json e https://carbon.unilaunch.org/openapi.json).
 * Os guards validam o payload em runtime: uma resposta malformada vira
 * falha tratada, nunca uma exceção não capturada.
 */

// ── Agregador de Métricas ─────────────────────────────────────────────────────
export interface ExternalLocation {
  region_code: string;
  country: string;
  region: string;
  city: string | null;
  latitude: number;
  longitude: number;
}

/** GET /services → ServiceSummary[] */
export interface ExternalService {
  id: string;
  name: string;
  location: ExternalLocation;
  metrics_path: string;
}

/** GET /metrics/{service_id} → MetricsResponse */
export interface ExternalMetrics {
  collection_interval_seconds: number;
  metrics: {
    cpu_percent: number;
    memory_gb: number;
    disk_gb: number;
    network_gb: number;
  };
}

/**
 * Resultado tipado da coleta de métricas, mapeando o contrato:
 *  200 → ok | 404 → not_listed | 500 → unavailable / metrics_missing
 *  sem resposta (timeout, DNS, conexão) → unreachable
 */
export type MetricsFetchResult =
  | { kind: 'ok'; payload: ExternalMetrics }
  | { kind: 'not_listed'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'metrics_missing'; message: string }
  | { kind: 'unreachable'; message: string };

// ── Serviço de Intensidade de Carbono ─────────────────────────────────────────
/** GET /carbon-intensity/{code} → CarbonIntensityResponse */
export interface ExternalCarbonIntensity {
  region_code: string;
  country: string;
  region: string;
  city: string | null;
  carbon_intensity_gco2e_per_kwh: number;
  renewable_share_percent: number;
}

// ── Type guards ───────────────────────────────────────────────────────────────
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function isExternalService(value: unknown): value is ExternalService {
  if (!isRecord(value)) return false;
  const { id, name, location, metrics_path } = value;
  if (typeof id !== 'string' || id === '' || typeof name !== 'string') {
    return false;
  }
  if (typeof metrics_path !== 'string' || !isRecord(location)) return false;

  return (
    typeof location.region_code === 'string' &&
    typeof location.country === 'string' &&
    typeof location.region === 'string' &&
    (location.city === null ||
      location.city === undefined ||
      typeof location.city === 'string') &&
    isFiniteNumber(location.latitude) &&
    isFiniteNumber(location.longitude)
  );
}

export function isExternalMetrics(value: unknown): value is ExternalMetrics {
  if (!isRecord(value)) return false;
  const { collection_interval_seconds, metrics } = value;
  if (!isFiniteNumber(collection_interval_seconds) || !isRecord(metrics)) {
    return false;
  }
  return (
    isFiniteNumber(metrics.cpu_percent) &&
    isFiniteNumber(metrics.memory_gb) &&
    isFiniteNumber(metrics.disk_gb) &&
    isFiniteNumber(metrics.network_gb)
  );
}

export function isExternalCarbonIntensity(
  value: unknown,
): value is ExternalCarbonIntensity {
  if (!isRecord(value)) return false;
  return (
    typeof value.region_code === 'string' &&
    isFiniteNumber(value.carbon_intensity_gco2e_per_kwh) &&
    isFiniteNumber(value.renewable_share_percent)
  );
}
