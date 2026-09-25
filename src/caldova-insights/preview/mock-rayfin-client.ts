/** Preview-only Rayfin client stub so the assistant panel can render offline. */
export function getRayfinClient() {
    return {
        functions: {
            askCaldovaAnalyst: {
                invoke: async () => {
                    // The real agent takes 30-60s. A short delay here keeps the
                    // thinking state observable while iterating on the layout.
                    await new Promise((resolve) => setTimeout(resolve, 2_500));
                    return {
                        answer: [
                            "**Hydration Sunscreen** is the only product materially away from plan.",
                            "",
                            "| Product | Vs plan |",
                            "| --- | --- |",
                            "| Hydration Sunscreen | +11.34% |",
                            "| Hydration Sunscreen Kids | +0.03% |",
                            "",
                            "Regional concentration:",
                            "",
                            "- Coastal +6.89%",
                            "- Southern +6.18%",
                            "- Northern and Central are flat, acting as controls.",
                        ].join("\n"),
                    };
                },
            },
        },
    };
}
