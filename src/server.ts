/**
 * Vision Event Engine - Main Server
 * 
 * This is the entry point for the Vision Event Engine application.
 * It starts both the HTTP server and the PaddleOCR bridge process.
 * 
 * @module server
 */

import { handleApiRequest } from "./api/routes";
import { ModelService } from "./services/model.service";

/** Server port - can be overridden via PORT environment variable */
const PORT = process.env.PORT || 3000;

/** Whether to serve static files from public/ directory */
const SERVE_STATIC = process.env.SERVE_STATIC !== "false";

/**
 * Bun HTTP Server Configuration
 * 
 * Handles both API requests (/api/*) and static file serving.
 * Uses a generous idle timeout for long-running OCR operations.
 */
const server = Bun.serve({
    port: PORT,
    idleTimeout: 255, // Extended timeout for OCR processing

    async fetch(req) {
        const url = new URL(req.url);

        // Route API requests to the API handler
        if (url.pathname.startsWith("/api/")) {
            return handleApiRequest(req);
        }

        // Serve static files (optional, can be disabled for headless mode)
        if (SERVE_STATIC) {
            const urlPath = url.pathname;

            // Serve index.html for root path
            if (urlPath === "/" || urlPath === "/index.html") {
                return new Response(Bun.file("public/index.html"), {
                    headers: { "Content-Type": "text/html" }
                });
            }

            // Serve other static assets
            if (urlPath.includes(".")) {
                const file = Bun.file(`public${urlPath}`);
                if (await file.exists()) return new Response(file);
            }
        }

        return new Response("Not Found", { status: 404 });
    },
});

console.log(`🚀 Vision Event Engine running at http://localhost:${server.port}`);
console.log(`📡 Static file serving: ${SERVE_STATIC ? "enabled" : "disabled"}`);

// Initialize the OCR bridge on startup
ModelService.start("eco").catch(console.error);
