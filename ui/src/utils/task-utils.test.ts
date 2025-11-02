import { describe, expect, it } from 'vitest'
import { parseTaskWithExtraInfo } from '../utils/task-utils'

describe('parseTaskWithExtraInfo', () => {
  it('returns trimmed task when no outer parentheses are present', () => {
    const result = parseTaskWithExtraInfo('read the docs ')

    expect(result).toEqual({ task: 'read the docs' })
  })

  it('extracts outer extra info when only a single pair of parentheses exists', () => {
    const result = parseTaskWithExtraInfo('continue working on $x (restfox) ')

    expect(result).toEqual({
      task: 'continue working on $x',
      extraInfo: 'restfox',
    })
  })

  it('parses extra info when nested parentheses appear multiple times', () => {
    const result = parseTaskWithExtraInfo(
      'continue working on $x (appstra (19 commits))',
    )

    expect(result).toEqual({
      task: 'continue working on $x',
      extraInfo: 'appstra (19 commits)',
    })
  })

  it('recovers extra info when closing parenthesis is missing', () => {
    const result = parseTaskWithExtraInfo('check build status (staging')

    expect(result).toEqual({
      task: 'check build status',
      extraInfo: 'staging',
    })
  })

  it('strips trailing parentheses without content', () => {
    const result = parseTaskWithExtraInfo('sync with design ()')

    expect(result).toEqual({ task: 'sync with design' })
  })
})
