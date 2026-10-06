const REQUIRED_VARS = [
  'DATABASE_URL',
  'METRICS_API_URL',
  'CARBON_API_URL',
] as const;

/** Falha o bootstrap imediatamente se faltar alguma variável obrigatória. */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const missing = REQUIRED_VARS.filter((key) => {
    const value = config[key];
    return typeof value !== 'string' || value.trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(
      `Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}`,
    );
  }
  return config;
}
