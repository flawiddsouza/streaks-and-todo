export function formatTaskWithExtraInfo(
  taskName: string,
  extraInfo?: string,
): { text: string } {
  const TOKENS = ['$x']
  if (!extraInfo) return { text: taskName }

  let text = taskName
  let used = false
  for (const t of TOKENS) {
    if (text.includes(t)) {
      text = text.split(t).join(extraInfo)
      used = true
    }
  }

  if (!used && extraInfo.trim().length > 0) {
    text += ` (${extraInfo})`
  }

  return { text }
}
