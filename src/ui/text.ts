export function cut(text: string, room: number): string {
  if (room <= 0) return ''
  return text.length > room ? `${text.slice(0, room - 1)}…` : text
}

export function wrapText(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = ''
    }
    if (word.length > width) {
      if (line) lines.push(line)
      for (let at = 0; at < word.length; at += width) lines.push(word.slice(at, at + width))
      line = ''
      continue
    }
    line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines.length > 0 ? lines : ['']
}
