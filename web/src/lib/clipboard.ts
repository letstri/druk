export function copyText(text: string): Promise<void> {
  const legacy = () => {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(legacy)
  }
  legacy()
  return Promise.resolve()
}
