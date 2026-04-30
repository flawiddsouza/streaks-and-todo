// ui/src/hooks/useIsMobile.test.tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import useIsMobile from './useIsMobile'

function MobileProbe() {
  const isMobile = useIsMobile()
  return <span data-mobile={isMobile ? 'yes' : 'no'} />
}

function mockMatchMedia(matches: boolean) {
  const mql = {
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    media: '(max-width: 900px)',
    onchange: null,
    dispatchEvent: vi.fn(),
  }
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql))
  return mql
}

describe('useIsMobile', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns true when matchMedia matches the mobile breakpoint', () => {
    mockMatchMedia(true)
    const html = renderToStaticMarkup(<MobileProbe />)
    expect(html).toContain('data-mobile="yes"')
  })

  it('returns false when matchMedia does not match', () => {
    mockMatchMedia(false)
    const html = renderToStaticMarkup(<MobileProbe />)
    expect(html).toContain('data-mobile="no"')
  })
})
