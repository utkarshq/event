import { ProviderService } from "../services/provider.service";
import { saveEvent, getAllEvents, deleteEvent } from "../db";
import { getOllamaModels } from "../utils/ollama";
import { ModelService } from "../services/model.service";
import type { ExtractionRequest, ProviderConfig } from "../providers/base.provider";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
    "Access-Control-Allow-Headers": "Content-Type",
};

export async function handleApiRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const isPoll = url.pathname.includes("/logs") || url.pathname.includes("/status");
    if (!isPoll) console.log(`[API] ${req.method} ${url.pathname}`);

    const respond = (data: any, init?: ResponseInit) => {
        const response = Response.json(data, { ...init, headers: { ...corsHeaders, ...init?.headers } });
        if (!isPoll) console.log(`[RES] ${url.pathname} -> ${response.status}`);
        return response;
    };

    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (url.pathname === "/api/health" && req.method === "POST") {
        try {
            const config = (await req.json()) as any;
            const isHealthy = await ProviderService.checkHealth(config);
            return respond({ status: isHealthy ? "online" : "offline" });
        } catch {
            return respond({ status: "offline" });
        }
    }

    // Version
    if (url.pathname === "/api/version" && req.method === "GET") {
        return respond({ version: "1.0.0" });
    }

    // Paddle Status
    if (url.pathname === "/api/paddle/status" && req.method === "GET") {
        return respond(ModelService.getStatus());
    }

    // Paddle Install (Non-blocking)
    if (url.pathname === "/api/paddle/install" && req.method === "POST") {
        try {
            const body = (await req.json()) as any;
            const tier = body.tier || "eco";
            ModelService.install(tier as any).catch(console.error);
            return respond({ status: "installation_started", tier });
        } catch (e: any) {
            return respond({ error: e.message }, { status: 400 });
        }
    }

    // Paddle: Set Active Tier
    if (url.pathname === "/api/paddle/tier" && req.method === "POST") {
        try {
            const body = (await req.json()) as any;
            ModelService.setActiveTier(body.tier);
            return respond({ status: "updated", tier: body.tier });
        } catch (e: any) {
            return respond({ error: e.message }, { status: 500 });
        }
    }

    // List models
    if (url.pathname === "/api/models" && req.method === "GET") {
        const host = url.searchParams.get("host") || "http://localhost:11434";
        const models = await getOllamaModels(host);
        return respond(models);
    }

    // DB: List saved events
    if (url.pathname === "/api/events" && req.method === "GET") {
        return respond(getAllEvents());
    }

    // DB: Delete event
    // Match /api/events/:id
    const deleteMatch = url.pathname.match(/^\/api\/events\/([a-zA-Z0-9-]+)$/);
    if (deleteMatch && req.method === "DELETE") {
        const id = deleteMatch[1];
        if (!id) return respond({ error: "Invalid ID" }, { status: 400 });

        try {
            const deleted = deleteEvent(id);
            if (deleted) {
                return respond({ status: "deleted", id });
            } else {
                return respond({ error: "Event not found" }, { status: 404 });
            }
        } catch (error: any) {
            return respond({ error: "Delete failed", message: error.message }, { status: 500 });
        }
    }

    // Paddle Logs
    if (url.pathname === "/api/paddle/logs" && req.method === "GET") {
        return respond({ logs: ModelService.getLogs() });
    }

    // DB: Save event
    if (url.pathname === "/api/save" && req.method === "POST") {
        try {
            saveEvent(await req.json());
            return respond({ status: "saved" });
        } catch (error: any) {
            return respond({ error: "Save failed", message: error.message }, { status: 500 });
        }
    }

    // File upload (Legacy support)
    if (url.pathname === "/api/upload" && req.method === "POST") {
        try {
            const formData = await req.formData();
            const file = formData.get("file") as File;
            if (!file) {
                console.log("[UPLOAD] No file in form data");
                return respond({ error: "No file uploaded" }, { status: 400 });
            }
            // Basic validation
            if (file.size > 10 * 1024 * 1024) { // 10MB limit
                return respond({ error: "File too large (max 10MB)" }, { status: 400 });
            }
            const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
            if (!allowedTypes.includes(file.type)) {
                return respond({ error: "Invalid file type" }, { status: 400 });
            }

            console.log(`[UPLOAD] Received: ${file.name} (${file.size} bytes)`);
            return respond({ text: "" });
        } catch (e: any) {
            console.log(`[UPLOAD] Error: ${e.message}`);
            return respond({ error: e.message }, { status: 500 });
        }
    }

    // Extraction: Stream
    if (url.pathname === "/api/parse-sync" && req.method === "POST") {
        try {
            const body = (await req.json()) as any;
            console.log(`[DEBUG] /api/parse-sync payload: strategy=${body.strategy}, model=${body.model}, base64len=${body.base64_image ? body.base64_image.length : 0}`);

            const config: ProviderConfig = {
                baseUrl: body.provider_url || "http://localhost:11434",
                apiKey: body.api_key,
                model: body.model || "gemini-2.0-flash"
            };

            const strategy = body.strategy || "A"; // Default to Strategy A (Full LLM)

            const stream = await ProviderService.orchestrateExtraction(strategy, config, body as ExtractionRequest);

            return new Response(stream, {
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/x-ndjson",
                    "Cache-Control": "no-cache"
                }
            });
        } catch (error: any) {
            console.log(`[EXTRACT] Error: ${error.message}`);
            return respond({ error: "Extraction failed", message: error.message }, { status: 500 });
        }
    }

    console.log(`[API] 404 Not Found: ${url.pathname}`);
    return new Response("Not Found", { status: 404, headers: corsHeaders });
}
