/**
 * Executa `worker` para cada item com no máximo `concurrency` execuções
 * simultâneas. O worker NÃO deve lançar exceções (trate-as internamente);
 * assim a falha de um item nunca interrompe os demais.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue: T[] = [...items];
  const poolSize = Math.max(1, Math.min(Math.floor(concurrency), queue.length));

  const runners = Array.from({ length: poolSize }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await worker(item);
    }
  });

  await Promise.all(runners);
}
