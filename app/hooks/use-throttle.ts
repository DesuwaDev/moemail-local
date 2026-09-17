import { useCallback, useRef } from 'react'

export function useThrottle<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  const lastRun = useRef<number | null>(null)
  return useCallback((...args: Parameters<T>) => {
    const now = Date.now()
    if (lastRun.current === null || now - lastRun.current >= delay) {
      lastRun.current = now
      fn(...args)
    }
  }, [fn, delay]) as T
}
