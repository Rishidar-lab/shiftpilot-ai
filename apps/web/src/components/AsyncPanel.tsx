import type { ReactNode } from "react"

import type { AsyncState } from "../use-async.js"

/**
 * One place that renders the loading / error / retry states of an async read,
 * so no view can accidentally render a failure as blank space (audit A-24).
 * `aria-busy` and `role="alert"` make the state change audible to assistive
 * technology, not just visible.
 */
export function AsyncPanel<T>({
  state,
  label,
  onRetry,
  render,
}: {
  state: AsyncState<T>
  /** Human name of the thing being loaded, e.g. "plan". */
  label: string
  onRetry: () => void
  render: (data: T) => ReactNode
}) {
  if (state.status === "loading") {
    return (
      <p className="meta" role="status" aria-busy="true" style={{ marginTop: 8 }}>
        Loading {label}…
      </p>
    )
  }

  if (state.status === "error") {
    return (
      <div className="banner banner-error" role="alert">
        <strong>Could not load the {label}.</strong> {state.message}
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={onRetry}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  return <>{render(state.data)}</>
}
