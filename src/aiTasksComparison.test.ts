import { describe, expect, it } from 'bun:test'
import {
  compareSections,
  findLatestComparisonSource,
  formatComparisonReport,
  getComparisonExtractionSystemPrompt,
  getComparisonValidationSystemPrompt,
  parseComparisonSectionsToolArgs,
} from './aiTasksComparison'

describe('findLatestComparisonSource', () => {
  it('prefers the most recent substantial pasted user message over follow-up questions', () => {
    const history = [
      { role: 'user', content: 'short question' },
      {
        role: 'user',
        content: `Streaks and Todo

Todo Group > pressing x optimistically removes the item from cell even though confirm is not done - this is not correct - seems to happen only in Table view

---

Cooking Buddy

Dish gets leftover even if there are no more memories under it - also are we deleting embedding when we delete the memories? please check`,
      },
      { role: 'assistant', content: 'I added the tasks.' },
      {
        role: 'user',
        content: 'check if added tasks and my given tasks match exactly',
      },
    ]

    expect(findLatestComparisonSource(history)).toContain(
      'Todo Group > pressing x optimistically',
    )
  })
})

describe('parseComparisonSectionsToolArgs', () => {
  it('accepts a valid tool-call payload with exact task text', () => {
    const sections = parseComparisonSectionsToolArgs(
      JSON.stringify({
        sections: [
          {
            projectName: 'Streaks and Todo',
            tasks: [
              'Todo Group > pressing x optimistically removes the item from cell even though confirm is not done - this is not correct - seems to happen only in Table view',
            ],
          },
          {
            projectName: 'Cooking Buddy',
            tasks: [
              "Ability to rename a dish through chatting\n - sub question: can family members rename a dish or only owner? only owner is not good\n - actually we don't even have a way to rename a dish - the real question is, is the dish name used by the chat system in any way or is it just reliant on memories?",
            ],
          },
        ],
      }),
    )

    expect(sections).toEqual([
      {
        projectName: 'Streaks and Todo',
        tasks: [
          'Todo Group > pressing x optimistically removes the item from cell even though confirm is not done - this is not correct - seems to happen only in Table view',
        ],
      },
      {
        projectName: 'Cooking Buddy',
        tasks: [
          "Ability to rename a dish through chatting\n - sub question: can family members rename a dish or only owner? only owner is not good\n - actually we don't even have a way to rename a dish - the real question is, is the dish name used by the chat system in any way or is it just reliant on memories?",
        ],
      },
    ])
  })

  it('rejects an invalid tool-call payload', () => {
    expect(
      parseComparisonSectionsToolArgs(
        JSON.stringify({ sections: [{ projectName: 'X', tasks: 'bad' }] }),
      ),
    ).toBeNull()
  })
})

describe('comparison extraction prompts', () => {
  it('tells the model to keep continuation and example lines inside the same task', () => {
    expect(getComparisonExtractionSystemPrompt()).toContain(
      'lines immediately following a task that ends with a colon belong to that same task',
    )
    expect(getComparisonValidationSystemPrompt()).toContain(
      'continuation lines, examples, indented lines, config snippets',
    )
  })
})

describe('compareSections', () => {
  it('reports a mismatch when a task differs by trailing characters', () => {
    const expected = [
      {
        projectName: 'Cooking Buddy',
        tasks: [
          'Dish gets leftover even if there are no more memories under it - also are we deleting embedding when we delete the memories? please check',
        ],
      },
    ]
    const actual = [
      {
        projectName: 'Cooking Buddy',
        tasks: [
          'Dish gets leftover even if there are no more memories under it - also are we deleting embedding when we delete the memories? please check21111',
        ],
      },
    ]

    const result = compareSections(expected, actual)

    expect(result.exactMatch).toBe(false)
    expect(result.mismatches[0]?.expected).toContain('please check')
    expect(result.mismatches[0]?.actual).toContain('please check21111')
  })
})

describe('formatComparisonReport', () => {
  it('shows before, after, and the specific difference for mismatched task text', () => {
    const report = formatComparisonReport({
      exactMatch: false,
      mismatches: [
        {
          projectName: 'Cooking Buddy',
          taskIndex: 0,
          expected:
            'Dish gets leftover even if there are no more memories under it - also are we deleting embedding when we delete the memories? please check',
          actual:
            'Dish gets leftover even if there are no more memories under it - also are we deleting embedding when we delete the memories? please check21111',
        },
      ],
    })

    expect(report).toContain('Before (your pasted text):')
    expect(report).toContain('After (current database):')
    expect(report).toContain(
      'The database version has extra trailing text: `21111`.',
    )
  })
})
