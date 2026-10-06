import { Prisma } from '@prisma/client';

/** Converte Prisma.Decimal (ou null/undefined) para number | null. */
export function decimalToNumber(
  value: Prisma.Decimal | null | undefined,
): number | null {
  return value === null || value === undefined ? null : value.toNumber();
}
