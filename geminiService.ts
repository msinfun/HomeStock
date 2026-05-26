
import { GoogleGenAI, Type } from "@google/genai";
import { Recipe, InventoryItem } from "./types";

// --- API Key Helper ---
function getGeminiClient(): GoogleGenAI {
  const apiKey = localStorage.getItem('gemini_api_key') || "";
  if (!apiKey) {
    throw new Error("Missing API Key. Please check Settings.");
  }
  return new GoogleGenAI({ apiKey });
}

// --- Global Timeout & AI Helper ---
async function generateContentWithTimeout(requestParams: any, timeoutMs = 20000) {
  const ai = getGeminiClient();

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      // 動態顯示秒數，誠實反映等待時間
      reject(new Error(`AI 回應超時 (已等待 ${timeoutMs / 1000} 秒)，請檢查網路狀態或重新嘗試。`));
    }, timeoutMs);
  });

  return Promise.race([
    ai.models.generateContent(requestParams),
    timeoutPromise
  ]);
}

// --- Error Handler ---
function handleApiError(error: any): Error {
  console.error("Gemini API Error:", error);
  const errString = (error?.message || error?.toString() || '').toLowerCase();
  const status = error?.status;

  // 攔截本地端拋出的 Missing API Key 錯誤
  if (errString.includes('missing api key')) {
    return new Error("尚未設定 API Key！請先前往「設定 > AI 引擎設定」輸入您的金鑰。");
  }

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

  // 替換掉原本最後的 return
  const realErrorMsg = error?.message || error?.toString() || "未知錯誤";
  return new Error(`AI 解析失敗 (${realErrorMsg})。請確認網路狀態或手動輸入。`);
}

// Helper to strictly validate and clean tags based on whitelist
function cleanTags(tags: string[], allowed: string[]): string[] {
  if (!tags || !Array.isArray(tags)) return [];
  if (!allowed || allowed.length === 0) return [];

  const allowedSet = new Set(allowed);
  // Filter tags that exactly match the allowed list
  return tags.filter(t => allowedSet.has(t));
}

const getCommonPromptRules = (categories: string[], historyNames: string[] = []) => {
  const catString = categories.length > 0 ? categories.join("', '") : "食品', '雜貨', '藥品', '盥洗用品', '電子產品', '其他";
  const historyString = historyNames.length > 0 ? historyNames.join(", ") : "";
  return `
  **[嚴格 JSON 輸出模式 - 效能優化]**
  1. 請直接回傳 JSON 格式，不要包含 Markdown 標記 (如 \`\`\`json) 或任何解釋文字。
  2. **name (名稱)**：必須是 [品牌] + [完整產品名稱] (例如：台糖晶冰糖)，不可只回傳品牌，應具備唯一性與產品種類。
  3. **subCategory (小分類)**：僅包含產品的「種類屬性」(例如：晶冰糖)，必須是 name 的「子集」或「屬性描述」。
  4. **packageSize (包裝容量/規格)**：從名稱或圖片中提取容量、重量。
  5. **price (單價)**：提取單價數字。如果發票或圖片上僅有「總價」與「數量」，請務必自行計算「總價 ÷ 數量 = 單價」並回傳此單價數字；若無價格則回傳 0。
  6. **expiryDate (有效期限)**：極度仔細尋找包裝上的效期 (EXP, Best Before)。若有找到，統一轉換為 YYYY-MM-DD 格式；若無則回傳空字串。
  7. **category (大分類)**：請務必優先從現有類別 ['${catString}'] 中挑選最適合的。
  8. **防呆機制**：如果圖片模糊或缺少資訊，請進行合理推斷，**絕對不允許回傳 null**。若無法推斷，請填寫預設值 (字串填 "", 數字填 0)。
  9. **單價防呆**：若無法取得 price，請強制回傳 0，不可省略該欄位。
  10. **【歷史語意匹配】**：這份清單是使用者過去建立的物品名稱：[${historyString}]。請以「語意」判斷你辨識出的物品是否已存在於此清單中（注意：奶油與鮮奶油是不同的東西）。若判定為同一物品（如「麥典時作工坊麵包專用粉」對應清單中的「麥典麵包粉」），請在 matchedHistoryName 欄位 100% 照抄清單中的名稱。若為全新物品，則回傳空字串。
`;
};


const getRecipeStrictPrompt = (inventoryVocabulary: string = "") => `
  **[嚴格資料提取與標記規則 - 必讀]**
  1. **份量智能標記 (強制執行)**：在 \`ingredients\` (食材) 與 \`steps\` (作法) 中，遇到需要縮放的食材數字，一律標記為 \`{{數字|單位}}\`。
  
  **[食材清單 (ingredients) 輸出範例 - 絕對遵守]**
  ❌ 錯誤示範：["牛番茄 4顆", "洋蔥 1顆", "翅小腿 10根"]
  ✅ 正確示範：["牛番茄 {{4|顆}}", "洋蔥 {{1|顆}}", "翅小腿 {{10|根}}"]
  
  **[作法步驟 (steps) 輸出範例 - 絕對遵守 (含食材變形與簡稱)]**
  *注意：當食材在步驟中改變稱呼或狀態（如：牛番茄變為「番茄塊」、洋蔥變為「洋蔥丁」、翅小腿變為「雞翅」），仍必須精準對應並插入原來的份量標記！*
  ❌ 錯誤示範：["加入洋蔥丁炒至焦黃色", "加入番茄塊炒至出水", "直接放入雞翅"] (漏掉標記)
  ✅ 正確示範：["加入洋蔥丁 {{1|顆}} 炒至焦黃色", "加入番茄塊 {{4|顆}} 炒至出水", "直接放入雞翅 {{10|根}}"]
  
  2. **絕對不標記不可縮放數值**：溫度、時間、容器尺寸等，如「燉煮一小時」必須保持原樣。
  3. **動態食材名稱標準化**：優先使用現有庫存目錄中的 \`subCategory\` 作為食材名稱。
     【使用者現有庫存目錄】：${inventoryVocabulary}
  4. **做法內嵌數量自我檢查**：完成 \`steps\` 生成後，請務必自我檢查：步驟中提到的「所有食材」（包含變形、切塊、簡稱），是否都已帶入 \`{{數字|單位}}\` 格式。
  5. **份量估算**：若無標示幾人份，請預估並回傳純數字給 \`servings\`（預設回傳 1 或 2）。
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
      Calculate estimated cost, weight, and nutrition.
      
      Recipe: ${recipe.name}
      Ingredients: ${JSON.stringify(recipe.ingredients)}
      Inventory Context: ${JSON.stringify(inventoryContext)}

      **[Rules]**
      1. Base prices on Premium Supermarkets.
      2. Conversions: 少許/適量=3g, 一大匙=15g, 一小匙=5g, 一碗=250g.
      3. Logic Priority: Inventory Context Price > AI Premium Price.
      4. Output JSON only. 'source' must be "inventory" or "ai".
    `;

    const response = await generateContentWithTimeout({
      model: "gemini-3.1-flash-lite",
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
    const response = await generateContentWithTimeout({
      model: "gemini-3.1-flash-lite",
      contents: { parts: [...imageParts, { text: `辨識圖片物品清單。若上傳多張照片，請自動交叉比對（例如：將照片A的商品正面與照片B的背面效期合併為同一筆資料）。\n${getCommonPromptRules(context?.categories || [], context?.historyNames || [])}` }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              matchedHistoryName: { type: Type.STRING, description: "若與歷史清單中的物品為同一實體，回傳完全一致的歷史名稱，否則留空。" },
              quantity: { type: Type.NUMBER },
              category: { type: Type.STRING },
              subCategory: { type: Type.STRING },
              location: { type: Type.STRING },
              expiryDate: { type: Type.STRING },
              packageSize: { type: Type.STRING },
              price: { type: Type.NUMBER },
              remarks: { type: Type.STRING }
            },
            required: ["name", "quantity", "category", "subCategory", "matchedHistoryName"]
          }
        }
      }
    });
    const parsed = JSON.parse(response.text || "[]");
    if (Array.isArray(parsed)) {
      parsed.forEach((aiResult: any) => {
        if (aiResult.name && aiResult.subCategory && !aiResult.name.includes(aiResult.subCategory) && !aiResult.subCategory.includes(aiResult.name)) {
          aiResult.name = aiResult.name + aiResult.subCategory;
        } else if (aiResult.name && aiResult.subCategory && aiResult.subCategory.includes(aiResult.name)) {
          aiResult.name = aiResult.subCategory; // 如果小分類比名稱更完整(例如綠咖哩醬 > 綠咖哩)，優先使用小分類
        }

        // [規格/容量 錯置修復]
        if (!aiResult.packageSize && aiResult.remarks) {
          const sizeMatch = aiResult.remarks.match(/(\d+(?:\.\d+)?\s*(?:ml|l|g|kg|oz|lb|入|件|包|瓶|罐|盒|片|粒|顆))/i);
          if (sizeMatch) {
            aiResult.packageSize = sizeMatch[0];
            aiResult.remarks = aiResult.remarks.replace(sizeMatch[0], '').replace(/^[,，\s]+|[,，\s]+$/g, '').trim();
          }
        }
      });
    }
    return parsed;
  } catch (error) { throw handleApiError(error); }
}

export async function inferItemDetailsFromText(itemName: string, context: any) {
  try {
    const ai = getGeminiClient();
    const response = await generateContentWithTimeout({
      model: "gemini-3.1-flash-lite",
      contents: { parts: [{ text: `推斷物品屬性：${itemName}。\n${getCommonPromptRules(context?.categories || [], context?.historyNames || [])}` }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            matchedHistoryName: { type: Type.STRING, description: "若與歷史清單中的物品為同一實體，回傳完全一致的歷史名稱，否則留空。" },
            quantity: { type: Type.NUMBER },
            category: { type: Type.STRING },
            subCategory: { type: Type.STRING },
            location: { type: Type.STRING },
            packageSize: { type: Type.STRING },
            remarks: { type: Type.STRING }
          },
          required: ["category", "subCategory", "quantity", "matchedHistoryName"]
        }
      }
    });
    const parsed = JSON.parse(response.text || "{}");
    if (parsed.name && parsed.subCategory && !parsed.name.includes(parsed.subCategory) && !parsed.subCategory.includes(parsed.name)) {
      parsed.name = parsed.name + parsed.subCategory;
    } else if (parsed.name && parsed.subCategory && parsed.subCategory.includes(parsed.name)) {
      parsed.name = parsed.subCategory;
    }

    // [規格/容量 錯置修復]
    if (!parsed.packageSize && parsed.remarks) {
      const sizeMatch = parsed.remarks.match(/(\d+(?:\.\d+)?\s*(?:ml|l|g|kg|oz|lb|入|件|包|瓶|罐|盒|片|粒|顆))/i);
      if (sizeMatch) {
        parsed.packageSize = sizeMatch[0];
        parsed.remarks = parsed.remarks.replace(sizeMatch[0], '').replace(/^[,，\s]+|[,，\s]+$/g, '').trim();
      }
    }
    return parsed;
  } catch (error) { throw handleApiError(error); }
}

export async function recognizeExpiryDate(base64Image: string): Promise<string | null> {
  try {
    const ai = getGeminiClient();
    const response = await generateContentWithTimeout({
      model: "gemini-3.1-flash-lite",
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
    const inventoryVocabulary = Array.from(new Set(inventoryItems.map(i => i.subCategory).filter(Boolean))).join(', ');

    // 將所有傳入的 Base64 圖片轉換為 Gemini 支援的格式
    const imageParts = base64Images.map(img => ({ inlineData: { data: img, mimeType: "image/jpeg" } }));

    const response = await generateContentWithTimeout({
      model: "gemini-3.1-flash-lite",
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
    const inventoryVocabulary = Array.from(new Set(inventoryItems.map(i => i.subCategory).filter(Boolean))).join(', ');

    // 防禦：限制輸入長度並清洗可能的惡意指令
    const safeText = text.slice(0, 3000).replace(/ignore all previous instructions/gi, '');

    const response = await generateContentWithTimeout({
      model: "gemini-3.1-flash-lite",
      contents: {
        parts: [{
          text: `Extract recipe data from: ${safeText}. ${getRecipeStrictPrompt(inventoryVocabulary)}
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

    const response = await generateContentWithTimeout({
      model: "gemini-3.1-flash-lite",
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

    const response = await generateContentWithTimeout({
      model: "gemini-3.1-flash-lite",
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

    const response = await generateContentWithTimeout({
      model: "gemini-3.1-flash-lite",
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
    // 防禦性處理：若 responseSchema 失效，手動清洗 Markdown 標記
    rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

    const parsed = JSON.parse(rawText);

    // 幻覺 ID 過濾機制：確保 AI 產生之食譜 ID 真實存在於資料庫中
    const validIds = new Set(recipes.map(r => r.id));
    if (parsed.plan && Array.isArray(parsed.plan)) {
      parsed.plan.forEach((day: any) => {
        if (Array.isArray(day.breakfast)) day.breakfast = day.breakfast.filter((id: string) => validIds.has(id));
        if (Array.isArray(day.lunch)) day.lunch = day.lunch.filter((id: string) => validIds.has(id));
        if (Array.isArray(day.dinner)) day.dinner = day.dinner.filter((id: string) => validIds.has(id));
      });
    }

    return parsed;
  } catch (error) { throw handleApiError(error); }
}