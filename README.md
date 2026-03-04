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

### C. 從正則防禦躍升為 AI 智慧標記 (AI Tagging)
*   **技術痛點與轉型**：傳統依靠 `Regex` 與白名單過濾的防禦機制，經常誤殺非食材的數字（如「烤箱 180度」、「模具 28x28cm」、「翻面 2次」），導致配方倍率縮放時引發災難性的邏輯錯誤。
*   **Prompt 強制標記實作**：在 `RECIPE_STRICT_PROMPT` 中，我們徹底揚棄讓前端無腦判斷的正則方式，改為在 Prompt 中強制要求 AI 在所有**可縮放的食材份量**上打上底層標記 `{{數字|單位}}`（例如：`{{60|g}}`, `{{1.5|大匙}}`, `{{2}}`）。
*   **絕對精準**：這項架構躍升將 100% 的判斷權交給了 LLM 卓越的語意理解能力，完美避開了邊界誤判，實現了絕對穩定、無死角的動態縮放引擎。

### D. 價格與營養估算模型 (Smart Estimation Engine)
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

### E. 標籤清洗機制 (Tag Sanitization)
為防止 AI 創造系統無法識別的篩選標籤，實作了 **雙重防護機制**：
1.  **Prompt Injection**：將使用者在 `Settings` 定義的 `availableTags` 注入 Prompt，指令：「You must select tags ONLY from this specific list」。
2.  **Code Filtering (`cleanTags`)**：AI 回傳後，前端執行 `cleanTags` 函式，比對白名單，**直接移除**任何不在清單內的標籤。

### F. 錯誤攔截與優雅降級 (Error Handling)
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

### A. 究極縮放解析引擎 (Ultimate Scaling Engine)
*   **範圍與複雜數值支援**：`scaleString` 函式全面迎來演算法升級，搭配 AI 智慧標記引擎，系統現在完美支援**「帶分數 (如 1 1/4)」**以及更複雜的**「範圍數值 (如 50-100, 2~3)」**的解析與即時動態乘法運算。
*   **浮點數精度控制**：解決了 JavaScript 底層浮點數乘法的精度誤差，並自動消除整數後方多餘的零（例如將 `120.00g` 優雅地渲染為 `120g`）。
*   **分享格式優化 (Clean Share)**：當使用者複製食譜準備分享至 LINE 或是其他社群軟體時，系統會在 `handleShareRecipe` 中自動啟動 `removeTags` 清洗機制，脫掉 AI 的 `{{ }}` 標記外衣，將其無痕還原為自然語言（例如將 `{{225|g}}` 還原為 `225g`），兼顧了系統運算的嚴謹度與外部傳播的最佳閱讀體驗。

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
    *   **文字顯示**：自動轉換為「剩 X 天」、「剩 X 週」或「剩 X 個月」的人性化描述。

### E. AI 批次辨識佇列 (AI Batch Queue)
*   **並行處理與確認佇列**：
    *   支援上傳最高 **5 張** 圖片，AI 同時分析所有圖片的物品資訊。
    *   辨識完成後載入「批次確認模式」，使用者逐一審核佇列 (Index 0)。
    *   可點擊「確認，下一個」入庫並拉取新資料；或點擊「跳過」捨棄資料。

### F. 補貨建議演算法 (Restock Recommendation)
*   **判斷邏輯**：
    *   將庫存依 `subCategory` (優先) 或 `name` 分組，並加總所有批次的 `quantity`。
    *   若 `totalQuantity < maxThreshold` 且 `maxThreshold > 0`，則列為建議補貨。
    *   依據預測補貨日 (`nextRestockDate`) 排序，優先建議急需補貨品項。

---

## 4. App 介面與功能細節 (Interface & Features)

本章節模擬軟體驗收規格，詳細列舉核心視圖的 UI 組成與互動邏輯。

### A. 新增/編輯食譜 (Add Recipe View)
*   **多圖交叉比對 (Multi-Image OCR)**：
    *   **技術實作**：拍照轉食譜功能爆發性突破！現已支援一次上傳最多 **5 張圖片** 進入分析引擎。
    *   **自動理解拼湊**：AI 就像閱讀整本食譜一般，自動跨圖片拼湊分散的食材清單與殘缺的作法步驟，匯總生成一份完美連貫的食譜。
*   **文字轉食譜 (Text to Recipe)**：
    *   原先受限於 CORS 跨域政策的 YouTube 導入模塊，全面重構替換為更泛用、無網路邊界的「文字轉食譜」功能卡片。專注於高速解析使用者剪貼簿的純文字與各類網頁連結。

### B. 食譜與 AI 廚房 (Recipe View)
*   **智慧來源標籤 (Smart Source Indicator)**：
    *   `sourceLink` 欄位不再死板地一律渲染為外部跳轉按鈕。系統如今具備智慧判斷，若是網址 (`http...`)，則顯示外連跳轉圖示；若是普通純文字描述（例如「媽媽的手寫筆記」），則會降級渲染為與「人份」同級的**精美文字膠囊標籤 (Pill-shape Badge)**，維持畫面的純淨度。
*   **純手勢沉浸式烹飪模式 (Immersive Cooking Swipe)**：
    *   點擊「開始烹飪 (沉浸模式)」後，全螢幕隱藏多餘 UI 進入極簡步驟卡片，實作 `touchstart` 與 `touchend` 攔截 `50px` 滑動門檻值，達成全程純手勢左翻右翻的絕佳操作體驗。

### C. 庫存列表 (Inventory List)
*   **檢視模式**：支援「庫存模式」與「心得模式 (Review Mode)」。若搜尋關鍵字命中子分類，心得模式會置頂該分類的精選心得。
*   **批次模式 (Batch Mode)**：提供 Floating Action Bar 一鍵勾選並修改「分類」與「存放位置」。
*   **滑動刪除**：向左滑動超過 70px 即可拉出原生的紅底刪除按鈕。

---

## 5. 系統架構與設計規範 (System Architecture & Design Standards)

* **Local-First 架構**：所有資料 (含圖片 Base64) 儲存於 `localStorage`，無後端伺服器。
* **純淨白板與頂級毛玻璃 (Pure Whiteboard & Top-Tier Glassmorphism)**：
    本次升級配合 UI/UX 稽核，全面確立了「清透、單層白框、純淨背景」的視覺黃金標準，回歸極致的現代扁平玻璃質感。

    ### A. 容器與幾何 (Geometry & Containers)
    * **外層大看板 (Outer Containers) 與彈窗 (Modals)**：嚴格使用 `rounded-[32px]`。
    * **內層主卡片 (Inner Cards)**：嚴格使用 Tailwind 原生的 `rounded-3xl` (即 24px，全面取代手寫的 `[24px]`)。
    * **內層子方塊 (Sub-blocks)**：如食譜營養三宮格、各類小分類卡片、多行輸入框 (Textareas)，嚴格使用 Tailwind 原生的 `rounded-2xl` (即 16px，全面取代 `[16px]`, `[20px]`)。
    * **交互元件 (Interactive Elements)**：按鈕、單行輸入框、圓形圖示底色，必須為絕對膠囊狀 `rounded-full`。
    * **特殊列表 (Exceptions)**：`ShoppingListView` 內的購物項目 (`ShoppingItemRow`) 維持傳統單行列表佈局 (List View)，保留 `border-b border-slate-100 last:border-none` 與 `py-4 px-5 min-h-[72px]` 以符合極簡待辦清單的特定 UX 需求，不強制套用獨立的 `rounded-3xl` 卡片包裝。

    ### B. 材質與深淺 (Material & Depths)
    * **黃金標準頂層材質**：全域廢除所有舊版的 `backdrop-blur-2xl`、`backdrop-blur-md` 與 `border-white/80`。大看板、主卡片與彈窗 (Modals) 統一嚴格使用以下單一白邊毛玻璃材質組合，解決 iOS 渲染層次問題並確保極致清透感：
      ```css
      bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)]
      ```
    * **輔助底板**：透明底層元件若需懸浮感，可搭配使用 `bg-white/40` 等級，但不可加上外框框線，維持融合度。

    ### C. 嚴格色彩系統與禁止事項 (Strict Color System & Prohibited Styles)
    由科技藍 (`#007AFF`) 與危險紅 (`#FF3B30`) 主導。
    * **主要操作/狀態** (如正常狀態、一般徽章)：使用 `text-[#007AFF] bg-blue-50`。
    * **危險/急迫** (如過期 3 天內、報廢、刪除)：使用 `text-[#FF3B30] bg-red-50`。
    * **次要/安全狀態** (如長備品、未過期、剩餘 4-7 天效期)：統一使用高雅安全的 `text-slate-500 bg-slate-100` 或綠色系 `text-[#34C759] bg-green-50`。
    
    > [!WARNING]
    > **🚫 明文禁止事項 (Prohibited Styles)**
    > 1. **絕對禁止漸層**：嚴禁在資料卡片或任何看板背景使用 `bg-gradient-to-br from-white/95 to-white/40`。
    > 2. **絕對禁止橘色**：嚴禁使用 `#FF9500` 或 `bg-orange-50 text-orange-600` 作為效期警告色，以免破壞整體冷色調的和諧。
    > 3. **絕對禁止深度陰影**：嚴禁在**資料卡片**使用 `shadow-[0_24px_48px...]` 等厚重擴散陰影。
    >
    > **✅ 深度陰影合理例外 (Floating UI Exception)**
    > 以下浮動層元件為了表達視覺高度與脫地感，**允許**保留 `shadow-[0_24px_48px_rgba(0,0,0,0.06),inset_0_2px_2px_rgba(255,255,255,1)]`：
    > - **底部導覽列 (Navbar)**：需要強烈的脫地感與層次，與頁面底層拉開距離。
    > - **彈窗 (Modals / Drawers)**：包含 `InventoryList`、`RecipeView`、`MealPlannerView`、`ShoppingListView`、`SettingsView`、`InputModal`、`ConfirmationModal` 等的 Modal/Drawer 元件，需要明顯浮於背景之上。
    > - **浮動提示列 (Toast Bars)**：如批次操作 FAB 或篩選懸浮按鈕等。

    ### D. 互動阻尼與微動畫 (Micro-Interactions)
    * **大面積卡片點擊**：維持 `active:scale-[0.98]` 提供平穩回饋。
    * **獨立按鈕與小圖示**：設定為 `active:scale-95` 提供俐落彈性。
    * **左滑刪除 (Swipe-to-Delete)**：採用全透明底色與動態不透明度 (`{offsetX === 0 ? 'opacity-0' : 'opacity-100'}`) 的組合實作（內部配備紅X無背景按鈕），避免實色背景在圓角遮罩中溢出的渲染瑕疵。

    ### E. 工程化字體排版 (Typography)
    * **大標題 (Titles)**：套用 `font-black tracking-tighter` 以強調現代感。
    * **正常內文 (Content)**：維持 `text-[15px]` 或 `text-[17px]` 搭配 `font-bold`。
    * **輔助標籤 (Labels/Badges)**：全域統一使用 `text-[11px] font-black tracking-widest uppercase text-slate-400`。

---

## 6. 更新日誌 (Changelog)

### [2026-03-02] 架構躍升：AI 智能標記與究極縮放引擎上線
* **核心技術演進**：徹底揚棄 Regex 黑白名單，改由 Prompt 實作 **AI 智慧標記 (AI Tagging)** (`{{數量|單位}}`)，完美避開諸如「180度」、「烤盤 28cm」等邊界數字的誤殺放大。
* **究極縮放解析引擎 (Ultimate Scaling Engine)**：大幅升級 `scaleString` 演算法，現已完美支援「帶分數 (如 1 1/4)」與「範圍數值 (如 50-100, 2~3)」的數學處理，並解決了 JavaScript 浮點數拖尾問題。
* **分享格式優化 (Clean Share)**：全新實作 `removeTags` 清洗機制，完美支援分享食譜時一鍵脫除系統標註，還原為自然語言。
* **多圖交叉比對 (Multi-Image OCR)**：圖片辨識突破單筆極限，現支援高達 5 張圖片同時上傳，由 AI 負責將多張殘缺畫面跨越空間拼湊為完整食譜。
* **文字轉食譜與智慧來源**：重構文字與網址匯入功能以取代受限的 YouTube 導入；並導入 **Smart Source Indicator**，智慧分流「網址連結外連圖示」與「純文字」的 UI 渲染層級 (Pill-shape Badge)。
* **全域文件審計同步 (Code-to-Docs Sync)**：深探原始碼結構，將最新隱含邏輯（AI Tagging, Regex 廢棄聲明, UI 各項細節防呆）逐字鉅細彌遺地反饋至全新改寫的 `README.md`，文件與程式碼 100% 水乳交融。

