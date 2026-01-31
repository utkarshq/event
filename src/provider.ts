import { SYSTEM_PROMPT } from "./prompt";

function generateCurl(endpoint: string, headers: Record<string, string>, body: unknown): string {
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

/** Validates the connection to the specified provider. */
export async function checkProviderHealth(config: ProviderConfig): Promise<boolean> {
    try {
        const isGemini = config.baseUrl.includes("generativelanguage.googleapis.com");
        const isOllama = !isGemini && (config.baseUrl.includes(":11434") || config.baseUrl.includes("/api"));

        let endpoint = "";
        const headers: Record<string, string> = {};

        if (isGemini) {
            endpoint = `${config.baseUrl.replace(/\/$/, '')}/v1beta/models/${config.model}:generateContent`;
            headers["x-goog-api-key"] = config.apiKey || "";
        } else {
            endpoint = isOllama ? `${config.baseUrl}/api/tags` : `${config.baseUrl}/models`;
            if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
        }

        const res = await fetch(endpoint, { headers, signal: AbortSignal.timeout(5000) });
        return res.ok;
    } catch {
        return false;
    }
}

/** Streams AI response from Gemini, Ollama, or OpenAI-compatible APIs. */
export async function parseEventStream(
    ocrText: string,
    imageContext: string | undefined,
    todayDate: string | undefined,
    config: ProviderConfig,
    base64Image?: string,
    options: Record<string, unknown> = {}
): Promise<Response & { curlCommand?: string }> {
    const isGemini = config.baseUrl.includes("generativelanguage.googleapis.com");
    const isOllamaLocal = !isGemini && (config.baseUrl.includes(":11434") || config.baseUrl.includes("/api"));

    const payload = {
        ocr_text: ocrText,
        image_context: imageContext || "",
        today_date: todayDate || new Date().toISOString().split("T")[0],
    };

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    let endpoint = "";
    let body: unknown = {};

    if (isGemini) {
        endpoint = `${config.baseUrl.replace(/\/$/, '')}/v1beta/models/${config.model}:streamGenerateContent?alt=sse`;
        headers["x-goog-api-key"] = config.apiKey || "";

        const parts: unknown[] = [{ text: `${SYSTEM_PROMPT}\n\nClient Context: ${JSON.stringify(payload)}` }];
        if (base64Image) {
            parts.push({ inline_data: { mime_type: "image/jpeg", data: base64Image } });
        }
        body = { contents: [{ parts }] };
    } else {
        endpoint = isOllamaLocal ? `${config.baseUrl}/api/chat` : `${config.baseUrl}/chat/completions`;
        if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

        const messages: unknown[] = [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(payload), images: isOllamaLocal && base64Image ? [base64Image] : undefined },
        ];

        if (!isOllamaLocal && base64Image) {
            (messages[1] as Record<string, unknown>).content = [
                { type: "text", text: JSON.stringify(payload) },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
            ];
        }

        body = {
            model: config.model,
            messages,
            stream: true,
            ...(isOllamaLocal ? { format: "json" } : { response_format: { type: "json_object" } }),
            options
        };
    }

    const curlCommand = generateCurl(endpoint, headers, body);

    try {
        const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
        (response as Response & { curlCommand?: string }).curlCommand = curlCommand;
        return response as Response & { curlCommand?: string };
    } catch (error: unknown) {
        (error as Error & { curlCommand?: string }).curlCommand = curlCommand;
        throw error;
    }
}

/** Fetches available models from Ollama. */
export async function getOllamaModels(baseUrl: string): Promise<unknown[]> {
    try {
        if (baseUrl.includes("generativelanguage.googleapis.com")) return [];
        const r = await fetch(`${baseUrl}/api/tags`);
        if (!r.ok) return [];
        const d = (await r.json()) as { models?: unknown[] };
        return d.models || [];
    } catch {
        return [];
    }
}
