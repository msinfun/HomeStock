
# HomeStock (管家先生) v3.8 技術白皮書

本文件為 HomeStock 系統的唯一真理來源 (Single Source of Truth)，詳細記錄了 v3.8 版本的核心架構、資料定義、AI 實作細節與演算法邏輯。

---

## 1. AI 核心技術實作 (AI Implementation Details)

本系統深度整合 Google Gemini API (`gemini-3-flash-preview`)，所有的 AI 互動邏輯皆封裝於 `geminiService.ts`。為確保回應的穩定性與資料安全性，我們實作了以下技術規範：

### A. 強制 JSON 輸出模式 (Strict JSON Enforcement)
*   **技術實作**：
    *   在呼叫 `generateContent` 時，配置 `responseMimeType: "application/json"`。
    *   定義嚴格的 `responseSchema` (OpenAPI 格式)，明確指定欄位型別 (`Type.STRING`, `Type.NUMBER`, `Type.ARRAY`) 與必填欄位 (`required`)。
*   **效益**：
    *   **杜絕幻覺**：強制模型僅回傳符合結構的 JSON 物件，防止 AI 輸出 Markdown 標記 (如 \`\`\`json) 或解釋性閒聊文字。
    *   **解析穩定性**：前端直接使用 `JSON.parse()` 處理回應，無需編寫脆弱的 Regex 提取邏輯，大幅降低 Runtime Error。

### B. Prompt 工程與規則 (Prompt Engineering & Rules)
系統內建兩套核心 Prompt 模板，確保 AI 輸出的資料符合業務邏輯：

1.  **通用物品規則 (`COMMON_PROMPT_RULES`)**：
    *   **大分類限制**：強制僅能使用白名單分類 `['食品', '雜貨', '藥品', '盥洗用品', '電子產品', '其他']`。
    *   **名稱定義**：`name` 保留品牌與系列；`subCategory` (小分類) 必須提取物品本體名稱（如：將「瑞穗全脂鮮乳」拆解為 Name=瑞穗全脂鮮乳, Sub=鮮乳）。
    *   **規格提取**：`packageSize` 優先從圖片或名稱中提取（如 500ml, 12入）。
    *   **價格提取**：若無法從圖片辨識標價，則回傳 `0`。

2.  **食譜嚴格規則 (`RECIPE_STRICT_PROMPT`)**：
    *   **步驟內嵌數量**：在 `steps` 敘述中提到食材時，**必須**將份量以括號嵌入，格式為「食材 (數量)」。
        *   *範例*：「加入 高筋麵粉 (280g) 攪拌均勻」。
    *   **事實導向**：若來源圖文無明確步驟，`steps` 必須回傳空陣列 `[]`，不可瞎掰。

### C. 價格與營養估算模型 (Smart Estimation Engine)
在 `estimateRecipeCostAndNutrition` 函式中，我們植入了具體的定錨邏輯與單位換算標準：

*   **價格定錨 (Price Anchoring)**：
    *   **基準**：若庫存無價格，一律以 **「頂級超市 / 有機商店 (如 Breeze Super, City'Super)」** 的物價為估算基準，確保預算寬裕。
    *   **參考單價**：
        *   高品質雞蛋：12-15 TWD/顆
        *   有機雞胸肉：450-550 TWD/kg
        *   頂級鮮乳：100-120 TWD/936ml
*   **模糊單位標準化 (Vague Unit Standardization)**：
    *   `少許/適量 (Pinch/Some)` = **3g**
    *   `一小匙 (Teaspoon)` = **5g / 5ml**
    *   `一大匙 (Tablespoon)` = **15g / 15ml**
    *   `一碗 (Bowl)` = **250g**
*   **運算優先權**：
    1.  優先使用庫存 (`InventoryItem`) 的真實購入價格 (`price`)。
    2.  若庫存無價格或無此食材，才使用 AI 的定錨估算價。

### D. 標籤清洗機制 (Tag Sanitization)
為防止 AI 創造系統無法識別的篩選標籤，實作了 **雙重防護機制**：
1.  **Prompt Injection**：將使用者在 `Settings` 定義的 `availableTags` 注入 Prompt，指令：「You must select tags ONLY from this specific list」。
2.  **Code Filtering (`cleanTags`)**：AI 回傳後，前端執行 `cleanTags` 函式，比對白名單，**直接移除**任何不在清單內的標籤。

### E. 錯誤攔截與優雅降級 (Error Handling)
*   **全域攔截**：透過 `handleApiError` 統一處理。
*   **事件驅動 UI**：
    *   當偵測到 `403`, `400` 或 `API Key Missing` 等錯誤時，不拋出 Exception 導致崩潰。
    *   改為觸發 `window.dispatchEvent` 發送 `show-alert` 事件。
    *   前端監聽此事件，彈出 Modal 引導使用者前往「設定」頁面檢查 API Key。

---

## 2. 資料字典 (Data Dictionary)

### A. 庫存物品 (InventoryItem)
系統核心資料單元，對應 `types.ts` 中的介面定義：

| 欄位名稱 | 型別 (Type) | 必填 | 說明與用途 |
| :--- | :--- | :--- | :--- |
| `id` | `string` | Yes | 唯一識別碼 (UUID 或 Timestamp 生成)。 |
| `name` | `string` | Yes | 物品顯示名稱。 |
| `subCategory` | `string` | No | **小分類**。核心欄位，用於「庫存對照」與「採購分析」的聚合計算。(例：不同品牌的鮮乳統一歸類為「鮮乳」)。 |
| `category` | `string` | Yes | 主分類 (如：食品、雜貨)。 |
| `quantity` | `number` | Yes | 總數量 (整數)。 |
| `packageSize` | `string` | No | **原包裝規格**。如 "1kg", "500ml", "12入"。由 AI 自動提取或手動輸入。 |
| `price` | `number` | No | **購入成本**。單價，用於食譜成本估算時的優先依據。 |
| `expiryDate` | `string` | No | 有效期限 (Format: `YYYY-MM-DD`)。 |
| `openedDate` | `string` | No | 開封日期 (Format: `YYYY-MM-DD`)。 |
| `location` | `string` | Yes | 存放位置 (如：冰箱冷藏)。 |
| `review` | `string` | No | **使用心得/筆記**。記錄口味評價或回購意願。 |
| `batches` | `Array` | Yes | 批次陣列 `[{ expiryDate, quantity }]`，支援同物品不同效期的管理。 |

### B. 食譜 (Recipe)
| 欄位名稱 | 型別 | 說明 |
| :--- | :--- | :--- |
| `ingredients` | `string[]` | 食材清單 (如 "雞胸肉 200g")。 |
| `steps` | `string` | 步驟說明 (支援 `\n` 換行)。 |
| `tags` | `string[]` | 標籤 (受白名單限制)。 |
| `scaleFactor` | `number` | **動態倍率** (UI 運算欄位)。預設 1.0，用於即時計算食材份量。 |

---

## 3. 核心演算法與業務邏輯 (Core Logic)

### A. 動態份量縮放 (Smart Scaling Engine)
*   **關鍵字保護機制**：
    *   系統維護一份 **「嚴格單位白名單」** (g, ml, tsp, tbsp, 顆, 片...)。
    *   計算倍率時，僅縮放「數字 + 白名單單位」的組合。
    *   **Regex 邏輯**：使用正規表達式 `new RegExp(\`(\\d+(?:\\.\\d+)?)\\s*(\${validUnits.join('|')})\`, 'gi')` 進行精確比對，確保與時間 (分/時)、溫度 (°C/度) 或設備設定 (速/段) 相關的數字**絕對不會**被錯誤放大。

### B. 智慧庫存對照 (Smart Matching)
在食譜頁面判斷「家裡有沒有這食材」時，採用 **雙重比對機制**：
1.  **Level 1: 小分類優先 (Sub-category Priority)**：
    *   若食譜需求為「全脂鮮乳」，而庫存某物品的 `subCategory` 為「鮮乳」，判定為 **Match**。這是最準確的比對方式。
2.  **Level 2: 名稱模糊比對 (Fuzzy Name Match)**：
    *   若無小分類，則將物品名稱正規化 (去除括號、數字、單位) 後進行字串包含比對。

### C. 懶人採購分析 (Cluster-Based Analytics)
*   **問題**：使用者常忘記紀錄「消耗」，導致傳統庫存扣除算法失準。
*   **解決方案**：系統改用「採購波次 (Shopping Cluster)」演算法。
    *   **波次 (Cluster)**：將 5 天內 (`MERGE_WINDOW`) 連續發生的「入庫 (Restock)」視為同一次採購行程。
    *   **燃燒率 (Burn Rate)**：`(區間總消耗量) / (第一次採購到最後一次採購的天數)`。
    *   **優勢**：只要使用者記得記帳（入庫），系統就能推算出消耗速度與回購週期。

### D. 智慧效期燈號 (Smart Expiry Logic)
*   **演算法**：基於 `expiryDate` 與當前日期的差值 (`diffDays`) 以及使用者設定的 `thresholdDays` (預設 30 天) 決定燈號。
    *   🔴 **紅燈 (Expired)**：`diffDays < 0` (已過期)。
    *   🟠 **橘燈 (Urgent)**：`diffDays <= 3` (剩餘 3 天內)。
    *   🟡 **黃燈 (Warning)**：`diffDays <= 7` (剩餘 7 天內)。
    *   🟢 **綠燈 (Safe)**：`diffDays > 7`。
    *   **文字顯示**：系統會自動轉換為「剩 X 天」、「剩 X 週」、「剩 X 個月」或「剩 X 年」的人性化描述。

### E. AI 批次辨識佇列 (AI Batch Queue)
*   **觸發條件**：在「新增物品」頁面一次上傳多張圖片 (上限 5 張)。
*   **處理流程**：
    1.  **並行辨識**：AI 同時分析所有圖片，回傳物品陣列。
    2.  **佇列管理 (`batchQueue`)**：將辨識結果存入佇列，進入「批次確認模式」。
    3.  **逐一確認**：
        *   使用者審核當前物品 (Index 0)。
        *   點擊「確認，下一個」：儲存當前物品，UI 自動填入佇列中的下一項資料。
        *   點擊「跳過」：直接捨棄當前項目，載入下一項。
    4.  **結束條件**：佇列清空或使用者手動點擊「結束批次新增」。

### F. 補貨建議演算法 (Restock Recommendation)
*   **觸發位置**：儀表板 (Dashboard) 的「建議補貨」區塊。
*   **判斷邏輯**：
    1.  **分組**：將庫存物品依 `subCategory` (優先) 或 `name` 進行分組。
    2.  **總量計算**：加總該組所有批次的 `quantity`。
    3.  **閥值比對**：若 `totalQuantity < maxThreshold` (該組物品中設定的最大安全庫存量)，且 `maxThreshold > 0`，則列入建議補貨名單。
    4.  **優先級**：依據 `nextRestockDate` (預測補貨日) 排序，越早需要補貨的排越前面。

---

## 4. App 介面與功能細節 (Interface & Features)

本章節模擬軟體驗收規格，詳細列舉六大核心視圖的 UI 組成與互動邏輯。

### A. 儀表板 (Dashboard)
*   **總覽卡片**：
    *   **總物品數**：顯示庫存內不同物品的總數 (Group Count)。點擊跳轉至「庫存列表」。
    *   **缺貨待補**：顯示建議補貨的物品數量。點擊跳轉至「採購清單」。
*   **即將過期 (Expiring Soon)**：
    *   列出效期低於設定閥值的物品。
    *   **互動**：點擊標題可展開/收合清單 (預設顯示前 3 筆)。
*   **建議補貨 (Replenishment)**：
    *   列出低於安全庫存的物品。
    *   **互動**：點擊「加入待買」按鈕，直接將該類別加入採購清單 (若已存在則按鈕反灰)。

### B. 庫存列表 (Inventory List)
*   **搜尋與篩選 (Header Area)**：
    *   **搜尋框**：支援即時過濾「物品名稱」與「存放位置」。
    *   **多層級篩選器**：點擊漏斗圖示展開。支援「大分類 (Category)」與「小分類 (SubCategory)」的 **OR 邏輯** 複選。顯示各分類下的物品計數。
    *   **排序功能**：支援「預設 (最後異動)」、「名稱 (A-Z)」、「效期 (最近優先)」。
    *   **檢視模式**：可切換「庫存模式」與「心得模式 (Review Mode)」。若搜尋關鍵字命中某個小分類，心得模式會自動置頂該分類的精選心得。
    *   **批次模式 (Batch Mode)**：啟用後，底部會出現浮動操作列 (`Fixed Bottom Bar`)。
        *   **功能**：顯示已選數量，提供「+ 分類」與「+ 位置」按鈕，可一次性修改多個物品的屬性。
*   **物品卡片 (Item Card)**：
    *   **資訊展示**：名稱 (大字體)、分類/小分類、存放位置、原包裝規格、目前數量。
    *   **效期燈號**：依據上述「智慧效期燈號」邏輯顯示顏色與文字。
    *   **批次摺疊**：若同一物品有多個不同效期的批次，卡片預設摺疊，點擊後展開顯示各批次明細。
*   **操作互動**：
    *   **點擊**：展開/收合詳細資訊 (包含批次、價格、備註)。
    *   **左滑 (Mobile)**：觸發紅色「刪除」按鈕 (門檻值 70px)。
    *   **快速按鈕**：編輯、複製、開封 (紀錄 `openedDate` 為今日)、消耗 (數量 -1)、加入待買清單。

### C. 新增/編輯物品 (Add Item View)
*   **AI 智慧辨識**：
    *   **多圖上傳**：支援一次選擇最多 **5 張** 圖片。
    *   **辨識內容**：名稱、數量、單位、分類、位置、效期。
*   **表單欄位**：
    *   **名稱**：支援歷史名稱自動完成 (AutoComplete)。
    *   **數量/安全庫存**：數字輸入。
    *   **規格/單價**：文字與數字輸入。
    *   **分類/位置**：下拉選單 (支援自訂輸入)。
    *   **日期**：
        *   **有效期限**：支援「📷 掃描」按鈕，單獨啟動 OCR 辨識效期。
        *   **開封日期**：支援「今天」按鈕，快速填入當日。
    *   **備註/心得**：多行文字輸入。
*   **批次佇列控制**：
    *   當 AI 辨識出多項物品時，頂部顯示「進度：X / Y」。
    *   底部按鈕變更為「跳過」與「確認，下一個」。

### D. 食譜與 AI 廚房 (Recipe View)
*   **生成入口**：
    *   **拍照轉食譜**：上傳圖片，AI 自動辨識菜名、食材與步驟。
    *   **連結/文字分析**：貼上 YouTube 連結或純文字，AI 提取結構化食譜。
*   **食譜詳情互動**：
    *   **份量控制器 (Scale Controller)**：
        *   提供 `0.5x`, `1.0x`, `2.0x` 快速按鈕與自訂倍率輸入。
        *   **連動範圍**：同時調整「食材列表的重量」與「步驟敘述中的數字」。
    *   **庫存對照 (Stock Check)**：
        *   食材列表左側顯示庫存狀態。
        *   顯示：若有庫存則顯示「庫存總量: X」，若無則標示紅字「無庫存紀錄」。
    *   **成本估算 (Cost Estimator)**：
        *   點擊「估算成本」按鈕觸發 AI。
        *   顯示：總成本 (TWD)、總重量 (g)、總熱量 (kcal) 與三大營養素 (蛋白/碳水/脂肪)。
        *   **互動**：點擊個別食材的價格可進行 **手動修正 (Override)**，系統會重新計算總成本。

### E. 採購清單 (Shopping List)
*   **新增模式**：
    *   **快速新增**：頂部輸入框輸入名稱，系統會根據歷史紀錄或關鍵字 **自動預測分類** (Predict Category)。
*   **清單管理**：
    *   **分類顯示**：顯示物品名稱、分類、加入日期。
    *   **勾選互動**：點擊項目變為「已勾選」狀態 (灰色刪除線)，但**不會立即消失**。
    *   **入庫邏輯**：清單項目僅在使用者於「庫存頁面」完成 **新增/入庫** 且名稱相符時，系統才會自動將其從採購清單中移除。
    *   **左滑刪除**：強制移除不打算購買的項目。

### F. 懶人分析 (Analysis View)
*   **頻繁採購 (Frequency Tab)**：
    *   **演算法**：基於「採購波次 (Cluster)」計算。
    *   **指標**：顯示「平均回購週期 (天)」。僅顯示累積 2 次以上採購波次的物品。
    *   **互動**：可調整「週期閥值」滑桿 (例如：只看 14 天內需回購的物品)。
*   **庫存流動 (FSN Analysis)**：
    *   **F (Fast)**：熱門消耗 (最後使用日在 7 天內)。
    *   **S (Slow)**：長備品 (最後使用日在 30-90 天內)。
    *   **N (Non-moving)**：滯銷品 (最後使用日超過 90 天)。
*   **浪費檢討 (Waste Tab)**：
    *   統計近 6 個月的「報廢 (Scrap)」紀錄。
    *   顯示「浪費率」= `報廢量 / (報廢量 + 使用量)`。

### G. 設定 (Settings)
*   **資料管理**：
    *   **系統備份 (JSON)**：完整匯出所有資料 (含設定、圖片 Base64)。支援「智能合併 (Merge)」或「完全覆蓋 (Overwrite)」還原。
    *   **Excel 報表**：匯出 Raw Data 供外部分析。支援從 Excel 匯入資料。
    *   **重置**：清除所有 LocalStorage 資料。
*   **參數設定**：
    *   **API Key**：輸入 Google Gemini API Key (本地儲存)。
    *   **過期提醒**：設定提前幾天顯示黃燈/紅燈 (預設 30 天)。
    *   **標籤管理**：自訂食譜的 Tag 階層 (主標籤 -> 子標籤)。

---

## 5. 系統架構與設計規範

* **Local-First 架構**：所有資料 (含圖片 Base64) 儲存於 `localStorage`，無後端伺服器。
* **iOS 26 頂級視覺設計規範 (Premium Visual System)**：
    本次升級全面導入現代 Apple Native App（如 Apple Health, Fitness, 系統設定）的設計語彙，確立了「清透、立體、圓潤」的三大核心基調。

    * **幾何導角與形狀 (Geometry & Shapes)**：
        * **膠囊化 (Pill-Shape/Capsule)**：全站所有的單行輸入框 (`input`)、操作按鈕 (`button`)、標籤 (`tags`) 與導覽列，全數升級為絕對圓角 (`rounded-full`)，提供最滑順的視覺引導。
        * **超大圓角卡片 (Squircle)**：主容器、彈出視窗 (Modal) 採用 `rounded-[32px]`；列表內部卡片採用 `rounded-[28px]` 或 `rounded-[24px]`，形成柔和的「卡片包卡片」層次。
    
    * **材質與光影 (Material & Lighting)**：
        * **頂級毛玻璃 (Advanced Glassmorphism)**：大量運用 `bg-white/70` 搭配 `backdrop-blur-xl` 到 `2xl` 的磨砂玻璃濾鏡（套用於 Navbar、頂部搜尋列、Modal 背景）。在頁面滑動時，底層卡片的顏色能柔和地透出。
        * **細亮邊界 (Fine Highlight Borders)**：徹底捨棄死板的灰色邊框。所有玻璃卡片與輸入框皆加上 `border border-white/80` 或 `ring-1 ring-white/20`，模擬真實玻璃切邊的反光質感。
        * **3D 立體按鈕 (Tactile Buttons)**：主推按鈕 (Primary CTA) 引入實體光影感。利用 `border-t border-l border-white/40` 創造左上高光，`border-b border-r border-black/10` 創造右下暗角，並輔以有色外擴發光 (`shadow-[0_8px_20px_rgba(0,122,255,0.3)]`)。

    * **字體層級 (Typography)**：
        * 全站統一使用 SF Pro 風格 (System Sans)。
        * **數據與大標題 (Data Metrics)**：導入 `font-black` (極粗體) 搭配 `tracking-tighter` (緊湊字距)，營造出極具張力的現代儀表板風格。
        * **輔助標籤 (Labels)**：使用 `text-[10px] uppercase tracking-widest font-black`，讓微小的分類標籤具有如同雷射雕刻般的精緻感。

    * **動態與互動設計 (Motion & Interaction)**：
        * **骨架屏過場 (Skeleton Loading)**：在等待 AI 運算（如估算成本）時，以呼吸閃爍的灰色色塊佈局 (`animate-pulse`) 取代傳統的轉圈圈，有效降低使用者的「體感等待時間 (Perceived Wait Time)」。
        * **沉浸式觸控回饋**：所有可點擊元素均實作 `active:scale-[0.96] transition-all`，提供如按壓實體按鍵般的微縮物理回饋。
        * **動態懸浮列 (Dynamic Floating Menu)**：移除了佔據空間的置頂搜尋列，改為滾動時自然隱藏、點擊時優雅展開的膠囊狀懸浮圖示，將螢幕空間最大化還給內容。

    * **資料視覺化 (Data Visualization)**：
        * **Apple Health 風格卡片**：AI 成本與營養估算結果，採用鮮豔的漸層果凍色塊（如翡翠綠代表成本、活力橘代表熱量，輔以透明底色的三大營養素區塊），打破傳統沉悶的數據排版。

    * **佈局原則 (Layout)**：
        * **Global Width Alignment (全局零公差對齊)**：嚴格控管 `padding` 與 `margin`，確保 Dashboard (總覽)、Inventory (庫存)、Recipe (食譜) 與 Shopping (待買) 的主卡片寬度達到 100% 像素級切齊。

---

## 6. 更新日誌 (Changelog)

### [2026-02-24] 全面進化：iOS 26 頂級質感與互動升級
* **視覺重構 (Visual Overhaul)**：
    * **全域形狀進化**：按鈕、輸入框、標籤、Navbar 全數升級為 `rounded-full` (膠囊形狀)；卡片與 Modal 升級為 `rounded-[32px]` 大圓角。
    * **材質大升級**：全面導入深度毛玻璃 (`backdrop-blur-2xl`) 與擬真玻璃亮邊 (`border-white/80`)，並為主要按鈕加上 3D 光暈與實體切邊效果。
    * **字體排版**：全面升級數據顯示，採用 `font-black` 與緊湊字距，強化系統原生感。
* **UX/互動優化 (UX Improvements)**：
    * **動態搜尋列**：`InventoryList` 與 `RecipeView` 導入動態懸浮操作列，預設以小圖示呈現，點擊展開，釋放大量螢幕空間。
    * **骨架屏載入 (Skeleton UI)**：食譜的「估算成本與營養」導入 Apple Health 風格的漸層果凍卡片，並在 AI 運算期間加入骨架屏閃爍動畫，完美消除等待焦慮。
    * **全域寬度對齊**：修正了各頁面間的內距 (Padding) 公差，確保所有列表卡片寬度達到 100% 視覺統一。
    * **錯誤防呆 (Error Boundary)**：為 AI 估算功能加上 `503 伺服器忙碌` 專屬防呆彈窗，避免畫面卡死。

### [2026-02-21] Code-to-Docs Deep Sync (文件深度同步)
* **全域盤點**：完成所有 View 層程式碼 (`.tsx`) 與邏輯層 (`.ts`) 的深度審計，將程式碼中的隱性邏輯顯性化為文件。
* **邏輯揭露**：
    * 新增 **智慧效期燈號演算法**：明確定義紅/橘/黃/綠燈的天數閥值。
    * 新增 **AI 批次佇列機制**：詳解多圖辨識後的 Skip/Next 互動流程。
    * 新增 **補貨建議邏輯**：揭露 Dashboard 基於 `minThreshold` 與 `subCategory` 分組的推算公式。
    * 新增 **食譜縮放 Regex**：公開份量縮放的正規表達式與單位白名單保護機制。
* **介面細節**：
    * 補完 **Dashboard** 章節。
    * 補完 **InventoryList** 的批次操作 UI (Floating Bar) 與心得模式置頂邏輯。
    * 補完 **AddItemView** 的圖片上限 (5張) 與日期掃描功能。

### [2026-02-20] AI 技術規格深度補完
* **文件升級**：依據 `geminiService.ts` 原始碼，完整補完「AI 核心技術實作」章節。
* **細節揭露**：
    * 新增 **Prompt 規則** 詳解：包含通用物品的大分類限制、食譜步驟的數量內嵌格式。
    * 新增 **價格估算邏輯**：公開「頂級超市」定錨標準與「模糊單位 (如少許、一碗)」的換算係數。
    * 新增 **錯誤處理機制**：說明 API 錯誤攔截與 `show-alert` 事件驅動流程。

### [2026-02-19] 系統文件與技術規格升級
* **文件更新**：大幅擴充 `README.md`，新增「AI 核心技術實作」章節（含 JSON Mode、Schema 定義、錯誤攔截機制）。
* **資料定義**：補完 `InventoryItem` 資料字典，詳細定義 `packageSize`, `price`, `review` 等欄位型別與用途。
* **規範明細**：明列 AI 判斷的 Prompt 規則（如 Tag 白名單、動態份量保護機制）。

### [2026-02-18] 手機版 UI 與分析邏輯修復
* **UI 修正**：`AddItemView` 與 `ShoppingList` 針對手機版進行間距微調 (`gap-2`, `pt-4`)，解決跑版問題。
* **演算法更新**：`AnalysisView` 導入「採購波次 (Cluster)」算法，優化懶人記帳體驗。
* **代碼重構**：移除已棄用的資料欄位 (`avgCycle`, `isAutoAddedToShoppingList`)。