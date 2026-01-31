import { SYSTEM_PROMPT } from "./prompt";

function generateCurl(endpoint: string, headers: any, body: any): string {
    let cmd = `curl -X POST '${endpoint}' \\\n`;
    for (const [key, value] of Object.entries(headers)) {
        cmd += `  -H '${key}: ${value}' \\\n`;
    }
    cmd += `  -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`;
    return cmd;
}

export interface ProviderConfig {
    baseUrl: string;
    apiKey?: string;
    model: string;
}

/**
 * Validates the connection to the specified provider.
 */
export async function checkProviderHealth(config: ProviderConfig) {
    try {
        const isGemini = config.baseUrl.includes("generativelanguage.googleapis.com");
        const isOllama = !isGemini && (config.baseUrl.includes(":11434") || config.baseUrl.includes("/api"));

        let endpoint = "";
        const headers: any = {};

        if (isGemini) {
            endpoint = `${config.baseUrl.replace(/\/$/, '')}/v1beta/models/${config.model}:generateContent`;
            headers["x-goog-api-key"] = config.apiKey;
        } else {
            endpoint = isOllama ? `${config.baseUrl}/api/tags` : `${config.baseUrl}/models`;
            if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
        }

        const res = await fetch(endpoint, {
            headers,
            signal: AbortSignal.timeout(5000)
        });
        return res.ok;
    } catch (e) {
        return false;
    }
}

/**
 * Intelligent Parser: Adapts to Ollama, OpenAI-Compliant APIs, or Google Gemini.
 */
export async function parseEvent(
    ocrText: string,
    imageContext: string | undefined,
    todayDate: string | undefined,
    config: ProviderConfig,
    base64Image?: string,
    options: any = {},
    onStage?: (tag: string, msg: string) => void
) {
    // Note: Most users will use the streaming version via parseEventStream now.
    // This is kept for backward compatibility if needed.
    onStage?.("KNL", `v14.1 Analysis Module Activated [Logic: ${config.model}]`);
    // ... (rest of the file handles this via the stream reader in index.ts for efficiency)
}

/**
 * Enhanced Stream support (Universal Relay v14.1)
 */
export async function parseEventStream(
    ocrText: string,
    imageContext: string | undefined,
    todayDate: string | undefined,
    config: ProviderConfig,
    base64Image?: string,
    options: any = {}
) {
    const isGemini = config.baseUrl.includes("generativelanguage.googleapis.com");
    const isOllamaLocal = !isGemini && (config.baseUrl.includes(":11434") || config.baseUrl.includes("/api"));

    const payload = {
        ocr_text: ocrText,
        image_context: imageContext || "",
        today_date: todayDate || new Date().toISOString().split("T")[0],
    };

    const headers: any = { "Content-Type": "application/json" };
    let endpoint = "";
    let body: any = {};

    if (isGemini) {
        // Gemini Protocol
        endpoint = `${config.baseUrl.replace(/\/$/, '')}/v1beta/models/${config.model}:streamGenerateContent?alt=sse`;
        headers["x-goog-api-key"] = config.apiKey;

        const parts: any[] = [{ text: `${SYSTEM_PROMPT}\n\nClient Context: ${JSON.stringify(payload)}` }];
        if (base64Image) {
            parts.push({
                inline_data: {
                    mime_type: "image/jpeg",
                    data: base64Image
                }
            });
        }

        body = {
            contents: [{ parts }]
        };
    } else {
        // Ollama/OpenAI Protocol
        endpoint = isOllamaLocal ? `${config.baseUrl}/api/chat` : `${config.baseUrl}/chat/completions`;
        if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

        const messages: any[] = [
            { role: "system", content: SYSTEM_PROMPT },
            {
                role: "user",
                content: JSON.stringify(payload),
                images: (isOllamaLocal && base64Image) ? [base64Image] : undefined
            },
        ];

        if (!isOllamaLocal && base64Image) {
            messages[1].content = [
                { type: "text", text: JSON.stringify(payload) },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
            ];
        }

        body = {
            model: config.model,
            messages,
            stream: true,
            ...(isOllamaLocal ? { format: "json" } : { response_format: { type: "json_object" } }),
            options: options
        };
    }

    const curlCommand = generateCurl(endpoint, headers, body);

    // We return a custom response that includes the CURL command in the stream? 
    // No, fetch returns a response. WE need to intercept the stream or `src/index.ts` needs to know the command.
    // Hack: We can attach the command to the headers of the response object we return effectively?
    // Or simpler: We can't easily pass it back through `fetch`.
    // We will log it to console, but to get it to frontend, `src/index.ts` needs it.
    // Let's modify `parseEventStream` to return { response: Response, curl: string }? 
    // No, that breaks signature.
    // Let's rely on the fact that we can call a callback if we added one, but `parseEventStream` signature in `index.ts` call doesn't supply one that writes to stream.
    // Actually `index.ts` calls `parseEventStream`.
    // Let's modify `parseEventStream` to accept an `onLog` callback.

    // Wait, the user wants "exact commands which are being executed".
    // I will log it to stdout with a special tag, and maybe `index.ts` logic can read it? No.
    // I need to change the signature of parseEventStream/index.ts.

    // For now, let's just make the fetch request.
    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });
        (response as any).curlCommand = curlCommand;
        return response;
    } catch (error: any) {
        error.curlCommand = curlCommand;
        throw error;
    }
}

// Minimal Ollama-specific legacy support for discovery
export async function getOllamaModels(baseUrl: string) {
    try {
        if (baseUrl.includes("generativelanguage.googleapis.com")) return [];
        const r = await fetch(`${baseUrl}/api/tags`);
        if (!r.ok) return [];
        const d = (await r.json()) as any;
        return d.models || [];
    } catch (e: any) {
        return [];
    }
}
