import { BaseProvider, type ProviderConfig, type ExtractionRequest } from "../providers/base.provider";
import { GeminiProvider } from "../providers/gemini.provider";
import { OpenAIProvider } from "../providers/openai.provider";
import { PaddleProvider } from "../providers/paddle.provider";

export class ProviderService {
    static getProvider(config: ProviderConfig): BaseProvider {
        const isGemini = config.baseUrl.includes("generativelanguage.googleapis.com");
        const isPaddle = config.model === "PaddleOCR-VL-1.5";

        if (isPaddle) return new PaddleProvider(config);
        if (isGemini) return new GeminiProvider(config);

        return new OpenAIProvider(config);
    }

    static async orchestrateExtraction(strategy: string, config: ProviderConfig, request: ExtractionRequest): Promise<ReadableStream<Uint8Array>> {
        const provider = this.getProvider(config);

        if (strategy === "C") {
            return provider.streamExtraction(request);
        }

        if (strategy === "B") {
            const paddle = new PaddleProvider(config);
            const ocrStream = await paddle.streamExtraction(request);
            const ocrReader = ocrStream.getReader();

            const encoder = new TextEncoder();
            const decoder = new TextDecoder();

            return new ReadableStream({
                async start(controller) {
                    let ocrData = "";
                    try {
                        while (true) {
                            const { done, value } = await ocrReader.read();
                            if (done) break;

                            // Proxy the Paddle logs to the client
                            controller.enqueue(value);

                            const chunk = decoder.decode(value);
                            const lines = chunk.split("\n");
                            for (const line of lines) {
                                if (!line.trim()) continue;
                                try {
                                    const msg = JSON.parse(line);
                                    if (msg.type === "final") {
                                        ocrData = msg.event.extracted_text || "";
                                    }
                                } catch { }
                            }
                        }

                        // Now that OCR is done, start LLM extraction
                        const llmProvider = ProviderService.getProvider(config);
                        const llmStream = await llmProvider.streamExtraction({
                            ...request,
                            ocr_text: ocrData,
                            base64_image: undefined
                        });
                        const llmReader = llmStream.getReader();

                        while (true) {
                            const { done, value } = await llmReader.read();
                            if (done) break;
                            controller.enqueue(value);
                        }
                        controller.close();
                    } catch (e: any) {
                        controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message: e.message }) + "\n"));
                        controller.close();
                    }
                }
            });
        }

        return provider.streamExtraction(request);
    }

    static async checkHealth(config: ProviderConfig): Promise<boolean> {
        const provider = this.getProvider(config);
        return provider.checkHealth();
    }
}
