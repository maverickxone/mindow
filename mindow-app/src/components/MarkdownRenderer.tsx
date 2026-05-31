import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * MarkdownRenderer — renders markdown content with design-token styling.
 *
 * Uses react-markdown + remark-gfm to support headings, bold, lists,
 * tables, code blocks, and inline code. All styles use the project's
 * design tokens for consistency.
 *
 * Adds `user-select: text` so content is selectable (overriding
 * the global `user-select: none`).
 */
export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={`markdown-renderer select-text ${className ?? ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-[var(--text-xl)] font-semibold mt-3 mb-1 text-text-primary">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-[var(--text-lg)] font-semibold mt-3 mb-1 text-text-primary">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-[var(--text-md)] font-semibold mt-2 mb-1 text-text-primary">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-[var(--text-base)] font-semibold mt-2 mb-1 text-text-primary">
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 className="text-[var(--text-sm)] font-semibold mt-2 mb-0.5 text-text-primary">
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 className="text-[var(--text-xs)] font-semibold mt-2 mb-0.5 text-text-secondary">
      {children}
    </h6>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ href, children }) => (
    <a href={href} className="text-accent hover:underline" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="list-disc pl-5 my-1 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-1 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="text-text-primary">{children}</li>,
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="w-full border-collapse border border-border text-xs">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface-2">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-border even:bg-surface-1">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-2 py-1 text-left font-semibold text-text-primary border border-border">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-2 py-1 text-text-primary border border-border">{children}</td>
  ),
  pre: ({ children }) => (
    <pre className="bg-surface-2 rounded-[var(--radius-sm)] p-3 my-2 overflow-x-auto text-xs">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    // If code has a language className, it's inside a <pre> (block code)
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return (
        <code className={`font-mono text-text-primary ${className ?? ""}`}>
          {children}
        </code>
      );
    }
    // Inline code
    return (
      <code className="bg-surface-2 rounded-[var(--radius-sm)] px-1 py-0.5 font-mono text-[0.9em] text-text-primary">
        {children}
      </code>
    );
  },
  p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-accent pl-3 my-2 text-text-secondary italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border my-3" />,
};
