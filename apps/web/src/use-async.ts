import { useEffect, useState } from "react"

export type AsyncState<T> =
  { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T }

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" })

  useEffect(() => {
    let active = true
    fn()
      .then((data) => {
        if (active) setState({ status: "ready", data })
      })
      .catch((error: unknown) => {
        if (active) {
          const message = error instanceof Error ? error.message : "Unexpected error"
          setState({ status: "error", message })
        }
      })
    return () => {
      active = false
    }
  }, deps)

  return state
}
