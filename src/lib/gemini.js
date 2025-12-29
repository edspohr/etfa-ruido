import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Gemini
// Note: In production, you should proxy this request or use Firebase Cloud Functions
// to avoid exposing the key if this is a public client, but for internal tools it might be acceptable
// with restricted keys.
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(API_KEY);

export async function parseReceiptImage(file) {
  if (!API_KEY) {
    console.warn("Gemini API Key is missing.");
    return null;
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Convert file to base64
    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const prompt = `
      Analyze this image of a receipt/invoice. 
      Extract the following information in JSON format:
      - date: standardized YYYY-MM-DD format
      - merchant: name of the place
      - amount: total amount as a number (remove currency symbols)
      - description: a short summary of the items (e.g. "Lunch", "Hardware materials")
      
      If you cannot find a field, return null for it.
      JSON:
    `;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType: file.type,
        },
      },
    ]);

    const response = await result.response;
    const text = response.text();

    // Clean up markdown code blocks if present
    const jsonStr = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Error parsing receipt with Gemini:", error);
    throw error;
  }
}
