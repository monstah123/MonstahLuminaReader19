import { GoogleGenAI, Type, Modality } from "@google/genai";
import { BookInfo, SearchResult, ChatMessage, GroundingChunk } from "../types";

// 1. Check for the VITE_ prefixed key
if (!import.meta.env.VITE_GEMINI_API_KEY) {
  throw new Error("VITE_GEMINI_API_KEY environment variable is not set");
}

// 2. Access the key using the VITE syntax (import.meta.env)
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
const ai = new GoogleGenAI({ apiKey });

const BOOK_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    author: { type: Type.STRING },
    description: { type: Type.STRING },
    genre: { type: Type.STRING },
    publishedDate: { type: Type.STRING },
    chapters: {
      type: Type.ARRAY,
      items: { type: Type.STRING }
    },
    recommendations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          author: { type: Type.STRING },
          reason: { type: Type.STRING }
        }
      }
    }
  },
  required: ["title", "author", "description", "chapters", "recommendations"],
};

const parseJSONResponse = (text: string): any => {
  try {
    return JSON.parse(text);
  } catch (e) {
    try {
      let cleaned = text.replace(/```json\n?|```/g, '').trim();
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace >= 0) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      }
      return JSON.parse(cleaned);
    } catch (e2) {
      console.error("Failed to parse JSON response:", text);
      throw new Error("The AI response could not be processed. Please try again.");
    }
  }
};

export const identifyBook = async (base64Image: string): Promise<BookInfo> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Image
            }
          },
          {
            text: `Identify this book. Return JSON with title, author, summary (150 words max), genre, date, chapters list, and 3 recommendations. If not a book, error.`
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: BOOK_SCHEMA
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response received from Gemini.");
    return parseJSONResponse(text) as BookInfo;
  } catch (error: any) {
    console.error("Identify Book Error:", error);
    throw error;
  }
};

export const searchBook = async (query: string): Promise<BookInfo> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            text: `Identify book matching "${query}". Return JSON with title, author, summary (150 words max), genre, date, chapters list, and 3 recommendations. If vague, guess best match.`
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: BOOK_SCHEMA
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response received from Gemini.");
    return parseJSONResponse(text) as BookInfo;
  } catch (error: any) {
    console.error("Search Book Error:", error);
    throw error;
  }
};

export const getChapterContent = async (title: string, author: string, chapterName: string, language: string = 'English'): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            text: `Write a concise, engaging storytelling summary of the chapter "${chapterName}" from the book "${title}" by ${author}.
            Target length: 250-300 words. Focus on key plot points. Write for audio narration (natural flow).
            Language: Write strictly in ${language}.
            CRITICAL INSTRUCTION: Ensure the summary has a proper conclusion and ends with a complete sentence. Do not cut off the output abruptly.`
          }
        ]
      },
      config: {
        temperature: 0.7,
        maxOutputTokens: 8192,
      }
    });
    
    let text = response.text;
    if (!text) {
      throw new Error("Empty response from AI model.");
    }
    
    // Safety fallback: trim to last complete sentence if it looks like it was cut off (rare with high tokens)
    text = text.trim();
    if (text.length > 0 && !/[.!?]"?$/.test(text)) {
       const lastPunct = Math.max(text.lastIndexOf('.'), text.lastIndexOf('!'), text.lastIndexOf('?'));
       if (lastPunct > text.length * 0.8) { // Only trim if we keep most of the text
          text = text.substring(0, lastPunct + 1);
       }
    }

    return text;
  } catch (error: any) {
    console.error("Get Chapter Content Error:", error);
    const msg = error.message || "Could not generate content for this chapter.";
    throw new Error(msg);
  }
};

export const generateBookNarration = async (text: string, voiceName: string = 'Kore'): Promise<string | null> => {
  try {
    if (!text || text.trim().length === 0) {
        throw new Error("No text provided for narration.");
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: {
        parts: [{ text: `Narrate vividly: ${text}` }]
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const parts = response.candidates?.[0]?.content?.parts;
    if (parts && parts.length > 0 && parts[0].inlineData?.data) {
      return parts[0].inlineData.data;
    }
    return null;
  } catch (e: any) {
    console.error("TTS Error:", e);
    throw new Error(e.message || "Speech generation failed. Please try again.");
  }
};

export const findBookSources = async (title: string, author: string): Promise<SearchResult> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            text: `Find where I can buy or download the book "${title}" by ${author}. 
            Look for major retailers (Amazon, Barnes & Noble), audiobook platforms (Audible), and if applicable, public domain sources (Project Gutenberg).`
          }
        ]
      },
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const links: GroundingChunk[] = rawChunks.map(c => ({
      web: c.web ? {
        uri: c.web.uri || '',
        title: c.web.title || ''
      } : undefined
    })).filter(c => c.web && c.web.uri);

    return {
      text: response.text || "No specific details found.",
      links: links
    };
  } catch (error: any) {
    console.error("Find Sources Error:", error);
    throw new Error("Could not find external book sources.");
  }
};

export const chatWithBook = async (
  bookInfo: BookInfo,
  history: ChatMessage[],
  userMessage: string
): Promise<string> => {
  try {
    const systemPrompt = `You are an expert literary assistant for the book "${bookInfo.title}" by ${bookInfo.author}. 
    The book description is: ${bookInfo.description}.
    
    User Context: The user is reading this book and wants to discuss themes, characters, or plot.
    
    INSTRUCTIONS:
    1. Be insightful and helpful.
    2. Keep your answers CONCISE and broken into short, digestible paragraphs.
    3. STRICTLY NO MARKDOWN or SPECIAL FORMATTING. 
    4. Do not use **bold**, *italics*, lists, or asterisks (*). 
    5. Write in plain text paragraphs only. Separate ideas with double newlines.
    6. Do not give away major spoilers unless explicitly asked.`;

    const contents = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: "Understood. I will keep my answers plain text, concise, and chunked into paragraphs." }] }
    ];

    // Add history
    history.forEach(msg => {
      contents.push({
        role: msg.role,
        parts: [{ text: msg.text }]
      });
    });

    // Add current message
    contents.push({
      role: 'user',
      parts: [{ text: userMessage }]
    });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contents,
    });

    return response.text || "I couldn't think of an answer.";
  } catch (error: any) {
    console.error("Chat Error:", error);
    throw new Error("Failed to get chat response.");
  }
};
