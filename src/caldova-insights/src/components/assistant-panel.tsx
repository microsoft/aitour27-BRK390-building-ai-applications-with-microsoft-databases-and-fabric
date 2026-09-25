import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, MessageSquarePlus } from "lucide-react";
import { getRayfinClient } from "@/lib/rayfin-client";
import { AssistantMarkdown } from "./assistant-markdown";
import { ErrorState, Panel, PanelHeader } from "./panel";

interface ChatMessage {
    id: number;
    role: "assistant" | "user";
    content: string;
    at: string;
}

/** Portfolio-level starters — deliberately not tied to any single product. */
const SUGGESTED_PROMPTS = [
    "Which products are furthest from plan?",
    "How are campaigns performing against spend?",
    "Which regions are driving the variance?",
];

const INTRO: ChatMessage = {
    id: 0,
    role: "assistant",
    content:
        "Ask about portfolio performance, regional trends, or campaign efficiency. Answers are grounded in the connected Caldova model.",
    at: "",
};

function timestamp(): string {
    return new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
    });
}

export function AssistantPanel() {
    const [question, setQuestion] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>([INTRO]);
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const scrollRef = useRef<HTMLDivElement>(null);

    // Starters are an empty-state affordance, so they retire once the
    // conversation has begun and return with a new chat.
    const hasAsked = messages.some((message) => message.role === "user");

    useEffect(() => {
        const container = scrollRef.current;
        if (!container) return;
        // Assigning scrollTop (rather than calling scrollTo) keeps this working in
        // jsdom, which does not implement the scrollTo method.
        container.scrollTop = container.scrollHeight;
    }, [messages, isSending]);

    async function ask(rawQuestion: string) {
        const trimmed = rawQuestion.trim();
        if (!trimmed || isSending) return;

        setQuestion("");
        setError(undefined);
        setMessages((current) => [
            ...current,
            { id: Date.now(), role: "user", content: trimmed, at: timestamp() },
        ]);
        setIsSending(true);

        try {
            const response = await getRayfinClient().functions.askCaldovaAnalyst.invoke(
                { question: trimmed },
                { timeoutMs: 240_000 },
            );
            setMessages((current) => [
                ...current,
                {
                    id: Date.now() + 1,
                    role: "assistant",
                    content: response.answer,
                    at: timestamp(),
                },
            ]);
        } catch (requestError) {
            setError(
                requestError instanceof Error
                    ? requestError.message
                    : "The assistant could not answer that question.",
            );
        } finally {
            setIsSending(false);
        }
    }

    function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        void ask(question);
    }

    return (
        <Panel className="h-assistant">
            <PanelHeader
                title="Analyst assistant"
                action={
                    <button
                        type="button"
                        disabled={isSending}
                        onClick={() => {
                            setMessages([INTRO]);
                            setQuestion("");
                            setError(undefined);
                        }}
                        className="flex items-center gap-100 rounded-md border border-border px-200 py-100 text-200 text-muted-foreground transition hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <MessageSquarePlus className="icon-size-100" aria-hidden="true" />
                        New chat
                    </button>
                }
            />

            <div
                ref={scrollRef}
                className="scroll-slim min-h-0 flex-1 space-y-400 overflow-y-auto px-500 py-400"
                aria-live="polite"
            >
                {messages.map((message) => (
                    <div key={message.id} className="animate-fade-rise">
                        <div className="mb-100 flex items-baseline gap-200">
                            <span className="font-monospace text-200 uppercase tracking-[0.1em] text-muted-foreground">
                                {message.role === "user" ? "You" : "Assistant"}
                            </span>
                            {message.at ? (
                                <span className="text-200 text-muted-foreground/70">
                                    {message.at}
                                </span>
                            ) : null}
                        </div>
                        {message.role === "assistant" ? (
                            <AssistantMarkdown content={message.content} />
                        ) : (
                            <p className="rounded-lg bg-muted px-300 py-200 text-300 leading-400 text-card-foreground">
                                {message.content}
                            </p>
                        )}
                    </div>
                ))}

                {isSending ? (
                    <div className="flex items-center gap-200 text-200 text-muted-foreground">
                        <span className="flex items-center gap-100" aria-hidden="true">
                            <span className="thinking-dot" />
                            <span className="thinking-dot" />
                            <span className="thinking-dot" />
                        </span>
                        Analysing the Caldova model — this can take a moment
                    </div>
                ) : null}

                {error ? <ErrorState message={error} /> : null}
            </div>

            <div className="border-t border-border px-500 py-400">
                {hasAsked ? null : (
                    <div className="mb-300 flex flex-wrap gap-200">
                        {SUGGESTED_PROMPTS.map((prompt) => (
                            <button
                                key={prompt}
                                type="button"
                                disabled={isSending}
                                onClick={() => void ask(prompt)}
                                className="rounded-full border border-border px-300 py-100 text-200 text-muted-foreground transition hover:border-ring hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                            >
                                {prompt}
                            </button>
                        ))}
                    </div>
                )}

                <form className="flex items-center gap-200" onSubmit={onSubmit}>
                    <label className="sr-only" htmlFor="assistant-question">
                        Ask the analyst assistant
                    </label>
                    <input
                        id="assistant-question"
                        value={question}
                        onChange={(event) => setQuestion(event.target.value)}
                        placeholder="Ask about the portfolio…"
                        disabled={isSending}
                        className="min-w-0 flex-1 rounded-lg border border-input bg-background px-300 py-200 text-300 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
                    />
                    <button
                        type="submit"
                        disabled={isSending || !question.trim()}
                        aria-label="Send question"
                        className="flex h-800 w-800 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <ArrowUp className="icon-size-200" aria-hidden="true" />
                    </button>
                </form>
            </div>
        </Panel>
    );
}
