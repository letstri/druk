// One file per process: bun test leaks state between files; --parallel busy-spins (bun#27766).
import { spawnSync } from 'bun'

const FILE_CAP_MS = 90 * 1000

const files = [...new Bun.Glob('test/*.test.{ts,tsx}').scanSync()].toSorted()
const failed: string[] = []
const started = Date.now()

for (const file of files) {
  const run = spawnSync(['bun', 'test', file], {
    stdout: 'inherit',
    stderr: 'inherit',
    timeout: FILE_CAP_MS,
    killSignal: 'SIGKILL',
  })
  if (run.exitCode !== 0) {
    failed.push(file + (run.exitedDueToTimeout ? ' (hung, killed)' : ''))
  }
}

const seconds = Math.round((Date.now() - started) / 1000)
if (failed.length > 0) {
  console.error(`\n${failed.length} of ${files.length} files failed in ${seconds}s:`)
  for (const file of failed) console.error(`  ${file}`)
  process.exit(1)
}
process.stdout.write(`\n${files.length} files passed in ${seconds}s\n`)
