// One file per process: bun test leaks state between files; --parallel (in-process workers)
// busy-spins forever on macOS ARM (bun#27766). Separate processes are not that bug.
import { spawn } from 'bun'

const FILE_CAP_MS = 120 * 1000
// Each file peaks at ~1.6 CPUs (renderer threads), and the 5s per-test default is what a
// loaded machine blows through first — hence the raised timeout below.
const JOBS =
  Number(process.env.DRUK_TEST_JOBS) || Math.max(2, Math.ceil(navigator.hardwareConcurrency / 2))
const TEST_TIMEOUT_MS = Number(process.env.DRUK_TEST_TIMEOUT) || 60_000
// Concurrent files starve each other's renderer and tree-sitter threads, so every wall-clock
// wait in the harness is stretched by this much. Bun.spawn snapshots the env at startup, so
// this has to be handed to each child rather than set on process.env.
const env = { ...process.env, DRUK_TEST_SLOW: String(JOBS > 1 ? 3 : 1) }

const files = [...new Bun.Glob('test/*.test.{ts,tsx}').scanSync()].toSorted()
const failed: string[] = []
const started = Date.now()

async function run(file: string) {
  const proc = spawn(['bun', 'test', '--timeout', String(TEST_TIMEOUT_MS), file], {
    env,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: FILE_CAP_MS,
    killSignal: 'SIGKILL',
  })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  // Buffered, not inherited: concurrent children would interleave their reports line by line.
  process.stdout.write(out + err)
  if (code !== 0) failed.push(file + (proc.signalCode === 'SIGKILL' ? ' (hung, killed)' : ''))
}

const queue = files.values()
await Promise.all(
  Array.from({ length: Math.min(JOBS, files.length) }, async () => {
    for (const file of queue) await run(file)
  }),
)

const seconds = Math.round((Date.now() - started) / 1000)
if (failed.length > 0) {
  console.error(`\n${failed.length} of ${files.length} files failed in ${seconds}s:`)
  for (const file of failed) console.error(`  ${file}`)
  process.exit(1)
}
process.stdout.write(`\n${files.length} files passed in ${seconds}s (${JOBS} jobs)\n`)
