// Local OCR is deprecated in favor of Vision API
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
    return ""; // Vision API will handle the PDF content directly if supported, or we rely on image view
}

export async function extractTextFromImage(buffer: Buffer): Promise<string> {
    return ""; // Vision API acts directly on the image
}
