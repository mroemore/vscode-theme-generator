'use client'

import { useEffect, useState } from 'react'

/** Matches Tailwind's `md` breakpoint: below 768px is the mobile shell, at and above is the
 *  desktop layout. Reads `false` until the first effect runs, so the server-rendered HTML and
 *  the first client render agree and hydration never mismatches. */
const QUERY = '(max-width: 767px)'

export function useIsMobile(): boolean | null {
  const [isMobile, setIsMobile] = useState<boolean | null>(null)

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return isMobile
}
