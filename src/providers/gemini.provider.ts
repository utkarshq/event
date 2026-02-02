import { BaseProvider, type ExtractionRequest, type ProviderConfig } from "./base.provider";
import { SYSTEM_PROMPT } from "../prompt";
import { saveEvent } from "../db";

export class GeminiProvider extends BaseProvider {
    name = "Gemini";

    async checkHealth(): Promise<boolean> {
        try {
            const endpoint = `${this.config.baseUrl.replace(/\/$/, '')}/v1beta/models/${this.config.model}:generateContent`;
            const headers: Record<string, string> = {
                "x-goog-api-key": this.config.apiKey || ""
            };
            const res = await fetch(endpoint, { headers, signal: AbortSignal.timeout(5000) });
            return res.ok;
        } catch {
            return false;
        }
    }

    async streamExtraction(request: ExtractionRequest): Promise<ReadableStream<Uint8Array>> {
        const endpoint = `${this.config.baseUrl.replace(/\/$/, '')}/v1beta/models/${this.config.model}:streamGenerateContent?alt=sse`;
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "x-goog-api-key": this.config.apiKey || ""
        };

        const payload = {
            ocr_text: request.ocr_text,
            image_context: request.image_context || "",
            today_date: request.today_date || new Date().toISOString().split("T")[0],
        };

        const parts: any[] = [{ text: `${SYSTEM_PROMPT}\n\nClient Context: ${JSON.stringify(payload)}` }];
        if (request.base64_image) {
            parts.push({ inline_data: { mime_type: "image/jpeg", data: request.base64_image } });
        }
        const body = { contents: [{ parts }] };

        const response = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`Gemini API returned ${response.status}: ${await response.text()}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        const self = this;

        return new ReadableStream({
            async start(controller) {
                controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "EXEC", message: `[INIT] Provider: GEMINI | Model: ${self.config.model}` }) + "\n"));
                controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "EXEC", message: `[HTTP] POST ${endpoint}` }) + "\n"));
                controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "EXEC", message: `[PAYLOAD] image=${request.base64_image ? `${Math.round(request.base64_image.length / 1024)}KB` : "none"} | text=${request.ocr_text?.length || 0} chars` }) + "\n"));

                let lineBuffer = "";
                let accumulatedContent = "";
                const startTime = Date.now();

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        lineBuffer += decoder.decode(value, { stream: true });
                        const lines = lineBuffer.split("\n");
                        lineBuffer = lines.pop() || "";

                        for (const line of lines) {
                            if (!line.trim() || !line.startsWith("data: ")) continue;
                            try {
                                const json = JSON.parse(line.replace("data: ", "").trim());
                                const token = json.candidates?.[0]?.content?.parts?.[0]?.text || "";
                                if (token) {
                                    accumulatedContent += token;
                                    controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "SYNTH", message: token }) + "\n"));
                                }
                            } catch { continue; }
                        }
                    }

                    const latency = Date.now() - startTime;
                    controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "EXEC", message: `[COMPLETE] Latency: ${latency}ms | ${accumulatedContent.length} chars decoded` }) + "\n"));

                    const jsonMatch = accumulatedContent.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
                    const finalJson = JSON.parse(jsonMatch ? jsonMatch[0] : accumulatedContent);

                    saveEvent(finalJson);

                    controller.enqueue(encoder.encode(JSON.stringify({ type: "final", event: finalJson }) + "\n"));
                    controller.close();
                } catch (e: any) {
                    controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message: e.message }) + "\n"));
                    controller.close();
                }
            }
        });
    }

    override generateCurl(request: ExtractionRequest): string {
        const endpoint = `${this.config.baseUrl.replace(/\/$/, '')}/v1beta/models/${this.config.model}:streamGenerateContent?alt=sse`;
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "x-goog-api-key": this.config.apiKey || ""
        };
        const payload = {
            ocr_text: request.ocr_text,
            image_context: request.image_context || "",
            today_date: request.today_date || new Date().toISOString().split("T")[0],
        };
        const parts: any[] = [{ text: `${SYSTEM_PROMPT}\n\nClient Context: ${JSON.stringify(payload)}` }];
        if (request.base64_image) {
            parts.push({ inline_data: { mime_type: "image/jpeg", data: request.base64_image } });
        }
        const body = { contents: [{ parts }] };

        return `curl -X POST '${endpoint}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'x-goog-api-key: ${this.config.apiKey}' \\\n  -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`;
    }
}
