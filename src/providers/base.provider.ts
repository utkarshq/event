export interface ProviderConfig {
    baseUrl: string;
    apiKey?: string;
    model: string;
    options?: Record<string, unknown>;
}

export interface ExtractionRequest {
    ocr_text: string;
    image_context?: string;
    today_date?: string;
    base64_image?: string;
    options?: Record<string, unknown>;
}

export interface LogMessage {
    type: "log" | "error" | "final";
    tag?: string;
    message?: string;
    event?: any;
    timestamp?: number;
}

export abstract class BaseProvider {
    abstract name: string;

    constructor(protected config: ProviderConfig) { }

    abstract checkHealth(): Promise<boolean>;

    /**
     * Streams the extraction result.
     * Returns a ReadableStream that enqueues LogMessage objects.
     */
    abstract streamExtraction(request: ExtractionRequest): Promise<ReadableStream<Uint8Array>>;

    /**
     * Optional: Generate a CURL command for debugging.
     */
    generateCurl?(request: ExtractionRequest): string;
}
