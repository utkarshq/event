import { parseEventStream, checkProviderHealth, getOllamaModels, type ProviderConfig } from "./provider";
import { saveEvent, getAllEvents } from "./db";

interface ParseRequest {
    ocr_text: string;
    image_context?: string;
    today_date?: string;
    model?: string;
    base64_image?: string;
    options?: Record<string, unknown>;
    provider_url?: string;
    api_key?: string;
}

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
    "Access-Control-Allow-Headers": "Content-Type",
};

const server = Bun.serve({
    port: 3000,
    idleTimeout: 255,
    async fetch(req) {
        if (req.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(req.url);

        // Health check
        if (url.pathname === "/api/health" && req.method === "POST") {
            try {
                const config = (await req.json()) as ProviderConfig;
                const isHealthy = await checkProviderHealth(config);
                return Response.json({ status: isHealthy ? "online" : "offline" }, { headers: corsHeaders });
            } catch {
                return Response.json({ status: "offline" }, { headers: corsHeaders });
            }
        }

        // Static files
        if (req.method === "GET") {
            const urlPath = url.pathname;
            if (urlPath === "/" || urlPath === "/index.html") {
                return new Response(Bun.file("public/index.html"), { headers: { "Content-Type": "text/html" } });
            }
            if (urlPath.includes(".")) {
                const file = Bun.file(`public${urlPath}`);
                if (await file.exists()) return new Response(file);
            }
        }

        // Get available models
        if (url.pathname === "/api/models" && req.method === "GET") {
            const host = url.searchParams.get("host") || "http://localhost:11434";
            const models = await getOllamaModels(host);
            return Response.json(models, { headers: corsHeaders });
        }

        // File upload (returns empty, vision API handles extraction)
        if (url.pathname === "/api/upload" && req.method === "POST") {
            try {
                const formData = await req.formData();
                const file = formData.get("file") as File;
                if (!file) return Response.json({ error: "No file uploaded" }, { status: 400, headers: corsHeaders });
                return Response.json({ text: "" }, { headers: corsHeaders });
            } catch (e: unknown) {
                return Response.json({ error: (e as Error).message }, { status: 500, headers: corsHeaders });
            }
        }

        // List saved events
        if (url.pathname === "/api/events" && req.method === "GET") {
            return Response.json(getAllEvents(), { headers: corsHeaders });
        }

        // Save event
        if (url.pathname === "/api/save" && req.method === "POST") {
            try {
                saveEvent(await req.json());
                return Response.json({ status: "saved" }, { headers: corsHeaders });
            } catch (error: unknown) {
                return Response.json({ error: "Save failed", message: (error as Error).message }, { status: 500, headers: corsHeaders });
            }
        }

        // Vision extraction (streaming)
        if (url.pathname === "/api/parse-sync" && req.method === "POST") {
            try {
                const body = (await req.json()) as ParseRequest;
                if (!body.ocr_text && !body.base64_image) {
                    return Response.json({ error: "Missing content (text or image)" }, { status: 400, headers: corsHeaders });
                }

                const config: ProviderConfig = {
                    baseUrl: body.provider_url || "http://localhost:11434",
                    apiKey: body.api_key,
                    model: body.model || "gemini-2.0-flash"
                };

                const stream = new ReadableStream({
                    async start(controller) {
                        const encoder = new TextEncoder();
                        const decoder = new TextDecoder();
                        let accumulatedContent = "";
                        let totalBytesReceived = 0;

                        const log = (tag: string, msg: string) => {
                            controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag, message: msg, timestamp: Date.now() }) + "\n"));
                        };

                        try {
                            const isGemini = config.baseUrl.includes("generativelanguage.googleapis.com");
                            const isOllama = !isGemini && (config.baseUrl.includes(":11434") || config.baseUrl.includes("/api"));
                            const providerType = isGemini ? "GEMINI" : isOllama ? "OLLAMA" : "OPENAI";

                            log("EXEC", `[INIT] Provider: ${providerType} | Model: ${config.model}`);
                            log("EXEC", `[HTTP] POST ${config.baseUrl}`);
                            log("EXEC", `[PAYLOAD] image=${body.base64_image ? `${Math.round(body.base64_image.length / 1024)}KB` : "none"} | text=${body.ocr_text?.length || 0} chars`);

                            const startTime = Date.now();
                            const response = await parseEventStream(body.ocr_text || "", body.image_context, body.today_date, config, body.base64_image, body.options || {});

                            if (response.curlCommand) {
                                controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "CURL", message: response.curlCommand, timestamp: Date.now() }) + "\n"));
                            }

                            const latency = Date.now() - startTime;
                            log("EXEC", `[RESPONSE] Status: ${response.status} ${response.statusText} | Latency: ${latency}ms`);

                            if (!response.ok) {
                                const errText = await response.text();
                                log("EXEC", `[ERROR] ${errText.slice(0, 500)}`);
                                throw new Error(`Provider returned ${response.status}: ${errText}`);
                            }
                            if (!response.body) throw new Error("No response body from provider");

                            log("EXEC", `[STREAM] Reading response body...`);
                            const reader = response.body.getReader();
                            let lineBuffer = "";
                            let chunkCount = 0;

                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;

                                chunkCount++;
                                totalBytesReceived += value?.length || 0;

                                lineBuffer += decoder.decode(value, { stream: true });
                                const lines = lineBuffer.split("\n");
                                lineBuffer = lines.pop() || "";

                                for (const line of lines) {
                                    if (!line.trim()) continue;
                                    let token = "";
                                    try {
                                        if (isGemini && line.startsWith("data: ")) {
                                            const json = JSON.parse(line.replace("data: ", "").trim());
                                            token = json.candidates?.[0]?.content?.parts?.[0]?.text || "";
                                        } else if (isOllama) {
                                            token = JSON.parse(line).message?.content || "";
                                        } else if (line.startsWith("data: ")) {
                                            const dataStr = line.replace("data: ", "").trim();
                                            if (dataStr !== "[DONE]") {
                                                token = JSON.parse(dataStr).choices?.[0]?.delta?.content || "";
                                            }
                                        }
                                    } catch { continue; }

                                    if (token) {
                                        accumulatedContent += token;
                                        controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "SYNTH", message: token, timestamp: Date.now() }) + "\n"));
                                    }
                                }
                            }

                            log("EXEC", `[COMPLETE] Received ${chunkCount} chunks | ${totalBytesReceived} bytes | ${accumulatedContent.length} chars decoded`);

                            const jsonMatch = accumulatedContent.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
                            const finalJson = JSON.parse(jsonMatch ? jsonMatch[0] : accumulatedContent);

                            log("EXEC", `[SAVE] Writing to database...`);
                            saveEvent(finalJson);
                            log("EXEC", `[DONE] Extraction complete`);

                            controller.enqueue(encoder.encode(JSON.stringify({ type: "final", event: finalJson }) + "\n"));
                            controller.close();
                        } catch (error: unknown) {
                            const err = error as Error & { curlCommand?: string };
                            if (err.curlCommand) {
                                controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "INSIGHT", message: err.curlCommand, timestamp: Date.now() }) + "\n"));
                            }
                            controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message: err.message }) + "\n"));
                            controller.close();
                        }
                    }
                });

                return new Response(stream, {
                    headers: { ...corsHeaders, "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" }
                });
            } catch (error: unknown) {
                return Response.json({ error: "Stream setup failed", message: (error as Error).message }, { status: 500, headers: corsHeaders });
            }
        }

        return new Response("Not Found", { status: 404, headers: corsHeaders });
    },
});

console.log(`🚀 Vision Event Engine running at http://localhost:${server.port}`);
