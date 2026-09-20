import { run } from './process'

const OPENER: Record<string, [string, string[]]> = {
  darwin: ['open', []],
  win32: ['cmd', ['/c', 'start', '']],
}

// Over SSH the opener runs on the machine druk is on, not the one being looked at.
const ENV = 'DRUK_BROWSER'

// A browser of one's own: the desktop's handler decides which, as every other tool does.
export async function openInBrowser(url: string): Promise<boolean> {
  if (process.env[ENV] === 'off' || process.env[ENV] === '0') return false
  const [bin, args] = OPENER[process.platform] ?? ['xdg-open', []]
  if (!Bun.which(bin)) return false
  const opened = await run(bin, [...args, url], { timeout: 5000 })
  return opened.error === null && opened.status === 0
}
