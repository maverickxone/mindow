/**
 * Property test for Markdown rendering structural correctness.
 * Feature: mindow-ui-overhaul, Property 10: Markdown rendering structural correctness
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { render } from "@testing-library/react";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";

// Safe text generator: alphanumeric words separated by single spaces.
// This avoids markdown-special characters (* _ ` [ ] \ # | etc.) that would
// otherwise make structural assertions flaky on random input.
const safeText = fc
  .array(
    fc.stringMatching(/^[a-zA-Z0-9]{1,8}$/),
    { minLength: 1, maxLength: 4 }
  )
  .map((words) => words.join(" "))
  .filter((s) => s.trim().length > 0);

describe("Property 10: Markdown rendering structural correctness", () => {
  it("headings produce corresponding h1-h6 elements", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), safeText, (level, text) => {
        const md = `${"#".repeat(level)} ${text}`;
        const { container, unmount } = render(<MarkdownRenderer content={md} />);
        expect(container.querySelector(`h${level}`)).not.toBeNull();
        unmount();
      }),
      { numRuns: 30 }
    );
  });

  it("bold text produces <strong> elements", () => {
    fc.assert(
      fc.property(safeText, (text) => {
        const md = `**${text}**`;
        const { container, unmount } = render(<MarkdownRenderer content={md} />);
        expect(container.querySelector("strong")).not.toBeNull();
        unmount();
      }),
      { numRuns: 30 }
    );
  });

  it("unordered lists produce <ul> elements", () => {
    fc.assert(
      fc.property(fc.array(safeText, { minLength: 1, maxLength: 5 }), (items) => {
        const md = items.map((item) => `- ${item}`).join("\n");
        const { container, unmount } = render(<MarkdownRenderer content={md} />);
        expect(container.querySelector("ul")).not.toBeNull();
        unmount();
      }),
      { numRuns: 30 }
    );
  });

  it("code blocks produce <pre><code> elements", () => {
    fc.assert(
      fc.property(safeText, (code) => {
        const md = "```\n" + code + "\n```";
        const { container, unmount } = render(<MarkdownRenderer content={md} />);
        expect(container.querySelector("pre")).not.toBeNull();
        expect(container.querySelector("code")).not.toBeNull();
        unmount();
      }),
      { numRuns: 30 }
    );
  });

  it("tables produce <table> elements", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-zA-Z0-9]{1,8}$/), { minLength: 2, maxLength: 4 }),
        (headers) => {
          const headerRow = `| ${headers.join(" | ")} |`;
          const separator = `| ${headers.map(() => "---").join(" | ")} |`;
          const dataRow = `| ${headers.map((_, i) => `val${i}`).join(" | ")} |`;
          const md = `${headerRow}\n${separator}\n${dataRow}`;
          const { container, unmount } = render(<MarkdownRenderer content={md} />);
          expect(container.querySelector("table")).not.toBeNull();
          unmount();
        }
      ),
      { numRuns: 30 }
    );
  });
});
