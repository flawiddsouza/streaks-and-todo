type ComparisonSection = {
  projectName: string
  tasks: string[]
}

type ComparisonMismatch = {
  projectName: string
  taskIndex: number
  expected: string | null
  actual: string | null
}

type ComparisonResult = {
  exactMatch: boolean
  mismatches: ComparisonMismatch[]
}

const COMPARISON_EXTRACTION_RULES = [
  'You extract structured project and task data from arbitrary pasted user text.',
  'Return the result only through the provided tool call.',
  'Preserve task text exactly. Do not rewrite, summarize, normalize, or split inline content unless the text clearly indicates separate tasks.',
  'A project heading is typically followed by one or more task paragraphs until the next project heading or separator.',
  'Indented lines, bullet-like follow-ups, config examples, code examples, URLs on following lines, and lines immediately following a task that ends with a colon belong to that same task unless there is a clear new task boundary.',
  'Blank lines can separate tasks, but blank lines inside a multiline task are allowed if the text still clearly belongs together.',
  'Do not invent projects or tasks.',
] as const

export function getComparisonExtractionSystemPrompt(): string {
  return COMPARISON_EXTRACTION_RULES.join(' ')
}

export function getComparisonValidationSystemPrompt(): string {
  return [
    'You validate extracted project and task data against the original pasted text.',
    'Return the corrected result only through the provided tool call.',
    'Do not rewrite task text.',
    'Fix cases where continuation lines, examples, indented lines, config snippets, or lines after a trailing colon were incorrectly split into separate tasks.',
    'Keep project names and task text exactly as they appear in the original pasted text.',
  ].join(' ')
}

export function parseComparisonSectionsToolArgs(
  raw: string,
): ComparisonSection[] | null {
  try {
    const parsed = JSON.parse(raw) as { sections?: unknown }
    if (!parsed || !Array.isArray(parsed.sections)) return null

    const sections = parsed.sections.map((section) => {
      if (!section || typeof section !== 'object') return null
      const projectName =
        'projectName' in section ? section.projectName : undefined
      const tasks = 'tasks' in section ? section.tasks : undefined
      if (typeof projectName !== 'string' || !Array.isArray(tasks)) return null
      if (!tasks.every((task) => typeof task === 'string')) return null

      return {
        projectName: projectName.trim(),
        tasks: tasks.map((task) => task.trim()).filter(Boolean),
      }
    })

    if (sections.some((section) => section == null)) return null

    const normalized = sections
      .filter((section): section is ComparisonSection => !!section)
      .filter(
        (section) => section.projectName !== '' && section.tasks.length > 0,
      )

    return normalized.length > 0 ? normalized : null
  } catch {
    return null
  }
}

function toInlineSnippet(value: string): string {
  const normalized = value.replace(/\n/g, '\\n')
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized
}

function toCodeBlock(value: string | null): string {
  if (value == null) return '```text\n[missing]\n```'
  return `\`\`\`text\n${value.replace(/```/g, '``\\`')}\n\`\`\``
}

function describeTextDifference(
  expected: string | null,
  actual: string | null,
): string {
  if (expected == null && actual == null) return 'No difference.'
  if (expected == null)
    return 'This item exists in the database but not in your pasted text.'
  if (actual == null) return 'This item is missing from the database.'

  let prefix = 0
  while (
    prefix < expected.length &&
    prefix < actual.length &&
    expected[prefix] === actual[prefix]
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < expected.length - prefix &&
    suffix < actual.length - prefix &&
    expected[expected.length - 1 - suffix] ===
      actual[actual.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const expectedChanged = expected.slice(prefix, expected.length - suffix)
  const actualChanged = actual.slice(prefix, actual.length - suffix)

  if (!expectedChanged && actualChanged) {
    if (prefix === expected.length) {
      return `The database version has extra trailing text: \`${toInlineSnippet(actualChanged)}\`.`
    }
    return `The database version has extra inserted text: \`${toInlineSnippet(actualChanged)}\`.`
  }

  if (expectedChanged && !actualChanged) {
    if (prefix === actual.length) {
      return `The database version is missing trailing text: \`${toInlineSnippet(expectedChanged)}\`.`
    }
    return `The database version is missing text that appears in your pasted version: \`${toInlineSnippet(expectedChanged)}\`.`
  }

  return `Changed segment before: \`${toInlineSnippet(expectedChanged)}\`; after: \`${toInlineSnippet(actualChanged)}\`.`
}

export function formatComparisonReport(result: ComparisonResult): string {
  if (result.exactMatch) {
    return 'I compared the latest pasted text against the current workspace tasks and found no differences.'
  }

  const lines = [
    `The comparison found ${result.mismatches.length} mismatch${result.mismatches.length === 1 ? '' : 'es'}.`,
    '',
  ]

  for (const mismatch of result.mismatches) {
    lines.push(`Project: ${mismatch.projectName}`)
    lines.push(
      `Task position: ${mismatch.taskIndex >= 0 ? mismatch.taskIndex + 1 : 'project-level mismatch'}`,
    )
    lines.push('Before (your pasted text):')
    lines.push(toCodeBlock(mismatch.expected))
    lines.push('After (current database):')
    lines.push(toCodeBlock(mismatch.actual))
    lines.push('What changed:')
    lines.push(
      `- ${describeTextDifference(mismatch.expected, mismatch.actual)}`,
    )
    lines.push('')
  }

  return lines.join('\n').trim()
}

export function findLatestComparisonSource(
  history: Array<{ role: string; content: string }>,
): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]
    if (entry.role !== 'user') continue
    const content = entry.content?.trim() ?? ''
    if (!content) continue
    if (content.length < 80) continue
    if (!content.includes('\n')) continue
    return content
  }
  return null
}

export function compareSections(
  expected: ComparisonSection[],
  actual: ComparisonSection[],
): ComparisonResult {
  const mismatches: ComparisonMismatch[] = []

  for (const expectedSection of expected) {
    const actualSection = actual.find(
      (section) => section.projectName === expectedSection.projectName,
    )
    if (!actualSection) {
      mismatches.push({
        projectName: expectedSection.projectName,
        taskIndex: -1,
        expected: `[missing project] ${expectedSection.projectName}`,
        actual: null,
      })
      continue
    }

    const max = Math.max(
      expectedSection.tasks.length,
      actualSection.tasks.length,
    )
    for (let index = 0; index < max; index += 1) {
      const expectedTask = expectedSection.tasks[index] ?? null
      const actualTask = actualSection.tasks[index] ?? null
      if (expectedTask !== actualTask) {
        mismatches.push({
          projectName: expectedSection.projectName,
          taskIndex: index,
          expected: expectedTask,
          actual: actualTask,
        })
      }
    }
  }

  for (const actualSection of actual) {
    const expectedSection = expected.find(
      (section) => section.projectName === actualSection.projectName,
    )
    if (!expectedSection) {
      mismatches.push({
        projectName: actualSection.projectName,
        taskIndex: -1,
        expected: null,
        actual: `[unexpected project] ${actualSection.projectName}`,
      })
    }
  }

  return {
    exactMatch: mismatches.length === 0,
    mismatches,
  }
}
