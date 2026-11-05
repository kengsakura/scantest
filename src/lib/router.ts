import { useSyncExternalStore } from 'react'

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

/** Current hash route split into segments: "#/exams/abc/key" -> ["exams", "abc", "key"] */
export function useRoute(): string[] {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean)
}

export function go(path: string) {
  window.location.hash = path.startsWith('/') ? path : `/${path}`
}
