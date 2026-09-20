/** Keep long-running localnet operations visible without logging every RPC poll. */
export async function withProgress<T>(label: string, action: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
  console.log(`[bootstrap] ${label}`);
  const heartbeat = setInterval(
    () => console.log(`[bootstrap] ${label}: still waiting (${elapsed()})`),
    10_000,
  );
  heartbeat.unref();
  try {
    const result = await action();
    console.log(`[bootstrap] ${label}: done (${elapsed()})`);
    return result;
  } catch (cause) {
    throw new Error(`[bootstrap] ${label}: failed after ${elapsed()}`, { cause });
  } finally {
    clearInterval(heartbeat);
  }
}
