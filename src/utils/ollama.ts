/**
 * Ollama Utility Functions
 * 
 * This module provides helper functions for interacting with Ollama API.
 */

/**
 * Fetches available models from an Ollama instance.
 * 
 * @param baseUrl - The base URL of the Ollama server (e.g., "http://localhost:11434")
 * @returns Array of available model objects, or empty array on error
 * 
 * @example
 * const models = await getOllamaModels("http://localhost:11434");
 * console.log(models); // [{ name: "llama3", ... }, ...]
 */
export async function getOllamaModels(baseUrl: string): Promise<unknown[]> {
    try {
        // Skip for non-Ollama endpoints
        if (baseUrl.includes("generativelanguage.googleapis.com")) return [];

        const response = await fetch(`${baseUrl}/api/tags`);
        if (!response.ok) return [];

        const data = (await response.json()) as { models?: unknown[] };
        return data.models || [];
    } catch {
        return [];
    }
}
