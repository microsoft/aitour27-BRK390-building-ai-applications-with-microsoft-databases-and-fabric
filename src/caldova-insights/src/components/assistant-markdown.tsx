import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders assistant replies as markdown. The agent answers with headings, bold
 * emphasis, lists and tables, all of which arrive as literal markup unless they
 * are parsed, so the raw text is never shown directly.
 */
export function AssistantMarkdown({ content }: { content: string }) {
    return (
        <div className="space-y-200 text-300 leading-400 text-card-foreground">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    p: ({ children }: { children?: ReactNode }) => (
                        <p className="text-300 leading-400">{children}</p>
                    ),
                    strong: ({ children }: { children?: ReactNode }) => (
                        <strong className="font-semibold text-card-foreground">
                            {children}
                        </strong>
                    ),
                    em: ({ children }: { children?: ReactNode }) => (
                        <em className="italic">{children}</em>
                    ),
                    ul: ({ children }: { children?: ReactNode }) => (
                        <ul className="ml-400 list-disc space-y-100">{children}</ul>
                    ),
                    ol: ({ children }: { children?: ReactNode }) => (
                        <ol className="ml-400 list-decimal space-y-100">{children}</ol>
                    ),
                    li: ({ children }: { children?: ReactNode }) => (
                        <li className="text-300 leading-400">{children}</li>
                    ),
                    h1: ({ children }: { children?: ReactNode }) => (
                        <h3 className="font-heading text-400 font-semibold">{children}</h3>
                    ),
                    h2: ({ children }: { children?: ReactNode }) => (
                        <h3 className="font-heading text-400 font-semibold">{children}</h3>
                    ),
                    h3: ({ children }: { children?: ReactNode }) => (
                        <h4 className="font-heading text-300 font-semibold">{children}</h4>
                    ),
                    code: ({ children }: ComponentPropsWithoutRef<"code">) => (
                        <code className="rounded bg-muted px-100 py-100-nudge font-monospace text-200">
                            {children}
                        </code>
                    ),
                    pre: ({ children }: { children?: ReactNode }) => (
                        <pre className="scroll-slim overflow-x-auto rounded-lg bg-muted p-300 font-monospace text-200">
                            {children}
                        </pre>
                    ),
                    table: ({ children }: { children?: ReactNode }) => (
                        <div className="scroll-slim overflow-x-auto">
                            <table className="w-full border-collapse text-200">{children}</table>
                        </div>
                    ),
                    thead: ({ children }: { children?: ReactNode }) => (
                        <thead className="border-b border-border">{children}</thead>
                    ),
                    th: ({ children }: { children?: ReactNode }) => (
                        <th className="px-200 py-100 text-left font-semibold text-card-foreground">
                            {children}
                        </th>
                    ),
                    td: ({ children }: { children?: ReactNode }) => (
                        <td className="tabular border-b border-border px-200 py-100 align-top">
                            {children}
                        </td>
                    ),
                    a: ({ children, href }: ComponentPropsWithoutRef<"a">) => (
                        <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="text-brand underline underline-offset-2"
                        >
                            {children}
                        </a>
                    ),
                    blockquote: ({ children }: { children?: ReactNode }) => (
                        <blockquote className="border-l-2 border-border pl-300 text-muted-foreground">
                            {children}
                        </blockquote>
                    ),
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}
