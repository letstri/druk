import { deflateSync } from 'node:zlib'

const ESC = '\u001B'
// The protocol's cap on one escape's base64 payload.
const CHUNK = 4096

const ENV = 'DRUK_KITTY_IMAGES'

export function supportsKittyImages(
  detected: boolean | undefined,
  env: NodeJS.ProcessEnv = process.env,
  tty = Boolean(process.stdout.isTTY)
): boolean {
  const forced = env[ENV]
  if (forced === '0' || forced === 'off') {
    return false
  }
  if (!tty) {
    return false
  }
  if (forced === '1' || forced === 'on') {
    return true
  }
  return detected === true
}

export interface CellSize {
  width: number
  height: number
}

export interface CellBox {
  cols: number
  rows: number
}

export function encodePlace(
  rgba: Uint8Array,
  width: number,
  height: number,
  at: { col: number; row: number },
  box: CellBox,
  id: number
): string {
  const payload = deflateSync(rgba).toString('base64')
  // q=1 keeps the OK quiet and lets an error through: an unaccepted placement is otherwise
  // indistinguishable from one that drew.
  const first = `a=T,q=1,f=32,o=z,i=${id},s=${width},v=${height},c=${box.cols},r=${box.rows}`
  // DECSC/DECRC around it: the image lands at the cursor, and the frame's own cursor has to
  // survive the move. The protocol's own C=1 would do it, but a terminal that does not know
  // the key rejects the whole placement.
  let out = `${ESC}7${ESC}[${at.row};${at.col}H`
  for (let i = 0; i < payload.length; i += CHUNK) {
    const more = i + CHUNK < payload.length ? 1 : 0
    const head = i === 0 ? `${first},m=${more}` : `m=${more}`
    out += `${ESC}_G${head};${payload.slice(i, i + CHUNK)}${ESC}\\`
  }
  return `${out}${ESC}8`
}

// `ESC _ G i=<id>;<message> ESC \` — the terminal's verdict on a placement.
export function placementError(sequence: string, id: number): string | null {
  if (!sequence.startsWith(`${ESC}_G`)) {
    return null
  }
  const end = sequence.indexOf(`${ESC}\\`)
  const body = end === -1 ? sequence.slice(3) : sequence.slice(3, end)
  const [keys = '', message = ''] = body.split(';')
  if (!keys.split(',').includes(`i=${id}`)) {
    return null
  }
  return message === 'OK' || message === '' ? null : message
}

export function encodeDelete(id: number): string {
  return `${ESC}_Ga=d,d=i,i=${id},q=2${ESC}\\`
}

export function encodeDeleteAll(): string {
  return `${ESC}_Ga=d,d=A,q=2${ESC}\\`
}

let claimed = false

// A killed druk leaves its placement on the screen: the terminal owns it, not the process.
export function claimScreen(write: (text: string) => void): void {
  if (claimed) {
    return
  }
  claimed = true
  write(encodeDeleteAll())
  process.on('exit', () => write(encodeDeleteAll()))
}
