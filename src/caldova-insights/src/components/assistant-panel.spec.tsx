//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AssistantPanel } from "@/components/assistant-panel";

const invoke = vi.fn();

vi.mock("@/lib/rayfin-client", () => ({
    getRayfinClient: () => ({
        functions: { askCaldovaAnalyst: { invoke } },
    }),
}));

const FIRST_PROMPT = "Which products are furthest from plan?";

describe("AssistantPanel", () => {
    beforeEach(() => {
        invoke.mockReset();
        invoke.mockResolvedValue({ answer: "Hydration Sunscreen is +11.34% against plan." });
    });

    it("offers starter prompts before anything has been asked", () => {
        render(<AssistantPanel />);
        expect(screen.getByRole("button", { name: FIRST_PROMPT })).toBeInTheDocument();
    });

    it("retires the starter prompts once a question has been asked", async () => {
        render(<AssistantPanel />);

        fireEvent.click(screen.getByRole("button", { name: FIRST_PROMPT }));

        await waitFor(() =>
            expect(screen.queryByRole("button", { name: FIRST_PROMPT })).not.toBeInTheDocument(),
        );
    });

    it("restores the starter prompts when a new chat is started", async () => {
        render(<AssistantPanel />);

        fireEvent.click(screen.getByRole("button", { name: FIRST_PROMPT }));
        await waitFor(() =>
            expect(screen.queryByRole("button", { name: FIRST_PROMPT })).not.toBeInTheDocument(),
        );
        await waitFor(() =>
            expect(screen.getByRole("button", { name: /new chat/i })).toBeEnabled(),
        );

        fireEvent.click(screen.getByRole("button", { name: /new chat/i }));

        expect(screen.getByRole("button", { name: FIRST_PROMPT })).toBeInTheDocument();
    });

    it("reports progress while the agent is answering", async () => {
        let release: (value: { answer: string }) => void = () => {};
        invoke.mockReturnValue(
            new Promise<{ answer: string }>((resolve) => {
                release = resolve;
            }),
        );

        render(<AssistantPanel />);
        fireEvent.click(screen.getByRole("button", { name: FIRST_PROMPT }));

        expect(await screen.findByText(/analysing the caldova model/i)).toBeInTheDocument();

        await act(async () => {
            release({ answer: "Done." });
        });

        await waitFor(() =>
            expect(screen.queryByText(/analysing the caldova model/i)).not.toBeInTheDocument(),
        );
    });

    it("keeps a new chat from adopting an in-flight answer", async () => {
        invoke.mockReturnValue(new Promise<{ answer: string }>(() => {}));

        render(<AssistantPanel />);
        fireEvent.click(screen.getByRole("button", { name: FIRST_PROMPT }));

        expect(await screen.findByText(/analysing the caldova model/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /new chat/i })).toBeDisabled();
    });
});
