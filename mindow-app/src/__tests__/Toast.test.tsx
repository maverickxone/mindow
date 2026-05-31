import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { ToastContainer, showToast } from "../components/Toast";

describe("ToastContainer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a toast with the correct message", () => {
    render(<ToastContainer />);
    act(() => {
      showToast("success", "Operation completed");
    });
    expect(screen.getByText("Operation completed")).toBeInTheDocument();
  });

  it("displays status icon for each toast type", () => {
    render(<ToastContainer />);
    act(() => {
      showToast("success", "Success msg");
    });
    const alert = screen.getByRole("alert");
    const svg = alert.querySelector("svg[aria-hidden='true']");
    expect(svg).toBeInTheDocument();
  });

  it("shows close button when dismissible", () => {
    render(<ToastContainer />);
    act(() => {
      showToast("info", "Closable toast");
    });
    expect(screen.getByLabelText("Close notification")).toBeInTheDocument();
  });

  it("limits visible toasts to maximum of 3", () => {
    render(<ToastContainer />);
    act(() => {
      showToast("success", "Toast 1");
      showToast("success", "Toast 2");
      showToast("error", "Toast 3");
      showToast("warning", "Toast 4");
      showToast("info", "Toast 5");
    });
    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBe(3);
  });

  it("promotes queued toasts when a visible toast is removed", () => {
    render(<ToastContainer />);
    act(() => {
      showToast("success", "Toast 1");
      showToast("success", "Toast 2");
      showToast("success", "Toast 3");
      showToast("info", "Queued Toast");
    });

    // Only 3 visible
    expect(screen.getAllByRole("alert").length).toBe(3);
    expect(screen.queryByText("Queued Toast")).not.toBeInTheDocument();

    // Click close on the first toast
    const closeButtons = screen.getAllByLabelText("Close notification");
    act(() => {
      fireEvent.click(closeButtons[0]);
    });

    // Advance past the exit animation timeout (300ms)
    act(() => {
      vi.advanceTimersByTime(350);
    });

    // The queued toast should now be promoted
    expect(screen.getByText("Queued Toast")).toBeInTheDocument();
  });

  it("starts fade-out animation after auto-dismiss duration", () => {
    render(<ToastContainer />);
    act(() => {
      showToast("success", "Auto dismiss");
    });
    expect(screen.getByText("Auto dismiss")).toBeInTheDocument();

    // Advance past the default 4000ms duration
    act(() => {
      vi.advanceTimersByTime(4100);
    });

    // The toast should now be in exiting state (fade-out animation)
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("animate-fade-out");
  });

  it("removes toast from DOM after fade-out completes", () => {
    render(<ToastContainer />);
    act(() => {
      showToast("success", "Fading out");
    });

    // Trigger exit via duration timeout
    act(() => {
      vi.advanceTimersByTime(4100);
    });

    // Wait for exit animation timeout (300ms)
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(screen.queryByText("Fading out")).not.toBeInTheDocument();
  });

  it("applies correct color classes per type", () => {
    render(<ToastContainer />);
    act(() => {
      showToast("success", "success-msg");
      showToast("error", "error-msg");
    });

    const successAlert = screen
      .getByText("success-msg")
      .closest("[role='alert']");
    const errorAlert = screen
      .getByText("error-msg")
      .closest("[role='alert']");

    expect(successAlert?.className).toContain("bg-state-success");
    expect(errorAlert?.className).toContain("bg-state-danger");
  });

  it("uses slide-in animation on entrance", () => {
    render(<ToastContainer />);
    act(() => {
      showToast("info", "Sliding in");
    });
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("animate-slide-in");
  });

  it("uses fade-out animation on exit", () => {
    render(<ToastContainer />);
    act(() => {
      showToast("info", "Fading");
    });

    // Click close button
    const closeBtn = screen.getByLabelText("Close notification");
    act(() => {
      fireEvent.click(closeBtn);
    });

    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("animate-fade-out");
  });
});
