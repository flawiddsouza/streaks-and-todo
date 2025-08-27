export function formatTaskWithExtraInfo(
  taskName: string,
  extraInfo?: string,
): { text: string; usedSubstitution: boolean } {
  const TOKENS = ['$x']
  if (!extraInfo) return { text: taskName, usedSubstitution: false }

  let text = taskName
  let used = false
  for (const t of TOKENS) {
    if (text.includes(t)) {
      text = text.split(t).join(extraInfo)
      used = true
    }
  }
  return { text, usedSubstitution: used }
}
