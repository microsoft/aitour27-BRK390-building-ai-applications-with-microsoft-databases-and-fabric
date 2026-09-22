import type { ReactNode } from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface PanelProps {
    children: ReactNode;
    className?: string;
}

export function Panel({ children, className }: PanelProps) {
    return (
        <section
            className={cn(
                "flex flex-col overflow-hidden rounded-xl border border-border bg-card",
                className,
            )}
        >
            {children}
        </section>
    );
}

interface PanelHeaderProps {
    title: string;
    detail?: string;
    action?: ReactNode;
}

export function PanelHeader({ title, detail, action }: PanelHeaderProps) {
    return (
        <div className="flex items-start justify-between gap-400 border-b border-border px-500 py-400">
            <div className="min-w-0">
                <h2 className="font-heading text-400 font-semibold tracking-[-0.01em] text-card-foreground">
                    {title}
                </h2>
                {detail ? (
                    <p className="mt-100 text-200 leading-300 text-muted-foreground">
                        {detail}
                    </p>
                ) : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
        </div>
    );
}

interface StatCardProps {
    label: string;
    value: string;
    caption?: string;
    tone?: "default" | "positive" | "negative";
}

export function StatCard({ label, value, caption, tone = "default" }: StatCardProps) {
    return (
        <article className="rounded-xl border border-border bg-card px-400 py-300">
            <p className="font-monospace text-200 uppercase tracking-[0.1em] text-muted-foreground">
                {label}
            </p>
            <p
                className={cn(
                    "tabular mt-200 font-heading text-hero-700 font-semibold tracking-[-0.02em]",
                    tone === "default" && "text-card-foreground",
                    tone === "positive" && "text-success",
                    tone === "negative" && "text-destructive",
                )}
            >
                {value}
            </p>
            {caption ? (
                <p className="mt-100 text-200 text-muted-foreground">{caption}</p>
            ) : null}
        </article>
    );
}

/**
 * Signed variance shown with a consistent sign and colour so a reader can scan a
 * column and spot an outlier without reading every number.
 */
export function VarianceValue({
    value,
    threshold = 0.5,
}: {
    value: number | undefined;
    threshold?: number;
}) {
    if (value == null || !Number.isFinite(value)) {
        return <span className="text-muted-foreground">—</span>;
    }

    const isMaterial = Math.abs(value) >= threshold;
    return (
        <span
            className={cn(
                "tabular font-medium",
                !isMaterial && "text-muted-foreground",
                isMaterial && value > 0 && "text-success",
                isMaterial && value < 0 && "text-destructive",
            )}
        >
            {value > 0 ? "+" : ""}
            {value.toFixed(2)}%
        </span>
    );
}

export function StatusBadge({ label, tone }: { label: string; tone: "positive" | "negative" | "neutral" }) {
    return (
        <span
            className={cn(
                "inline-flex items-center rounded-full px-200 py-100-nudge text-200 font-medium",
                tone === "positive" && "bg-success/12 text-success",
                tone === "negative" && "bg-destructive/12 text-destructive",
                tone === "neutral" && "bg-muted text-muted-foreground",
            )}
        >
            {label}
        </span>
    );
}

export function LoadingState({ label }: { label: string }) {
    return (
        <div className="flex h-full min-h-40 items-center justify-center gap-200 p-500 text-200 text-muted-foreground">
            <LoaderCircle className="icon-size-200 animate-spin" aria-hidden="true" />
            <span>{label}</span>
        </div>
    );
}

export function EmptyState({ label }: { label: string }) {
    return (
        <div className="flex h-full min-h-40 items-center justify-center p-500 text-center text-200 text-muted-foreground">
            {label}
        </div>
    );
}

export function ErrorState({ message }: { message: string }) {
    return (
        <div className="m-400 flex items-start gap-300 rounded-lg border border-destructive/30 bg-destructive/8 p-300 text-200 leading-300 text-destructive">
            <CircleAlert className="mt-100-nudge icon-size-200 shrink-0" aria-hidden="true" />
            <span className="break-words">{message}</span>
        </div>
    );
}
