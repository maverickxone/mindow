import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BaselineTag } from "../components/BaselineTag";

/**
 * BaselineTag 颜色编码逻辑测试
 * Validates: Requirements 6.4
 */
describe("BaselineTag", () => {
  it("deviation 为 null 时不渲染任何内容", () => {
    const { container } = render(<BaselineTag deviation={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("deviation < 1.5 时不渲染标记", () => {
    const { container } = render(<BaselineTag deviation={1.0} />);
    expect(container.firstChild).toBeNull();
  });

  it("deviation = 0 时不渲染标记", () => {
    const { container } = render(<BaselineTag deviation={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("deviation >= 1.5 且 < 3.0 时渲染黄色标记", () => {
    render(<BaselineTag deviation={2.0} />);
    const tag = screen.getByText("⬆ 高于平时 2.0 倍");
    expect(tag).toBeInTheDocument();
    expect(tag).toHaveStyle({ color: "var(--accent-warning)" });
  });

  it("deviation = 1.5 时渲染黄色标记（边界值）", () => {
    render(<BaselineTag deviation={1.5} />);
    const tag = screen.getByText("⬆ 高于平时 1.5 倍");
    expect(tag).toBeInTheDocument();
    expect(tag).toHaveStyle({ color: "var(--accent-warning)" });
  });

  it("deviation >= 3.0 时渲染红色标记", () => {
    render(<BaselineTag deviation={3.5} />);
    const tag = screen.getByText("⬆ 高于平时 3.5 倍");
    expect(tag).toBeInTheDocument();
    expect(tag).toHaveStyle({ color: "var(--accent-danger)" });
  });

  it("deviation = 3.0 时渲染红色标记（边界值）", () => {
    render(<BaselineTag deviation={3.0} />);
    const tag = screen.getByText("⬆ 高于平时 3.0 倍");
    expect(tag).toBeInTheDocument();
    expect(tag).toHaveStyle({ color: "var(--accent-danger)" });
  });
});
