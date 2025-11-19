import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        testTimeout: 10000, // 10 seconds timeout for tests
        hookTimeout: 10000, // 10 seconds timeout for hooks
        coverage: {
            provider: "v8",
            reporter: ["text", "json", "html"],
            exclude: [
                "node_modules/**",
                "dist/**",
                "**/*.config.ts",
                "**/*.d.ts",
            ],
        },
    },
});
