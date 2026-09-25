import { resolve } from "path";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const projectRoot = import.meta.dirname;

/**
 * Layout-preview config. Renders the real dashboard against fixtures by aliasing
 * the Fabric-backed query hook and the Rayfin client, neither of which can run
 * outside the Fabric portal embed.
 */
export default defineConfig({
    root: resolve(projectRoot, "preview"),
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: [
            {
                find: /^@\/hooks\/use-semantic-model-query$/,
                replacement: resolve(projectRoot, "preview/mock-semantic-model-query.ts"),
            },
            {
                find: /^@\/lib\/rayfin-client$/,
                replacement: resolve(projectRoot, "preview/mock-rayfin-client.ts"),
            },
            { find: "@", replacement: resolve(projectRoot, "src") },
        ],
    },
});
