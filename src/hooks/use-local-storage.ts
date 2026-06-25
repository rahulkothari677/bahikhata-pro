'use client'

import { useEffect, useState, useCallback } from 'react'

// SSR-safe localStorage hook
// Returns [value, setValue] where value is the default during SSR,
// then loads from localStorage after mount
export function useLocalStorage<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(defaultValue)
  const [loaded, setLoaded] = useState(false)

  // Load from localStorage after mount (client-side only)
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const stored = localStorage.getItem(key)
        if (stored !== null) {
          setValue(JSON.parse(stored) as T)
        }
      } catch (e) {
        // localStorage might not be available
      }
      setLoaded(true)
    })
  }, [key])

  // Save to localStorage whenever value changes (after initial load)
  const updateValue = useCallback((newValue: T) => {
    setValue(newValue)
    try {
      localStorage.setItem(key, JSON.stringify(newValue))
    } catch (e) {
      // localStorage might not be available
    }
  }, [key])

  return [loaded ? value : defaultValue, updateValue]
}
