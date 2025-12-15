
import OpenAI from "openai";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface AnalyzedItem {
  itemName: string;
  quantity: number;
  category: string;
  confidence: number;
  warnings?: string[];
}

export async function analyzeInventoryImages(base64Images: string[]): Promise<AnalyzedItem[]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  // Prepare messages with images
  const content: any[] = [
    {
      type: "text",
      text: `Identify the commercial products in these images and count their quantities.
      Return a STRICT JSON array of objects. Do not include markdown formatting like \`\`\`json.
      
      Schema:
      [
        {
          "itemName": "Specific Product Name (e.g. 'Coca-Cola 2L', 'Lays Classic Chip 50g')",
          "quantity": 5, // Total visible count across all images
          "category": "Suggested Category (e.g. 'Beverages', 'Snacks')",
          "confidence": 0.95, // Estimated confidence 0-1
          "warnings": ["Low visibility", "Partially occluded"] // Optional array of strings
        }
      ]

      Rules:
      1. Be precise with names. Include brand and size/variant if visible.
      2. If an item appears in multiple images, try not to double count if it looks like the same set of items, but default to counting what you see.
      3. Ignore distinct non-product background elements.
      4. Group identical items into a single entry with summed quantity.
      `,
    },
  ];

  // Add images
  for (const base64 of base64Images) {
    // Ensure base64 string has the correct prefix
    const dataUrl = base64.startsWith("data:image") 
      ? base64 
      : `data:image/jpeg;base64,${base64}`;
      
    content.push({
      type: "image_url",
      image_url: {
        url: dataUrl,
      },
    });
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: content,
        },
      ],
      max_tokens: 1000,
    });

    const rawContent = response.choices[0].message.content?.trim() || "[]";
    
    // Clean up potential markdown code blocks if the model ignores the instruction
    const jsonString = rawContent.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    
    const items = JSON.parse(jsonString);
    return items;
  } catch (error) {
    console.error("OpenAI Inventory Analysis Error:", error);
    throw new Error("Failed to analyze images");
  }
}
