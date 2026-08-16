/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LandingView } from "./LandingView.js"

afterEach(cleanup)

describe("LandingView", () => {
  it("tells the story: messy work in, explainable plan out", () => {
    render(<LandingView onOpen={() => {}} />)

    expect(
      screen.getByRole("heading", { name: "Turn messy work into an explainable plan." }),
    ).toBeDefined()
  })

  it("states the one rule: the AI never decides alone", () => {
    render(<LandingView onOpen={() => {}} />)
    expect(screen.getByText(/the AI never decides alone/)).toBeDefined()
  })

  it("opens the workspace from the hero CTA", async () => {
    const onOpen = vi.fn()
    render(<LandingView onOpen={onOpen} />)
    await userEvent.click(screen.getAllByRole("button", { name: "Open ShiftPilot" })[0]!)
    expect(onOpen).toHaveBeenCalled()
  })
})
