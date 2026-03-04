
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
function handleApiError(error: any): Error {
  console.error("Gemini API Error:", error);
  const errString = (error?.message || error?.toString() || '').toLowerCase();
  const status = error?.status;

  if (status === 503 || status === 500 || errString.includes('503') || errString.includes('500') || errString.includes('unavailable') || errString.includes('overloaded') || errString.includes('internal')) {
    return new Error("伺服器目前忙碌中 (503/500)，請稍後再試。");
  }
  if (status === 429 || errString.includes('429') || errString.includes('quota') || errString.includes('rate limit')) {
    return new Error("API 請求過於頻繁或額度已達上限 (429)，請稍等幾分鐘。");
  }
  if (status === 400 || errString.includes('400') || errString.includes('safety') || errString.includes('blocked') || errString.includes('format')) {
    return new Error("請求被拒絕 (400)，可能是圖片內容觸發了安全審查機制。");
  }
  if (status === 401 || status === 403 || errString.includes('401') || errString.includes('403') || errString.includes('key') || errString.includes('permission') || errString.includes('unauthenticated')) {
    return new Error("API 金鑰無效或權限不足 (401/403)。");
  }

  return new Error("AI 解析失敗，請確認圖片內容是否清晰，或手動輸入。");
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

const getRecipeStrictPrompt = (inventoryVocabulary: string = "") => `
  **[嚴格資料提取與標記規則 - 必讀]**
  1. **份量智能標記 (AI Tagging)**：在 \`ingredients\` (食材清單) 與 \`steps\` (作法步驟) 中，只要遇到「需要隨份量縮放的食材數字」，一律使用 \`{{數字|單位}}\` 的格式標記。例如：\`{{60|g}}\`, \`{{1.5|大匙}}\`, \`{{2|顆}}\`。若無單位請標記為 \`{{2}}\`。
  2. **絕對不標記**：溫度、時間、容器尺寸、攪拌次數等「不可縮放」的數字，絕對不要加上標記！例如保持「180度」、「28x28cm」、「烤15分鐘」。
  3. **食材一致性**：食材清單請輸出如「高筋麵粉 {{280|g}}」的格式。
  4. **動態食材名稱標準化 (Crucial)**：When outputting ingredients, strictly use the 'subCategory' name from the provided inventory list if available. DO NOT use the full 'name' (e.g., use '白芝麻' instead of '九鬼-深煎りいりごま 白芝麻'). If no subCategory exists, use a short generic name. 轉換後的名稱必須保留原有的 {{數值|單位}} 標記格式。
     【使用者現有庫存目錄】：${inventoryVocabulary}
  5. **做法內嵌數量**：在 steps 提到食材時務必帶入份量並標記，如「加入 高筋麵粉 {{280|g}}」。
  6. **份量估算**：若無標示幾人份，請預估並回傳純數字給 \`servings\`（例如：2）。
`;

const RECIPE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    servings: { type: Type.NUMBER },
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
      model: "gemini-2.5-flash",
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
    throw handleApiError(error);
  }
}

export async function recognizeItemFromImage(base64Images: string[], context: any) {
  try {
    const ai = getGeminiClient();
    const imageParts = base64Images.map(img => ({ inlineData: { data: img, mimeType: "image/jpeg" } }));
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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
  } catch (error) { throw handleApiError(error); }
}

export async function inferItemDetailsFromText(itemName: string, context: any) {
  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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
  } catch (error) { throw handleApiError(error); }
}

export async function recognizeExpiryDate(base64Image: string): Promise<string | null> {
  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: { parts: [{ inlineData: { data: base64Image, mimeType: "image/jpeg" } }, { text: "辨識效期 YYYY-MM-DD。若無則回傳空字串。" }] },
      config: { responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { expiryDate: { type: Type.STRING } } } }
    });
    const res = JSON.parse(response.text || "{}");
    return res.expiryDate || "";
  } catch (error) { throw handleApiError(error); }
}

export async function recognizeRecipeFromImage(base64Images: string[], availableTags: string[] = [], inventoryItems: InventoryItem[] = []) {
  try {
    const ai = getGeminiClient();
    const tagList = availableTags.join(', ');
    const inventoryVocabulary = Array.from(new Set(inventoryItems.flatMap(i => [i.name, i.subCategory].filter(Boolean)))).join(', ');

    // 將所有傳入的 Base64 圖片轉換為 Gemini 支援的格式
    const imageParts = base64Images.map(img => ({ inlineData: { data: img, mimeType: "image/jpeg" } }));

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          ...imageParts,
          {
            text: `Extract recipe data from these images. If multiple images are provided, synthesize the ingredients and steps across all images into a single cohesive recipe. ${getRecipeStrictPrompt(inventoryVocabulary)}
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
  } catch (error) { throw handleApiError(error); }
}

export async function recognizeRecipeFromText(text: string, availableTags: string[] = [], inventoryItems: InventoryItem[] = []) {
  try {
    const ai = getGeminiClient();
    const tagList = availableTags.join(', ');
    const inventoryVocabulary = Array.from(new Set(inventoryItems.flatMap(i => [i.name, i.subCategory].filter(Boolean)))).join(', ');

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [{
          text: `Extract recipe data from: ${text}. ${getRecipeStrictPrompt(inventoryVocabulary)}
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
  } catch (error) { throw handleApiError(error); }
}

export async function inferRecipeTagsFromTitle(dishName: string, availableTags: string[] = []) {
  try {
    const ai = getGeminiClient();
    const tagList = availableTags.join(', ');

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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
  } catch (error) { throw handleApiError(error); }
}

// --- Smart Meal Planner APIs ---
export async function recommendRecipes(inventory: InventoryItem[], recipes: Recipe[]) {
  try {
    const ai = getGeminiClient();
    // 過濾出庫存大於 0，且有標示效期、開封日或安全庫存的物品提供給 AI 優先處理
    const urgentInventory = inventory
      .filter(i => i.quantity > 0 && (i.expiryDate || i.openedDate || i.minThreshold > 0))
      .map(i => ({ name: i.name, subCategory: i.subCategory, expiryDate: i.expiryDate }));

    const availableRecipes = recipes.map(r => ({ id: r.id, name: r.name, ingredients: r.ingredients }));

    const prompt = `
      你是一個貼心的家庭主廚。請根據使用者目前的「庫存(優先消耗快過期或已開封)」與「已儲存的食譜庫」，推薦 3 道最適合馬上煮的食譜。
      
      **[核心規則]**
      1. 使用者「不紀錄生鮮食材 (肉類、蔬菜)」，請假設他們隨時可以去買生鮮。
      2. 推薦依據必須是：這道食譜能幫忙消耗庫存中「即將過期的乾貨、醬料或常備品」。
      3. 只能從提供的「已儲存的食譜庫」中挑選，絕對不能自己發明食譜！如果食譜庫太少或沒有適合的，請回傳空陣列。
      
      庫存：${JSON.stringify(urgentInventory)}
      食譜庫：${JSON.stringify(availableRecipes)}
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: { parts: [{ text: prompt }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              recipeId: { type: Type.STRING },
              reason: { type: Type.STRING }
            },
            required: ["recipeId", "reason"]
          }
        }
      }
    });
    return JSON.parse(response.text || "[]");
  } catch (error) { throw handleApiError(error); }
}

export async function generateMealPlan(userPrompt: string, recipes: Recipe[], targetDates: string[]) {
  try {
    const ai = getGeminiClient();
    const availableRecipes = recipes
      .filter(r => !r.tags.includes('烹飪科學') && !r.tags.includes('料理筆記'))
      .map(r => ({ id: r.id, name: r.name, tags: r.tags }));

    const prompt = `
      你是一個專業的營養配餐員。請為以下特定日期安排餐點：
      日期列表：${targetDates.join(', ')}
      
      **[核心規則]**
      1. 使用者要求：${userPrompt} (若無要求請自由均衡搭配)。
      2. 只能從提供的「食譜庫」中挑選，嚴格回傳食譜的「ID」(例如 '1741006526848')，絕對不能填寫食譜名稱！
      3. 若一餐需要多道菜，請在陣列中回傳多個 ID。若該餐不需安排可回傳空陣列。
      4. 輸出的 JSON 中，'day' 欄位必須嚴格使用上述「日期列表」中的精確字串 (YYYY-MM-DD)。
      5. 如果食譜庫的數量太少導致重複度太高，請在 'warning' 欄位給予友善提示，否則留空。
      
      食譜庫：${JSON.stringify(availableRecipes)}
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: { parts: [{ text: prompt }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            warning: { type: Type.STRING },
            plan: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  day: { type: Type.STRING },
                  breakfast: { type: Type.ARRAY, items: { type: Type.STRING } },
                  lunch: { type: Type.ARRAY, items: { type: Type.STRING } },
                  dinner: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["day", "breakfast", "lunch", "dinner"]
              }
            }
          },
          required: ["warning", "plan"]
        }
      }
    });
    let rawText = response.text || "null";
    // 移除可能出現的 Markdown 標記
    rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    return JSON.parse(rawText);
  } catch (error) { throw handleApiError(error); }
}