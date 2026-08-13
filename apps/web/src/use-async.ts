import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Every async read is one of four EXPLICIT states. There is deliberately no
 * "empty success" state that renders nothing: a failed request that draws
 * blank space is indistinguishable from "there is nothing to show", which is
 * how a broken planning panel stayed invisible (audit A-24).
 */
export type AsyncState<T> =
  { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T }

export interface AsyncResult<T> {
  state: AsyncState<T>
  /** Re-runs the request; also the retry action offered on the error surface. */
  reload: () => void
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  // Keep the latest callback without making it a dependency: callers pass an
  // inline closure, which would otherwise re-fetch on every render.
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let active = true
    setState({ status: "loading" })
    fnRef
      .current()
      .then((data) => {
        if (active) setState({ status: "ready", data })
      })
      .catch((error: unknown) => {
        if (!active) return
        const message = error instanceof Error ? error.message : "Unexpected error"
        setState({ status: "error", message })
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  return { state, reload }
}
