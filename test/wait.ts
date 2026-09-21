// scripts/test.ts raises this when files run concurrently.
export const SLOW = Number(process.env.DRUK_TEST_SLOW) || 1

// Polls instead of sleeping a guessed interval: a fixed wait long enough for a loaded machine
// is dead time on an idle one, and one tuned on an idle machine is a flake on a loaded one.
export async function waitFor(
  cond: () => boolean,
  timeoutMs = 2000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs * SLOW
  while (!cond() && Date.now() < deadline) {
    await Bun.sleep(10)
  }
  return cond()
}
