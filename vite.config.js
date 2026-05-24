var _a;
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            "/api": {
                target: (_a = process.env.VITE_RECOGNIZER_PROXY_TARGET) !== null && _a !== void 0 ? _a : "http://localhost:8787",
                changeOrigin: true,
            },
        },
    },
    worker: {
        format: "es",
    },
});
