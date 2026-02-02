import { BaseProvider, type ExtractionRequest } from "./base.provider";
import { SYSTEM_PROMPT } from "../prompt";
import { saveEvent } from "../db";

export class OpenAIProvider extends BaseProvider {
    name = "OpenAI";

    async checkHealth(): Promise<boolean> {
        try {
            const isOllama = this.config.baseUrl.includes(":11434") || this.config.baseUrl.includes("/api");
            const endpoint = isOllama ? `${this.config.baseUrl}/api/tags` : `${this.config.baseUrl}/models`;
            const headers: Record<string, string> = {};
            if (this.config.apiKey) headers["Authorization"] = `Bearer ${this.config.apiKey}`;

            const res = await fetch(endpoint, { headers, signal: AbortSignal.timeout(5000) });
            return res.ok;
        } catch {
            return false;
        }
    }

    async streamExtraction(request: ExtractionRequest): Promise<ReadableStream<Uint8Array>> {
        const isOllama = this.config.baseUrl.includes(":11434") || this.config.baseUrl.includes("/api");
        const endpoint = isOllama ? `${this.config.baseUrl}/api/chat` : `${this.config.baseUrl}/chat/completions`;

        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (this.config.apiKey) headers["Authorization"] = `Bearer ${this.config.apiKey}`;

        const payload = {
            ocr_text: request.ocr_text,
            image_context: request.image_context || "",
            today_date: request.today_date || new Date().toISOString().split("T")[0],
        };

        const messages: any[] = [
            { role: "system", content: SYSTEM_PROMPT },
            {
                role: "user",
                content: JSON.stringify(payload),
                images: isOllama && request.base64_image ? [request.base64_image] : undefined
            },
        ];

        if (!isOllama && request.base64_image) {
            messages[1].content = [
                { type: "text", text: JSON.stringify(payload) },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${request.base64_image}` } }
            ];
        }

        const body = {
            model: this.config.model,
            messages,
            stream: true,
            ...(isOllama ? { format: "json" } : { response_format: { type: "json_object" } }),
            ...this.config.options
        };

        const response = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`OpenAI-Compatible API returned ${response.status}: ${await response.text()}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        const self = this;

        return new ReadableStream({
            async start(controller) {
                controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "EXEC", message: `[INIT] Provider: ${isOllama ? 'OLLAMA' : 'OPENAI'} | Model: ${self.config.model}` }) + "\n"));
                controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "EXEC", message: `[HTTP] POST ${endpoint}` }) + "\n"));

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
                            if (!line.trim()) continue;
                            let token = "";
                            try {
                                if (isOllama) {
                                    const json = JSON.parse(line);
                                    token = json.message?.content || "";
                                } else if (line.startsWith("data: ")) {
                                    const dataStr = line.replace("data: ", "").trim();
                                    if (dataStr !== "[DONE]") {
                                        const json = JSON.parse(dataStr);
                                        token = json.choices?.[0]?.delta?.content || "";
                                    }
                                }
                            } catch { continue; }

                            if (token) {
                                accumulatedContent += token;
                                controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "SYNTH", message: token }) + "\n"));
                            }
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
        const isOllama = this.config.baseUrl.includes(":11434") || this.config.baseUrl.includes("/api");
        const endpoint = isOllama ? `${this.config.baseUrl}/api/chat` : `${this.config.baseUrl}/chat/completions`;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (this.config.apiKey) headers["Authorization"] = `Bearer ${this.config.apiKey}`;

        return `curl -X POST '${endpoint}' -H 'Content-Type: application/json' ...`;
    }
}
