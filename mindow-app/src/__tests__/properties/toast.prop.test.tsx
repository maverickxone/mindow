/**
 * Property test for Toast visibility limit.
 * Feature: mindow-ui-overhaul, Property 9: Toast visibility limit
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import * as fc from "fast-check";
import { ToastContainer, showToast } from "../../components/Toast";

describe("Property 9: Toast visibility limit", () => {
  // Ensure DOM + component listeners are torn down between each render so the
  // module-level toast state does not leak across property iterations.
  afterEach(() => {
    cleanup();
  });

  it("at most 3 toasts are visible simultaneously for any N > 3 triggers", () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 20 }), (n) => {
        const { unmount } = render(<ToastContainer />);
        act(() => {
          for (let i = 0; i < n; i++) {
            showToast("success", `Toast ${i}`);
          }
        });

        const alerts = screen.queryAllByRole("alert");
        expect(alerts.length).toBeLessThanOrEqual(3);

        unmount();
      }),
      { numRuns: 30 }
    );
  });

  it("exactly 3 toasts visible when more than 3 are triggered simultaneously", () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 15 }), (n) => {
        const { unmount } = render(<ToastContainer />);
        act(() => {
          for (let i = 0; i < n; i++) {
            showToast("info", `Msg ${i}`);
          }
        });

        const alerts = screen.queryAllByRole("alert");
        expect(alerts.length).toBe(3);

        unmount();
      }),
      { numRuns: 30 }
    );
  });
});
