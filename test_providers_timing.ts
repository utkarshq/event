
import { GeminiProvider } from "./src/providers/gemini.provider";
import { OpenAIProvider } from "./src/providers/openai.provider";
import { PaddleProvider } from "./src/providers/paddle.provider";

// Mock fetch
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
    return {
        ok: true,
        status: 200,
        body: {
            getReader: () => {
                const encoder = new TextEncoder();
                const data = 'data: {"candidates": [{"content": {"parts": [{"text": "Hello"}]}}]}\n\n';
                let sent = false;
                return {
                    read: async () => {
                        if (sent) return { done: true, value: undefined };
                        sent = true;
                        return { done: false, value: encoder.encode(data) };
                    }
                };
            }
        },
        json: async () => ({ status: "ok", result: "Extracted Text" }),
        text: async () => "ok"
    } as any;
};

// Mock saveEvent
import * as db from "./src/db";
db.saveEvent = (event: any) => {
    console.log("Saved event:", event);
};

// Mock ModelService for Paddle
import { ModelService } from "./src/services/model.service";
ModelService.start = async () => { };

async function testProvider(providerName: string, provider: any) {
    console.log(`Testing ${providerName}...`);
    const stream = await provider.streamExtraction({ ocr_text: "test" });
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        if (text.includes('"type":"final"')) {
            console.log("Final event found in stream");
            const lines = text.split("\n");
            for (const line of lines) {
                if (line.includes('"type":"final"')) {
                    const data = JSON.parse(line);
                    if (data.event.generation_time_ms) {
                        console.log(`✅ ${providerName} passed: generation_time_ms = ${data.event.generation_time_ms}`);
                    } else {
                        console.error(`❌ ${providerName} failed: generation_time_ms missing`);
                    }
                }
            }
        }
    }
}

async function run() {
    const config = { baseUrl: "http://test", apiKey: "test", model: "test" };

    try {
        await testProvider("Gemini", new GeminiProvider(config));
        await testProvider("OpenAI", new OpenAIProvider(config));

        // Paddle has a slightly different flow in the mock 
        // We need to ensure the mock fetch returns what Paddle expects
        global.fetch = async (url: any) => {
            if (url.toString().includes("health")) return { ok: true, json: async () => ({ status: "ok" }) } as any;
            if (url.toString().includes("ocr")) return { ok: true, json: async () => ({ result: "Paddle Result" }) } as any;
            return { ok: true } as any;
        };
        await testProvider("Paddle", new PaddleProvider(config));

    } catch (e) {
        console.error(e);
    }
}

run();
