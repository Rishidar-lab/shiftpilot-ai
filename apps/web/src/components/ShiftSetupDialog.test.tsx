/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { ShiftSetupDialog, type ShiftSetupValues } from "./ShiftSetupDialog.js"

afterEach(cleanup)

function noop() {}

it("renders nothing when closed", () => {
  const { container } = render(
    <ShiftSetupDialog open={false} creating={false} error={null} onSubmit={noop} onClose={noop} />,
  )
  expect(container.firstChild).toBeNull()
})

it("is a labelled modal dialog", () => {
  render(<ShiftSetupDialog open creating={false} error={null} onSubmit={noop} onClose={noop} />)
  const dialog = screen.getByRole("dialog")
  expect(dialog.getAttribute("aria-modal")).toBe("true")
  expect(dialog.getAttribute("aria-labelledby")).toBeTruthy()
})

it("refuses a shift that ends before it starts, without calling onSubmit", async () => {
  const onSubmit = vi.fn()
  render(<ShiftSetupDialog open creating={false} error={null} onSubmit={onSubmit} onClose={noop} />)
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="time"]')
  await userEvent.clear(inputs[0]!)
  await userEvent.type(inputs[0]!, "18:00")
  await userEvent.clear(inputs[1]!)
  await userEvent.type(inputs[1]!, "09:00")
  await userEvent.click(screen.getByRole("button", { name: "Start shift" }))
  expect(onSubmit).not.toHaveBeenCalled()
  const alert = await screen.findByRole("alert")
  expect(alert.textContent).toContain("end after it starts")
})

it("submits the collected values for a valid shift", async () => {
  const onSubmit = vi.fn()
  render(<ShiftSetupDialog open creating={false} error={null} onSubmit={onSubmit} onClose={noop} />)
  await userEvent.click(screen.getByRole("button", { name: "Start shift" }))
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  const values = onSubmit.mock.calls[0]![0] as ShiftSetupValues
  expect(values.start).toBe("09:00")
  expect(values.end).toBe("17:00")
  expect(values.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
})

it("closes on Escape", async () => {
  const onClose = vi.fn()
  render(<ShiftSetupDialog open creating={false} error={null} onSubmit={noop} onClose={onClose} />)
  await userEvent.keyboard("{Escape}")
  expect(onClose).toHaveBeenCalled()
})

it("surfaces a server error passed in", () => {
  render(
    <ShiftSetupDialog
      open
      creating={false}
      error="Could not create the shift"
      onSubmit={noop}
      onClose={noop}
    />,
  )
  expect(screen.getByRole("alert").textContent).toContain("Could not create the shift")
})
