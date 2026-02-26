
import { GoogleGenAI, Type } from "@google/genai";
import { Recipe, InventoryItem } from "./types";

// --- API Key Helper ---
function getGeminiClient(): GoogleGenAI {
  const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY || "";
  if (!apiKey) {
    throw new Error("Missing API Key. Please check Settings.");
  }
  return new GoogleGenAI({ apiKey });
}

// --- Error Handler ---
function handleApiError(error: any) {
  console.error("Gemini API Error:", error);
  const errString = error.toString().toLowerCase();

  let title = "AI 請求失敗";
  let message = "發生未預期的錯誤，請稍後再試。";

  if (errString.includes('403') || errString.includes('key') || errString.includes('permission') || errString.includes('unauthenticated') || errString.includes('missing api key')) {
    title = "API Key 設定錯誤";
    message = "API Key 設定有誤、缺失或是已過期。\n請前往「設定」頁面輸入您的 Gemini API Key。";
  } else if (errString.includes('network') || errString.includes('fetch')) {
    title = "網路連線錯誤";
    message = "請檢查您的網路連線是否正常。";
  }

  // Dispatch custom event for UI to pick up
  window.dispatchEvent(new CustomEvent('show-alert', {
    detail: { title, message }
  }));
}

// Helper to strictly validate and clean tags based on whitelist
function cleanTags(tags: string[], allowed: string[]): string[] {
  if (!tags || !Array.isArray(tags)) return [];
  if (!allowed || allowed.length === 0) return [];

  const allowedSet = new Set(allowed);
  // Filter tags that exactly match the allowed list
  return tags.filter(t => allowedSet.has(t));
}

// 🍎 改為動態接收現有分類的函數
const getCommonPromptRules = (categories: string[]) => {
  const catString = categories.length > 0 ? categories.join("', '") : "食品', '雜貨', '藥品', '盥洗用品', '電子產品', '其他";
  return `
  **[嚴格 JSON 輸出模式 - 效能優化]**
  1. 請直接回傳 JSON 格式，不要包含 Markdown 標記 (如 \`\`\`json) 或任何解釋文字。
  2. **name (名稱)**：保留 brand、系列。
  3. **subCategory (小分類)**：物品本體名稱。
  4. **packageSize (包裝容量/規格)**：從名稱或圖片中提取容量、重量。
  5. **price (單價)**：提取單價數字。如果發票或圖片上僅有「總價」與「數量」，請務必自行計算「總價 ÷ 數量 = 單價」並回傳此單價數字；若無價格則回傳 0。
  6. **expiryDate (有效期限)**：極度仔細尋找包裝上的效期 (EXP, Best Before)。若有找到，統一轉換為 YYYY-MM-DD 格式；若無則回傳空字串。
  7. **category (大分類)**：請務必優先從現有類別 ['${catString}'] 中挑選最適合的。
`;
};

const RECIPE_STRICT_PROMPT = `
  **[嚴格資料提取規則]**
  1. **做法內嵌數量**：在 steps 提到食材時，必須將份量以括號嵌入，如「加入 高筋麵粉 (280g)」。
  2. **事實導向**：若圖文無步驟，steps 必須為空陣列 []。
  3. **食材一致性**：保持「食材名稱 (數量)」格式。
`;

const RECIPE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    ingredients: { type: Type.ARRAY, items: { type: Type.STRING } },
    steps: { type: Type.ARRAY, items: { type: Type.STRING } },
    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
    sourceLink: { type: Type.STRING }
  },
  required: ["name", "ingredients", "steps", "tags"]
};

// --- Smart Cost & Nutrition ---
export interface CostNutritionResult {
  totalCost: number;
  totalWeight: number;
  nutrition: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  ingredients: {
    name: string;
    amount: string;
    cost: number;
    unitPrice: number;
    source: 'inventory' | 'ai';
  }[];
}

export async function estimateRecipeCostAndNutrition(recipe: Recipe, inventoryItems: InventoryItem[]): Promise<CostNutritionResult | null> {
  try {
    const ai = getGeminiClient();
    const inventoryContext = inventoryItems.map(i => ({
      name: i.name,
      subCategory: i.subCategory,
      packageSize: i.packageSize,
      price: i.price,
      quantity: i.quantity
    })).filter(i => i.price && i.price > 0);

    const prompt = `
      You are a smart kitchen assistant. Calculate the estimated cost, total weight, and nutrition for this recipe.
      
      Recipe: ${recipe.name}
      Ingredients: ${JSON.stringify(recipe.ingredients)}
      Inventory Context: ${JSON.stringify(inventoryContext)}

      **[Price Anchoring & Stability Rules - CRITICAL]**
      1. **Target Market**: ALWAYS use prices from **Premium Supermarkets (e.g., Breeze Super, City'Super, or High-end Organic Stores)** as your base.
      2. **Unit Consistency**:
         - Premium Eggs: 12-15 TWD / piece.
         - Organic Chicken Breast: 450-550 TWD / kg.
         - Premium Milk: 100-120 TWD / 936ml.
         - Flour: 80-120 TWD / kg.
      3. **Vague Unit Standardization**: Convert vague terms to weight BEFORE cost calculation:
         - "少許/適量 (Pinch/Some)" = 3g
         - "一大匙 (Tablespoon)" = 15g/15ml
         - "一小匙 (Teaspoon)" = 5g/5ml
         - "一碗 (Bowl)" = 250g
      4. **Logic Priority**:
         - Priority 1: Use matching Inventory Context price.
         - Priority 2: Use AI Premium Anchoring Prices.
      
      **[Calculations]**
      - Total Weight: Sum of all ingredients in grams (g).
      - Nutrition: Based on Taiwan FDA standards.
      - Output JSON only.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [{ text: prompt }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            totalCost: { type: Type.NUMBER },
            totalWeight: { type: Type.NUMBER },
            nutrition: {
              type: Type.OBJECT,
              properties: {
                calories: { type: Type.NUMBER },
                protein: { type: Type.NUMBER },
                carbs: { type: Type.NUMBER },
                fat: { type: Type.NUMBER },
              },
              required: ["calories", "protein", "carbs", "fat"]
            },
            ingredients: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  amount: { type: Type.STRING },
                  cost: { type: Type.NUMBER },
                  unitPrice: { type: Type.NUMBER },
                  source: { type: Type.STRING, enum: ["inventory", "ai"] }
                },
                required: ["name", "cost", "source", "unitPrice"]
              }
            }
          },
          required: ["totalCost", "totalWeight", "nutrition", "ingredients"]
        }
      }
    });

    return JSON.parse(response.text || "null");
  } catch (error) {
    handleApiError(error);
    return null;
  }
}

export async function recognizeItemFromImage(base64Images: string[], context: any) {
  try {
    const ai = getGeminiClient();
    const imageParts = base64Images.map(img => ({ inlineData: { data: img, mimeType: "image/jpeg" } }));
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [...imageParts, { text: `辨識圖片物品清單。若上傳多張照片，請自動交叉比對（例如：將照片A的商品正面與照片B的背面效期合併為同一筆資料）。\n${getCommonPromptRules(context?.categories || [])}` }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              quantity: { type: Type.NUMBER },
              category: { type: Type.STRING },
              subCategory: { type: Type.STRING },
              location: { type: Type.STRING },
              expiryDate: { type: Type.STRING },
              packageSize: { type: Type.STRING },
              price: { type: Type.NUMBER },
              remarks: { type: Type.STRING }
            },
            required: ["name", "quantity", "category", "subCategory"]
          }
        }
      }
    });
    return JSON.parse(response.text || "[]");
  } catch (error) { handleApiError(error); return []; }
}

export async function inferItemDetailsFromText(itemName: string, context: any) {
  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [{ text: `推斷物品屬性：${itemName}。\n${getCommonPromptRules(context?.categories || [])}` }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            quantity: { type: Type.NUMBER },
            category: { type: Type.STRING },
            subCategory: { type: Type.STRING },
            location: { type: Type.STRING },
            packageSize: { type: Type.STRING },
            remarks: { type: Type.STRING }
          },
          required: ["category", "subCategory", "quantity"]
        }
      }
    });
    return JSON.parse(response.text || "{}");
  } catch (error) { handleApiError(error); return {}; }
}

export async function recognizeExpiryDate(base64Image: string): Promise<string | null> {
  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [{ inlineData: { data: base64Image, mimeType: "image/jpeg" } }, { text: "辨識效期 YYYY-MM-DD。若無則回傳空字串。" }] },
      config: { responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { expiryDate: { type: Type.STRING } } } }
    });
    const res = JSON.parse(response.text || "{}");
    return res.expiryDate || "";
  } catch (error) { handleApiError(error); return null; }
}

export async function recognizeRecipeFromImage(base64Image: string, availableTags: string[] = []) {
  try {
    const ai = getGeminiClient();
    const tagList = availableTags.join(', ');

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { data: base64Image, mimeType: "image/jpeg" } },
          {
            text: `Extract recipe data. ${RECIPE_STRICT_PROMPT}
              **[STRICT TAGGING RULES]**
              1. You must select tags ONLY from this specific list: [${tagList}].
              2. Do NOT invent, translate, or create new tags.
              3. If no tag from the list applies, return an empty array for tags.
            `}
        ]
      },
      config: { responseMimeType: "application/json", responseSchema: RECIPE_SCHEMA }
    });

    const result = JSON.parse(response.text || "{}");
    if (Array.isArray(result.steps)) result.steps = result.steps.join('\n');

    // Post-Processing: Strict Filter
    result.tags = cleanTags(result.tags, availableTags);

    return result;
  } catch (error) { handleApiError(error); return null; }
}

export async function recognizeRecipeFromText(text: string, availableTags: string[] = []) {
  try {
    const ai = getGeminiClient();
    const tagList = availableTags.join(', ');

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [{
          text: `Extract recipe data from: ${text}. ${RECIPE_STRICT_PROMPT}
            **[STRICT TAGGING RULES]**
            1. You must select tags ONLY from this specific list: [${tagList}].
            2. Do NOT invent, translate, or create new tags.
            3. If no tag from the list applies, return an empty array for tags.
          `}]
      },
      config: { responseMimeType: "application/json", responseSchema: RECIPE_SCHEMA }
    });

    const result = JSON.parse(response.text || "{}");
    if (Array.isArray(result.steps)) result.steps = result.steps.join('\n');

    // Post-Processing: Strict Filter
    result.tags = cleanTags(result.tags, availableTags);

    return result;
  } catch (error) { handleApiError(error); return null; }
}

export async function inferRecipeTagsFromTitle(dishName: string, availableTags: string[] = []) {
  try {
    const ai = getGeminiClient();
    const tagList = availableTags.join(', ');

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [{
          text: `
          推測「${dishName}」的標籤。
          **[STRICT TAGGING RULES]**
          1. You must select tags ONLY from this specific list: [${tagList}].
          2. Do NOT invent, translate, or create new tags.
          3. If no tag from the list applies, return an empty array.
        ` }]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { tags: { type: Type.ARRAY, items: { type: Type.STRING } } },
          required: ["tags"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");

    // Post-Processing: Strict Filter
    result.tags = cleanTags(result.tags, availableTags);

    return result;
  } catch (error) { handleApiError(error); return null; }
}
