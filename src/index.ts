import { parseEvent, parseEventStream, checkProviderHealth, getOllamaModels, type ProviderConfig } from "./provider";
import { saveEvent, getAllEvents } from "./db";
import { extractTextFromPdf, extractTextFromImage } from "./ocr";
import { join } from "path";

interface ParseRequest {
    ocr_text: string;
    image_context?: string;
    today_date?: string;
    model?: string;
    base64_image?: string;
    options?: any;
    provider_url?: string;
    api_key?: string;
}

const server = Bun.serve({
    port: 3000,
    idleTimeout: 255,
    async fetch(req) {
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
            "Access-Control-Allow-Headers": "Content-Type",
        };

        if (req.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(req.url);

        // API: Universal Health Check (v13.0)
        if (url.pathname === "/api/health" && req.method === "POST") {
            try {
                const config = (await req.json()) as ProviderConfig;
                const isHealthy = await checkProviderHealth(config);
                return Response.json({ status: isHealthy ? "online" : "offline" }, { headers: corsHeaders });
            } catch (e) {
                return Response.json({ status: "offline" }, { headers: corsHeaders });
            }
        }

        // Serve Static Files
        if (req.method === "GET") {
            const urlPath = new URL(req.url).pathname;

            // Default to index.html for root
            if (urlPath === "/" || urlPath === "/index.html") {
                const filePath = join(process.cwd(), "public/index.html");
                return new Response(Bun.file(filePath), { headers: { "Content-Type": "text/html" } });
            }

            // Serve other static files from public/
            if (urlPath.includes(".")) {
                const filePath = join(process.cwd(), "public", urlPath);
                const file = Bun.file(filePath);
                if (await file.exists()) {
                    return new Response(file);
                }
            }
        }

        if (url.pathname === "/api/models" && req.method === "GET") {
            const host = url.searchParams.get("host") || "http://host.docker.internal:11434";
            const models = await getOllamaModels(host);
            return Response.json(models, { headers: corsHeaders });
        }

        // API: File Upload & Extract
        if (url.pathname === "/api/upload" && req.method === "POST") {
            try {
                const formData = await req.formData();
                const file = formData.get("file") as File;
                if (!file) return Response.json({ error: "No file uploaded" }, { status: 400, headers: corsHeaders });

                // V14 Change: We skip local OCR to avoid container bloat.
                // The Vision API will handle the text extraction and understanding.
                return Response.json({ text: "" }, { headers: corsHeaders });
            } catch (e: any) {
                return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
            }
        }

        // API: List Events
        if (url.pathname === "/api/events" && req.method === "GET") {
            const events = getAllEvents();
            return Response.json(events, { headers: corsHeaders });
        }

        // API: Save Finalized Event
        if (url.pathname === "/api/save" && req.method === "POST") {
            try {
                const body = await req.json();
                saveEvent(body);
                return Response.json({ status: "saved" }, { headers: corsHeaders });
            } catch (error: any) {
                return Response.json({ error: "Save failed", message: error.message }, { status: 500, headers: corsHeaders });
            }
        }

        // API: Universal Parse Pulse (ND-JSON Stream v14.0)
        if (url.pathname === "/api/parse-sync" && req.method === "POST") {
            try {
                const body = (await req.json()) as ParseRequest;
                // V14 Change: Allow missing ocr_text if image is present
                if (!body.ocr_text && !body.base64_image) {
                    return Response.json({ error: "Missing content (text or image)" }, { status: 400, headers: corsHeaders });
                }

                const config: ProviderConfig = {
                    baseUrl: body.provider_url || "http://host.docker.internal:11434",
                    apiKey: body.api_key,
                    model: body.model || "qwen3-vl:2b"
                };

                const stream = new ReadableStream({
                    async start(controller) {
                        const encoder = new TextEncoder();
                        const decoder = new TextDecoder();
                        let accumulatedContent = "";

                        try {
                            controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "NET", message: "Connecting to Provider Stream...", timestamp: Date.now() }) + "\n"));

                            const response = await parseEventStream(body.ocr_text, body.image_context, body.today_date, config, body.base64_image, body.options);

                            // Extract CURL (Runtime Injection)
                            const curlMsg = (response as any).curlCommand;
                            if (curlMsg) {
                                controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "INSIGHT", message: curlMsg, timestamp: Date.now() }) + "\n"));
                            }

                            if (!response.ok) {
                                const errText = await response.text();
                                throw new Error(`Provider returned ${response.status}: ${errText}`);
                            }
                            if (!response.body) throw new Error("No response body from provider");

                            const reader = response.body.getReader();
                            const isGemini = config.baseUrl.includes("generativelanguage.googleapis.com");
                            const isOllama = !isGemini && (config.baseUrl.includes(":11434") || config.baseUrl.includes("/api"));

                            let lineBuffer = "";

                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;

                                lineBuffer += decoder.decode(value, { stream: true });
                                const lines = lineBuffer.split("\n");
                                lineBuffer = lines.pop() || ""; // Keep the last partial line in the buffer

                                for (const line of lines) {
                                    if (!line.trim()) continue;

                                    let token = "";
                                    try {
                                        if (isGemini) {
                                            if (line.startsWith("data: ")) {
                                                const dataStr = line.replace("data: ", "").trim();
                                                const json = JSON.parse(dataStr);
                                                token = json.candidates?.[0]?.content?.parts?.[0]?.text || "";
                                            }
                                        } else if (isOllama) {
                                            const json = JSON.parse(line);
                                            token = json.message?.content || "";
                                        } else if (line.startsWith("data: ")) {
                                            const dataStr = line.replace("data: ", "").trim();
                                            if (dataStr === "[DONE]") continue;
                                            const json = JSON.parse(dataStr);
                                            token = json.choices?.[0]?.delta?.content || "";
                                        }
                                    } catch (e) {
                                        // Ignore parsing errors for non-JSON lines or malformed chunks
                                        continue;
                                    }

                                    if (token) {
                                        accumulatedContent += token;
                                        controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "SYNTH", message: token, timestamp: Date.now() }) + "\n"));
                                    }
                                }
                            }

                            // Final Synthesis
                            try {
                                const jsonMatch = accumulatedContent.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
                                const finalJson = JSON.parse(jsonMatch ? jsonMatch[0] : accumulatedContent);
                                saveEvent(finalJson);
                                controller.enqueue(encoder.encode(JSON.stringify({ type: "final", event: finalJson }) + "\n"));
                            } catch (e) {
                                throw new Error("Failed to parse final synthesis from tokens.");
                            }

                            controller.close();
                        } catch (error: any) {
                            if (error.curlCommand) {
                                controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "INSIGHT", message: error.curlCommand, timestamp: Date.now() }) + "\n"));
                            }
                            controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message: error.message }) + "\n"));
                            controller.close();
                        }
                    }
                });

                return new Response(stream, {
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/x-ndjson",
                        "Cache-Control": "no-cache"
                    }
                });
            } catch (error: any) {
                return Response.json({ error: "Stream setup failed", message: error.message }, { status: 500, headers: corsHeaders });
            }
        }

        return new Response("Not Found", { status: 404, headers: corsHeaders });
    },
});

console.log("-----------------------------------------");
console.log("EVENT ENGINE v13.9 | VISION RELAY CORE");
console.log("-----------------------------------------");
console.log(`🚀 Core running at http://localhost:${server.port}`);
