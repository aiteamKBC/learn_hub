import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'

/** Warn before leaving a form with unsaved edits: the browser's own prompt for reloads
 * and closing the tab, and a confirm for in-app navigation. */
export function useUnsavedChanges(dirty: boolean, message = 'You have unsaved changes. Leave without saving?') {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm(message)) blocker.proceed()
    else blocker.reset()
  }, [blocker, message])

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
}
