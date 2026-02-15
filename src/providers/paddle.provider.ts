import { BaseProvider, type ExtractionRequest } from "./base.provider";
import { ModelService } from "../services/model.service";
import { saveEvent } from "../db";

export class PaddleProvider extends BaseProvider {
    name = "PaddleOCR";

    private static BRIDGE_URL = "http://127.0.0.1:5000";

    async checkHealth(): Promise<boolean> {
        try {
            const res = await fetch(`${PaddleProvider.BRIDGE_URL}/health`, {
                signal: AbortSignal.timeout(2000)
            });
            if (!res.ok) return false;
            const data = await res.json() as any;
            return data.status === "ok";
        } catch {
            return false;
        }
    }

    async streamExtraction(request: ExtractionRequest): Promise<ReadableStream<Uint8Array>> {
        const encoder = new TextEncoder();
        const self = this;

        return new ReadableStream({
            async start(controller) {
                const startTime = Date.now();
                try {
                    controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "EXEC", message: `[INIT] PaddleOCR Verification...` }) + "\n"));

                    const isHealthy = await self.checkHealth();
                    if (!isHealthy) {
                        controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "EXEC", message: `[SYSTEM] Bridge not ready. Initializing...` }) + "\n"));
                        await ModelService.start();
                    }

                    // Auto-switch to Lite if using VLM on Eco
                    const status = ModelService.getStatus();
                    if (status.activeTier === "eco") {
                        controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "EXEC", message: `[SYSTEM] VLM requires Lite tier. Switching...` }) + "\n"));
                        ModelService.setActiveTier("lite");
                        // Wait for bridge restart
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        await ModelService.start();
                    }

                    controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "EXEC", message: `[HTTP] POST ${PaddleProvider.BRIDGE_URL}/ocr` }) + "\n"));
                    controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "EXEC", message: `[LOCAL] Running OCR engine (this may take 10-20s)...` }) + "\n"));

                    const response = await fetch(`${PaddleProvider.BRIDGE_URL}/ocr`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            image_base64: request.base64_image
                        })
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Paddle Bridge returned ${response.status}: ${errorText}`);
                    }

                    const data = await response.json() as any;
                    const extractedText = data.result || "";

                    controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "EXEC", message: `[DONE] Bridge returned ${extractedText.length} characters.` }) + "\n"));
                    controller.enqueue(encoder.encode(JSON.stringify({ type: "log", tag: "SYNTH", message: extractedText }) + "\n"));

                    const finalEvent = {
                        title: "OCR Extraction",
                        extracted_text: extractedText,
                        source: "PaddleOCR",
                        generation_time_ms: Date.now() - startTime
                    };

                    saveEvent(finalEvent);

                    controller.enqueue(encoder.encode(JSON.stringify({ type: "final", event: finalEvent }) + "\n"));
                    controller.close();
                } catch (e: any) {
                    controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message: e.message }) + "\n"));
                    controller.close();
                }
            }
        });
    }
}
