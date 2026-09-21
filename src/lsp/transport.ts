import type { RpcMessage } from './protocol'

export function encodeMessage(message: object): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf-8')
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'),
    body,
  ])
}

// `Content-Length` is bytes, not characters: slice the Buffer, never a string.
export function createDecoder(
  onMessage: (message: RpcMessage) => void
): (chunk: Buffer) => void {
  let buffered: Buffer = Buffer.alloc(0)
  // body bytes owed; -1 while reading headers
  let expected = -1

  return (chunk) => {
    buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk])
    for (;;) {
      if (expected < 0) {
        const end = buffered.indexOf('\r\n\r\n')
        if (end === -1) {
          return
        }
        const headers = buffered.subarray(0, end).toString('ascii')
        buffered = buffered.subarray(end + 4)
        const match = /content-length:\s*(\d+)/iu.exec(headers)
        if (!match) {
          continue
        }
        expected = Number(match[1])
      }
      if (buffered.length < expected) {
        return
      }
      const body = buffered.subarray(0, expected)
      buffered = buffered.subarray(expected)
      expected = -1
      try {
        onMessage(JSON.parse(body.toString('utf-8')) as RpcMessage)
      } catch {
        // a server's malformed frame is dropped, not fatal
      }
    }
  }
}
