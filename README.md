# HomeStock (管家先生) v3.8 技術白皮書

本文件為 HomeStock 系統的唯一真理來源 (Single Source of Truth)，詳細記錄了 v3.8 版本的核心架構、資料定義、AI 實作細節與演算法邏輯。

---

## 1. AI 核心技術實作 (AI Implementation Details)

本系統深度整合 Google Gemini API (`gemini-3-flash-preview`)，所有的 AI 互動邏輯皆封裝於 `geminiService.ts`。為確保回應的穩定性與資料安全性，我們實作了以下技術規範：

### A. 強制 JSON 輸出模式 (Strict JSON Enforcement)
* **技術實作**：
    * 在呼叫 `generateContent` 時，配置 `responseMimeType: "application/json"`。
    * 定義嚴格的 `responseSchema` (OpenAPI 格式)，明確指定欄位型別 (`Type.STRING`, `Type.NUMBER`, `Type.ARRAY`) 與必填欄位 (`required`)。
* **效益**：
    * **杜絕幻覺**：強制模型僅回傳符合結構的 JSON 物件，防止 AI 輸出 Markdown 標記 (如 \`\`\`json) 或解釋性閒聊文字。
    * **解析穩定性**：前端直接使用 `JSON.parse()` 處理回應，無需編寫脆弱的 Regex 提取邏輯，大幅降低 Runtime Error。

### B. Prompt 工程與規則 (Prompt Engineering & Rules)
系統內建兩套核心 Prompt 模板，確保 AI 輸出的資料符合業務邏輯：

1.  **通用物品規則 (`COMMON_PROMPT_RULES`)**：
    * **大分類限制**：強制僅能使用白名單分類 `['食品', '雜貨', '藥品', '盥洗用品', '電子產品', '其他']`。
    * **名稱定義**：`name` 保留品牌與系列；`subCategory` (小分類) 必須提取物品本體名稱（如：將「瑞穗全脂鮮乳」拆解為 Name=瑞穗全脂鮮乳, Sub=鮮乳）。
    * **規格提取**：`packageSize` 優先從圖片或名稱中提取（如 500ml, 12入）。
    * **價格提取**：若無法從圖片辨識標價，則回傳 `0`。

2.  **食譜嚴格規則 (`RECIPE_STRICT_PROMPT`)**：
    * **步驟內嵌數量**：在 `steps` 敘述中提到食材時，**必須**將份量以括號嵌入，格式為「食材 (數量)」。
        * *範例*：「加入 高筋麵粉 (280g) 攪拌均勻」。
    * **事實導向**：若來源圖文無明確步驟，`steps` 必須回傳空陣列 `[]`，不可瞎掰。

### C. 價格與營養估算模型 (Smart Estimation Engine)
在 `estimateRecipeCostAndNutrition` 函式中，我們植入了具體的定錨邏輯與單位換算標準：

* **價格定錨 (Price Anchoring)**：
    * **基準**：若庫存無價格，一律以 **「頂級超市 / 有機商店 (如 Breeze Super, City'Super)」** 的物價為估算基準，確保預算寬裕。
    * **參考單價**：
        * 高品質雞蛋：12-15 TWD/顆
        * 有機雞胸肉：450-550 TWD/kg
        * 頂級鮮乳：100-120 TWD/936ml
* **模糊單位標準化 (Vague Unit Standardization)**：
    * `少許/適量 (Pinch/Some)` = **3g**
    * `一小匙 (Teaspoon)` = **5g / 5ml**
    * `一大匙 (Tablespoon)` = **15g / 15ml**
    * `一碗 (Bowl)` = **250g**
* **運算優先權**：
    1.  優先使用庫存 (`InventoryItem`) 的真實購入價格 (`price`)。
    2.  若庫存無價格或無此食材，才使用 AI 的定錨估算價。

### D. 標籤清洗機制 (Tag Sanitization)
為防止 AI 創造系統無法識別的篩選標籤，實作了 **雙重防護機制**：
1.  **Prompt Injection**：將使用者在 `Settings` 定義的 `availableTags` 注入 Prompt，指令：「You must select tags ONLY from this specific list」。
2.  **Code Filtering (`cleanTags`)**：AI 回傳後，前端執行 `cleanTags` 函式，比對白名單，**直接移除**任何不在清單內的標籤。

### E. 錯誤攔截與優雅降級 (Error Handling)
* **全域攔截**：透過 `handleApiError` 統一處理。
* **事件驅動 UI**：
    * 當偵測到 `403`, `400` 或 `API Key Missing` 等錯誤時，不拋出 Exception 導致崩潰。
    * 改為觸發 `window.dispatchEvent` 發送 `show-alert` 事件。
    * 前端監聽此事件，彈出 Modal 引導使用者前往「設定」頁面檢查 API Key。

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
* **關鍵字保護機制**：
    * 系統維護一份 **「嚴格單位白名單」** (g, ml, tsp, tbsp, 顆, 片...)。
    * 計算倍率時，僅縮放「數字 + 白名單單位」的組合。
    * **Regex 邏輯**：使用正規表達式 `new RegExp(\`(\\d+(?:\\.\\d+)?)\\s*(\${validUnits.join('|')})\`, 'gi')` 進行精確比對，確保與時間 (分/時)、溫度 (°C/度) 或設備設定 (速/段) 相關的數字**絕對不會**被錯誤放大。

### B. 智慧庫存對照 (Smart Matching)
在食譜頁面判斷「家裡有沒有這食材」時，採用 **雙重比對機制**：
1.  **Level 1: 小分類優先 (Sub-category Priority)**：
    * 若食譜需求為「全脂鮮乳」，而庫存某物品的 `subCategory` 為「鮮乳」，判定為 **Match**。這是最準確的比對方式。
2.  **Level 2: 名稱模糊比對 (Fuzzy Name Match)**：
    * 若無小分類，則將物品名稱正規化 (去除括號、數字、單位) 後進行字串包含比對。

### C. 懶人採購分析 (Cluster-Based Analytics)
* **問題**：使用者常忘記紀錄「消耗」，導致傳統庫存扣除算法失準。
* **解決方案**：系統改用「採購波次 (Shopping Cluster)」演算法。
    * **波次 (Cluster)**：將 5 天內 (`MERGE_WINDOW`) 連續發生的「入庫 (Restock)」視為同一次採購行程。
    * **燃燒率 (Burn Rate)**：`(區間總消耗量) / (第一次採購到最後一次採購的天數)`。
    * **優勢**：只要使用者記得記帳（入庫），系統就能推算出消耗速度與回購週期。

### D. 智慧效期燈號 (Smart Expiry Logic)
* **演算法**：基於 `expiryDate` 與當前日期的差值 (`diffDays`) 以及使用者設定的 `thresholdDays` (預設 30 天) 決定燈號。
    * 🔴 **紅燈 (Expired)**：`diffDays < 0` (已過期)。
    * 🟠 **橘燈 (Urgent)**：`diffDays <= 3` (剩餘 3 天內)。
    * 🟡 **黃燈 (Warning)**：`diffDays <= 7` (剩餘 7 天內)。
    * 🟢 **綠燈 (Safe)**：`diffDays > 7`。
    * **文字顯示**：系統會自動轉換為「剩 X 天」、「剩 X 週」、「剩 X 個月」或「剩 X 年」的人性化描述。

### E. AI 批次辨識佇列 (AI Batch Queue)
* **觸發條件**：在「新增物品」頁面一次上傳多張圖片 (上限 5 張)。
* **處理流程**：
    1.  **並行辨識**：AI 同時分析所有圖片，回傳物品陣列。
    2.  **佇列管理 (`batchQueue`)**：將辨識結果存入佇列，進入「批次確認模式」。
    3.  **逐一確認**：
        * 使用者審核當前物品 (Index 0)。
        * 點擊「確認，下一個」：儲存當前物品，UI 自動填入佇列中的下一項資料。
        * 點擊「跳過」：直接捨棄當前項目，載入下一項。
    4.  **結束條件**：佇列清空或使用者手動點擊「結束批次新增」。

### F. 補貨建議演算法 (Restock Recommendation)
* **觸發位置**：儀表板 (Dashboard) 的「建議補貨」區塊。
* **判斷邏輯**：
    1.  **分組**：將庫存物品依 `subCategory` (優先) 或 `name` 進行分組。
    2.  **總量計算**：加總該組所有批次的 `quantity`。
    3.  **閥值比對**：若 `totalQuantity < maxThreshold` (該組物品中設定的最大安全庫存量)，且 `maxThreshold > 0`，則列入建議補貨名單。
    4.  **優先級**：依據 `nextRestockDate` (預測補貨日) 排序，越早需要補貨的排越前面。

---

## 4. App 介面與功能細節 (Interface & Features)

本章節模擬軟體驗收規格，詳細列舉六大核心視圖的 UI 組成與互動邏輯。

### A. 儀表板 (Dashboard)
* **總覽卡片**：
    * **總物品數**：顯示庫存內不同物品的總數 (Group Count)。點擊跳轉至「庫存列表」。
    * **缺貨待補**：顯示建議補貨的物品數量。點擊跳轉至「採購清單」。
* **即將過期 (Expiring Soon)**：
    * 列出效期低於設定閥值的物品。
    * **互動**：點擊標題可展開/收合清單 (預設顯示前 3 筆)。
* **建議補貨 (Replenishment)**：
    * 列出低於安全庫存的物品。
    * **互動**：點擊「加入待買」按鈕，直接將該類別加入採購清單 (若已存在則按鈕反灰)。

### B. 庫存列表 (Inventory List)
* **搜尋與篩選 (Header Area)**：
    * **搜尋框**：支援即時過濾「物品名稱」與「存放位置」。
    * **多層級篩選器**：點擊漏斗圖示展開。支援「大分類 (Category)」與「小分類 (SubCategory)」的 **OR 邏輯** 複選。顯示各分類下的物品計數。
    * **排序功能**：支援「預設 (最後異動)」、「名稱 (A-Z)」、「效期 (最近優先)」。
    * **檢視模式**：可切換「庫存模式」與「心得模式 (Review Mode)」。若搜尋關鍵字命中某個小分類，心得模式會自動置頂該分類的精選心得。
    * **批次模式 (Batch Mode)**：啟用後，底部會出現浮動操作列 (`Fixed Bottom Bar`)。
        * **功能**：顯示已選數量，提供「+ 分類」與「+ 位置」按鈕，可一次性修改多個物品的屬性。
* **物品卡片 (Item Card)**：
    * **資訊展示**：名稱 (大字體)、分類/小分類、存放位置、原包裝規格、目前數量。
    * **效期燈號**：依據上述「智慧效期燈號」邏輯顯示顏色與文字。
    * **批次摺疊**：若同一物品有多個不同效期的批次，卡片預設摺疊，點擊後展開顯示各批次明細。
* **操作互動**：
    * **點擊**：展開/收合詳細資訊 (包含批次、價格、備註)。
    * **左滑 (Mobile)**：觸發紅色「刪除」按鈕 (單一滑動約束機制)。
    * **快速按鈕**：編輯、複製、開封 (紀錄 `openedDate` 為今日)、消耗 (數量 -1)、加入待買清單。

### C. 新增/編輯物品 (Add Item View)
* **AI 智慧辨識**：
    * **多圖上傳**：支援一次選擇最多 **5 張** 圖片。
    * **辨識內容**：名稱、數量、單位、分類、位置、效期。
* **表單欄位**：
    * **名稱**：支援歷史名稱自動完成 (AutoComplete)。
    * **數量/安全庫存**：數字輸入。
    * **規格/單價**：文字與數字輸入。
    * **分類/位置**：下拉選單 (支援自訂輸入)。
    * **日期**：
        * **有效期限**：支援「📷 掃描」按鈕，單獨啟動 OCR 辨識效期。
        * **開封日期**：支援「今天」按鈕，快速填入當日。
    * **備註/心得**：多行文字輸入。
* **批次佇列控制**：
    * 當 AI 辨識出多項物品時，頂部顯示「進度：X / Y」。
    * 底部按鈕變更為「跳過」與「確認，下一個」。

### D. 食譜與 AI 廚房 (Recipe View)
* **生成入口**：
    * **拍照轉食譜**：上傳圖片，AI 自動辨識菜名、食材與步驟。
    * **連結/文字分析**：貼上 YouTube 連結或純文字，AI 提取結構化食譜。
* **食譜詳情互動**：
    * **份量控制器 (Scale Controller)**：
        * 提供 `0.5x`, `1.0x`, `2.0x` 快速按鈕與自訂倍率輸入。
        * **連動範圍**：同時調整「食材列表的重量」與「步驟敘述中的數字」。
    * **庫存對照 (Stock Check)**：
        * 食材列表左側顯示庫存狀態。
        * 顯示：若有庫存則顯示「庫存總量: X」，若無則標示紅字「無庫存紀錄」。
    * **成本估算 (Cost Estimator)**：
        * 點擊「估算成本」按鈕觸發 AI。
        * 顯示：總成本 (TWD)、總重量 (g)、總熱量 (kcal) 與三大營養素 (蛋白/碳水/脂肪)。
        * **互動**：點擊個別食材的價格可進行 **手動修正 (Override)**，系統會重新計算總成本。
* **沉浸烹飪模式 (Immersive Cooking Mode)**：
    * 提供全螢幕的料理步驟指引。
    * **手勢操作**：移除實體按鈕，全面支援純手勢「左滑下一步、右滑上一步」。

### E. 採購清單 (Shopping List)
* **新增模式**：
    * **快速新增**：頂部輸入框輸入名稱，系統會根據歷史紀錄或關鍵字 **自動預測分類** (Predict Category)。
* **清單管理 (iOS 備忘錄風格)**：
    * 所有項目整合於單一無縫的白色圓角卡片中，項目間以極細灰線分隔。
    * **勾選互動**：點擊項目變為「已勾選」狀態 (灰色刪除線)，但**不會立即消失**。
    * **入庫邏輯**：清單項目僅在使用者於「庫存頁面」完成 **新增/入庫** 且名稱相符時，系統才會自動將其從採購清單中移除。

### F. 懶人分析 (Analysis View)
* **頻繁採購 (Frequency Tab)**：
    * **演算法**：基於「採購波次 (Cluster)」計算。
    * **指標**：顯示「平均回購週期 (天)」。僅顯示累積 2 次以上採購波次的物品。
    * **互動**：可調整「週期閥值」滑桿 (例如：只看 14 天內需回購的物品)。
* **庫存流動 (FSN Analysis)**：
    * **F (Fast)**：熱門消耗 (最後使用日在 7 天內)。
    * **S (Slow)**：長備品 (最後使用日在 30-90 天內)。
    * **N (Non-moving)**：滯銷品 (最後使用日超過 90 天)。
* **浪費檢討 (Waste Tab)**：
    * 統計近 6 個月的「報廢 (Scrap)」紀錄。
    * 顯示「浪費率」= `報廢量 / (報廢量 + 使用量)`。

### G. 設定 (Settings)
* **資料管理**：
    * **系統備份 (JSON)**：完整匯出所有資料 (含設定、圖片 Base64)。支援「智能合併 (Merge)」或「完全覆蓋 (Overwrite)」還原。
    * **Excel 報表**：匯出 Raw Data 供外部分析。支援從 Excel 匯入資料。
    * **重置**：清除所有 LocalStorage 資料。
* **參數設定**：
    * **API Key**：輸入 Google Gemini API Key (本地儲存)。
    * **過期提醒**：設定提前幾天顯示黃燈/紅燈 (預設 30 天)。
    * **標籤管理**：自訂食譜的 Tag 階層 (主標籤 -> 子標籤)。

---

## 5. 系統架構與設計規範

* **Local-First 架構**：所有資料 (含圖片 Base64) 儲存於 `localStorage`，無後端伺服器。
* **iOS 原生頂級視覺設計規範 (Premium Native iOS System)**：
    全面導入現代 Apple Native App（如 Health, Settings, Notes）的設計語彙，確立了「清透、立體、極簡扁平」的核心基調。

    * **幾何導角與形狀 (Geometry & Shapes)**：
        * **膠囊化 (Capsule)**：單行輸入框、按鈕、標籤與 Navbar 全數升級為絕對圓角 (`rounded-full`)。
        * **超大圓角卡片 (Squircle)**：主容器與彈窗 (Modal) 採用 `rounded-[32px]`，完美貼合現代手機的螢幕物理圓角。
    
    * **材質與光影 (Material & Lighting)**：
        * **極致毛玻璃 (Maximized Glassmorphism)**：將 `backdrop-blur-[40px] backdrop-saturate-150` 的頂級毛玻璃材質套用於所有外層主卡片與動態導覽列。
        * **主客層次 (Main/Sub Hierarchy)**：外層容器負責華麗的漸層玻璃邊框與立體陰影；內層資訊區塊 (如食材清單、表單內容) 則回歸「極簡白板 (Flat White)」，確保內容清晰易讀。
        * **扁平化原廠藍 (Native Flat UI)**：徹底移除舊版的果凍感邊框，所有主要按鈕與 Focus 狀態皆回歸純粹的 Apple 原廠藍 (`#007AFF`)，搭配輕柔的外擴光暈 (`shadow-[0_4px_12px_rgba...]`)。

    * **原生手勢與互動控制 (Native Gestures & Controls)**：
        * **單一滑動約束 (Single-Active Swipe)**：全局實作狀態上提 (Lift State Up)，確保列表介面「同時間只會有一張卡片被左滑刪除」，滑動新卡片時舊卡片自動復原。
        * **沉浸式滑動 (Immersive Swipe)**：食譜烹飪模式拔除所有實體按鈕，改為「左滑下一步、右滑上一步」的全螢幕直覺手勢操作。
        * **隱形觸控回饋 (Tap Highlight)**：底層 CSS 寫入 `-webkit-tap-highlight-color: transparent` 與 `user-select: none`，消除瀏覽器點擊閃爍。
        * **iOS 細捲軸 (Invisible Scrollbar)**：全域採用 `custom-scrollbar`，將預設粗黑捲軸改為高質感的細緻圓角隱形線條。

    * **iOS Safari 深度適配 (Safari Optimization)**：
        * 修復 `input[type="date"]` 造成的寬度擠壓與高度塌陷，強制套用 `appearance-none` 與 `min-w-0` 覆蓋原廠硬性規定。
        * 修復底部彈窗 (Bottom Sheet) 遭 Navbar 遮擋問題，導入懸浮式卡片設計並設定 `z-[200]` 極高層級。

---

## 6. 更新日誌 (Changelog)

### [2026-02-25] iOS 原生級體驗深度優化 (Native iOS Experience)
* **全域 UI 統一**：徹底落實「外層頂級毛玻璃 + 內層極簡扁平白板」的 Apple 原廠標準，拔除多餘的果凍光影。
* **手勢互動 (Gestures)**：
    * 實作「全局單一滑動約束 (Single-active Swipe)」，確保列表左滑刪除時，其他卡片會自動彈回，還原原生 App 手感。
    * 食譜「沉浸烹飪模式」升級，拔除實體按鈕，改為純「左右滑動 (Swipe Left/Right)」切換步驟。
* **iOS Safari 深度適配**：
    * 徹底解決 `AddItemView` 中日期輸入框 (`type="date"`) 的寬度擠壓與高度塌陷問題 (`min-w-0`, `appearance-none`)。
    * 加入全域底層 CSS，消除點擊閃爍 (`Tap Highlight`) 並實作 iOS 質感細捲軸 (`custom-scrollbar`)。
* **彈窗與層級排版 (Modals)**：
    * 修正檢視設定彈窗的毛玻璃溢出 (Overflow) 與底部 Navbar 遮擋問題 (拉高層級至 `z-[200]`)。
    * 待買清單 (Shopping List) 升級為 Apple 備忘錄風格 (Grouped List)，將多個獨立項目無縫合併至單一圓角大卡片中。
* **邏輯除錯 (Bug Fixes)**：移除刪除物品與食譜時發生的「雙重確認彈窗 (Double Prompt)」，統一交由外層路由進行詳細防呆保護。

