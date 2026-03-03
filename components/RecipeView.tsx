import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Recipe, InventoryItem, ShoppingItem, RecipeTagStructure } from '../types';
import { estimateRecipeCostAndNutrition, CostNutritionResult, recognizeRecipeFromText } from '../geminiService';
import ConfirmationModal from './ConfirmationModal';
import InputModal from './InputModal';

interface RecipeViewProps {
  recipes: Recipe[];
  inventoryItems?: InventoryItem[];
  shoppingList?: ShoppingItem[];
  recipeTags: RecipeTagStructure;
  targetRecipeId?: string | null;
  clearTargetRecipeId?: () => void;
  onDelete: (id: string) => void;
  onEdit: (recipe: Recipe) => void;
  onUpdate: (recipe: Recipe) => void;
  onAddToShopping: (name: string) => void;
  onDuplicate: (recipe: Recipe) => void;
}

interface BatchEditState {
  type: 'tags' | null;
}

const normalizeForMatch = (text: string) => {
  if (!text) return '';
  return text
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/[0-9.\/]+/g, '')
    .replace(/[a-zA-Z°%\.]/g, '')
    .replace(/[半一二兩三四五六七八九十]/g, '')
    .replace(/[克匙杯顆個包條片只毫升公克大匙小匙斤把根滴塊份碗鍋盆串]/g, '')
    .replace(/[()\[\]\s]/g, '')
    .replace(/少許|適量/g, '')
    .trim()
    .toLowerCase();
};

// ==========================================
// 核心升級：純 AI 標記解析引擎 (支援範圍數值 50-100)
// ==========================================
const scaleString = (text: string, factor: number, format: 'replace' | 'arrow') => {
  if (!text) return text;

  // 放寬正則表達式：允許數字、小數點、連字號(-)、波浪號(~)與空白
  return text.replace(/\{\{([^|{}]+)(?:\|([^}]+))?\}\}/g, (match, numStr, unitStr) => {
    const unit = unitStr ? unitStr.trim() : '';

    // 獨立的單一數字縮放邏輯
    const scaleNumber = (str: string) => {
      let num = parseFloat(str);
      if (str.includes('/')) {
        const parts = str.split('/');
        if (parts.length === 2 && !isNaN(parseFloat(parts[0])) && !isNaN(parseFloat(parts[1]))) {
          num = parseFloat(parts[0]) / parseFloat(parts[1]);
        }
      }
      if (isNaN(num)) return str; // 若為「適量」、「少許」直接回傳
      const scaled = num * factor;
      return scaled % 1 === 0 ? scaled.toString() : parseFloat(scaled.toFixed(2)).toString();
    };

    let scaledNumStr = numStr.trim();
    let rawNumStr = numStr.trim();

    // 智慧拆解並縮放範圍數值
    if (numStr.includes('-')) {
      scaledNumStr = numStr.split('-').map(s => scaleNumber(s.trim())).join('-');
    } else if (numStr.includes('~')) {
      scaledNumStr = numStr.split('~').map(s => scaleNumber(s.trim())).join('~');
    } else {
      scaledNumStr = scaleNumber(numStr.trim());
    }

    // 如果倍率不是 1，且是食材清單模式，顯示箭頭變化 (例如：50-100g ➔ 100-200g)
    if (format === 'arrow' && factor !== 1 && scaledNumStr !== rawNumStr) {
      return `${rawNumStr}${unit} ➔ ${scaledNumStr}${unit}`;
    }

    return `${scaledNumStr}${unit}`;
  });
};

const RecipeCard: React.FC<{
  recipe: Recipe;
  inventoryItems?: InventoryItem[];
  shoppingList?: ShoppingItem[];
  isBatchMode: boolean;
  isSelected: boolean;
  viewMode: 'default' | 'review';
  onToggleSelection: (id: string) => void;
  onEdit: () => void;
  onDeleteRequest: () => void;
  onAddToShopping: (name: string) => void;
  onUpdate: (recipe: Recipe) => void;
  onDuplicate: () => void;
  onShareSuccess: () => void;
  isActiveSwipe?: boolean;
  onSwipeStart?: () => void;
}> = ({ recipe, inventoryItems, shoppingList, isBatchMode, isSelected, viewMode, onToggleSelection, onEdit, onDeleteRequest, onAddToShopping, onUpdate, onDuplicate, onShareSuccess, isActiveSwipe, onSwipeStart }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'ingredients' | 'steps' | 'review'>('ingredients');
  const [costBreakdownExpanded, setCostBreakdownExpanded] = useState(false);
  const [scaleEditModal, setScaleEditModal] = useState(false);

  // Focused Cooking Mode State
  const [isCookingMode, setIsCookingMode] = useState(false);
  const [cookingStepIndex, setCookingStepIndex] = useState(0);

  const [isEstimating, setIsEstimating] = useState(false);
  const [estimationResult, setEstimationResult] = useState<CostNutritionResult | null>((recipe as any).cachedEstimation || null);
  const [localPriceOverrides, setLocalPriceOverrides] = useState<Record<string, number>>({});
  const [scaleFactor, setScaleFactor] = useState(1);

  const [priceEditModal, setPriceEditModal] = useState<{
    isOpen: boolean;
    ingredientName: string;
    currentCost: string;
  }>({ isOpen: false, ingredientName: '', currentCost: '' });

  const [offsetX, setOffsetX] = useState(0);
  const [swipedOpen, setSwipedOpen] = useState(false);
  const startX = useRef(0);
  const threshold = 70;

  // --- 新增：舊版食譜一鍵 AI 升級邏輯 ---
  const [isUpgrading, setIsUpgrading] = useState(false);

  // 智能檢查是否為舊版食譜 (食材或作法中缺乏 {{ 標記)
  const isOldRecipe = useMemo(() => {
    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
    const hasTags = ingredients.some(i => i.includes('{{')) || (typeof recipe.steps === 'string' && recipe.steps.includes('{{'));
    return !hasTags;
  }, [recipe.ingredients, recipe.steps]);

  const handleUpgradeRecipe = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isUpgrading) return;
    setIsUpgrading(true);

    try {
      const ingredientsList = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
      const recipeText = `
        食譜名稱：${recipe.name}
        原始食材：${ingredientsList.join('、')}
        原始作法：${recipe.steps}
      `;

      // 呼叫現有的文字轉食譜 API 重新打上智能標記
      const upgradedData = await recognizeRecipeFromText(recipeText, [], inventoryItems || []);

      if (upgradedData) {
        // 保留原本的 ID、標籤、來源、心得、庫存，僅替換需縮放的欄位
        onUpdate({
          ...recipe,
          ingredients: upgradedData.ingredients,
          steps: upgradedData.steps,
          servings: upgradedData.servings || recipe.servings
        });
      }
    } catch (error) {
      console.error("升級失敗:", error);
    } finally {
      setIsUpgrading(false);
    }
  };
  // ------------------------------------

  const handleShareRecipe = () => {
    // 移除 AI 標記的輔助函式 (將 {{225|g}} 轉為 225g，{{2}} 轉為 2)
    const removeTags = (str: string) => str.replace(/\{\{([^|{}]+)(?:\|([^}]+))?\}\}/g, '$1$2');

    // 更改文案為「來源」以適應非網址內容
    const sourceText = recipe.sourceLink ? `\n📖 來源：\n${recipe.sourceLink}\n` : '';

    let estimationText = '';
    const est = estimationResult || (recipe as any).cachedEstimation;
    if (est) {
      estimationText = `\n\n💰 預估成本：$${Math.round(est.totalCost)}\n🔥 總熱量：${est.nutrition.calories} kcal\n🥩 蛋白質：${est.nutrition.protein}g | 🍚 碳水：${est.nutrition.carbs}g | 🧈 脂肪：${est.nutrition.fat}g`;
    }

    // 清除作法與食材中的標記
    const cleanSteps = removeTags(recipe.steps);
    const stepsArray = cleanSteps.split('\n').filter(s => s.trim().length > 0);
    const numberedSteps = stepsArray.map((s, i) => `${i + 1}. ${s}`).join('\n');

    const servingsText = recipe.servings ? ` (${recipe.servings}人份)` : '';
    const ingredientsText = recipe.ingredients.map(i => `• ${removeTags(i)}`).join('\n');

    const text = `🍽️ ${recipe.name}${servingsText}\n${sourceText}\n🛒 食材列表：\n${ingredientsText}\n\n📝 作法清單：\n${numberedSteps}${estimationText}`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        onShareSuccess();
      });
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        onShareSuccess();
      } catch (err) {
        console.error('Fallback: Oops, unable to copy', err);
      }
      document.body.removeChild(textArea);
    }
  };

  useEffect(() => {
    if (!isActiveSwipe) {
      setOffsetX(0);
      setSwipedOpen(false);
    }
  }, [isActiveSwipe]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isBatchMode) return;
    startX.current = e.touches[0].clientX;
    onSwipeStart?.();
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isBatchMode) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - startX.current;
    let newOffset = swipedOpen ? diff - threshold : diff;
    if (newOffset > 0) newOffset = 0;
    if (newOffset < -threshold - 20) newOffset = -threshold - 20;
    setOffsetX(newOffset);
  };

  const handleTouchEnd = () => {
    if (isBatchMode) return;
    if (offsetX < -threshold / 2) {
      setOffsetX(-threshold);
      setSwipedOpen(true);
    } else {
      setOffsetX(0);
      setSwipedOpen(false);
    }
  };

  const handleEstimate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isEstimating) return;
    setIsEstimating(true);
    setEstimationResult(null);
    setLocalPriceOverrides({});

    try {
      const result = await estimateRecipeCostAndNutrition(recipe, inventoryItems || []);
      setEstimationResult(result);
      onUpdate({ ...recipe, cachedEstimation: result } as Recipe);
    } catch (error) {
      console.error("估算失敗:", error);
      alert('AI 伺服器忙碌中: 目前估算服務負載較高 (503 錯誤)，請稍等幾分鐘後再試一次！');
    } finally {
      setIsEstimating(false);
    }
  };

  const openPriceEdit = (ingredientName: string, currentCost: number) => {
    setPriceEditModal({
      isOpen: true,
      ingredientName,
      currentCost: currentCost.toString()
    });
  };

  const confirmPriceEdit = (val: string) => {
    const newPrice = parseFloat(val);
    if (!isNaN(newPrice)) {
      setLocalPriceOverrides(prev => ({ ...prev, [priceEditModal.ingredientName]: newPrice }));
    }
    setPriceEditModal({ ...priceEditModal, isOpen: false });
  };

  const finalEstimation = useMemo(() => {
    if (!estimationResult) return null;

    let totalCostBase = 0;
    const baseIngredients = estimationResult.ingredients.map(ing => {
      const override = localPriceOverrides[ing.name];
      const finalCostBase = override !== undefined ? override : ing.cost;
      totalCostBase += finalCostBase;
      return { ...ing, finalCostBase, isOverridden: override !== undefined };
    });

    const factor = scaleFactor;
    const totalCost = totalCostBase * factor;
    const totalWeight = Math.round(estimationResult.totalWeight * factor);

    const nutrition = {
      calories: Math.round(estimationResult.nutrition.calories * factor),
      protein: Math.round(estimationResult.nutrition.protein * factor),
      carbs: Math.round(estimationResult.nutrition.carbs * factor),
      fat: Math.round(estimationResult.nutrition.fat * factor)
    };

    const ingredients = baseIngredients.map(ing => ({
      ...ing,
      finalCost: ing.finalCostBase * factor,
      amount: scaleString(ing.amount, factor, 'replace')
    }));

    return { totalCost, totalWeight, nutrition, ingredients };
  }, [estimationResult, localPriceOverrides, scaleFactor]);

  const getStockStatus = (ingredientLine: string) => {
    if (!inventoryItems || !ingredientLine) return { found: false, quantity: 0 };

    const coreTarget = normalizeForMatch(ingredientLine);
    if (!coreTarget) return { found: false, quantity: 0 };

    const validInventory = inventoryItems.filter(inv => inv.quantity > 0);

    let matchedItems = validInventory.filter(inv => {
      const invSub = normalizeForMatch(inv.subCategory || '');
      return invSub === coreTarget;
    });

    if (matchedItems.length === 0) {
      matchedItems = validInventory.filter(inv => {
        const invName = normalizeForMatch(inv.name);
        return invName === coreTarget;
      });
    }

    const totalQuantity = matchedItems.reduce((acc, curr) => acc + curr.quantity, 0);
    return matchedItems.length > 0 ? { found: true, quantity: totalQuantity } : { found: false, quantity: 0 };
  };

  const formattedSteps = useMemo(() => {
    const raw = typeof recipe.steps === 'string' ? recipe.steps : '';
    const lines = raw.split(/\n+/).map(l => l.trim()).filter(l => l);
    return lines.map(line => scaleString(line, scaleFactor, 'replace'));
  }, [recipe.steps, scaleFactor]);

  const safeIngredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];

  const scaledIngredientList = useMemo(() => {
    return safeIngredients.map(ing => ({
      original: ing,
      display: scaleString(ing, scaleFactor, 'arrow')
    }));
  }, [safeIngredients, scaleFactor]);

  // 🍎 沉浸式烹飪模式視圖 (純手勢滑動版)
  // --- 新增：沉浸模式滑動計算邏輯 ---
  const cookStartX = useRef(0);

  const handleCookTouchStart = (e: React.TouchEvent) => {
    cookStartX.current = e.touches[0].clientX;
  };

  const handleCookTouchEnd = (e: React.TouchEvent) => {
    const endX = e.changedTouches[0].clientX;
    const diff = endX - cookStartX.current;

    // 判斷滑動距離超過 50px 才觸發 (避免誤觸)
    if (Math.abs(diff) > 50) {
      if (diff < 0) {
        // 向左滑 (下一階段)
        if (cookingStepIndex < formattedSteps.length - 1) {
          setCookingStepIndex(prev => prev + 1);
        } else {
          setIsCookingMode(false); // 最後一步結束
        }
      } else {
        // 向右滑 (上一階段)
        if (cookingStepIndex > 0) {
          setCookingStepIndex(prev => prev - 1);
        }
      }
    }
  };
  // ------------------------------------

  // 🍎 沉浸式烹飪模式視圖 (純手勢滑動版)
  if (isCookingMode) {
    return (
      <div
        className="fixed inset-0 z-[100] bg-slate-900 text-white flex flex-col animate-in slide-in-from-bottom duration-300"
        onTouchStart={handleCookTouchStart}
        onTouchEnd={handleCookTouchEnd}
      >
        <div className="pt-14 pb-4 px-6 flex justify-between items-center border-b border-white/60">
          <button onClick={() => setIsCookingMode(false)} className="text-slate-900 font-black text-sm bg-white px-5 py-2.5 rounded-full active:scale-95 transition-all shadow-[0_4px_12px_rgba(255,255,255,0.15)]">
            結束
          </button>
          <span className="font-black tracking-widest text-xs text-slate-400 uppercase">左右滑動切換</span>
          <div className="w-[60px]"></div>
        </div>

        <div className="px-8 pt-10">
          <h2 className="text-2xl font-black text-white mb-6 text-center leading-tight">{recipe.name}</h2>
          <div className="h-2.5 bg-white/10 rounded-full overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
            <div
              className="h-full bg-[#007AFF] transition-all duration-500 ease-out shadow-[0_0_12px_rgba(0,122,255,0.6)]"
              style={{ width: `${formattedSteps.length > 0 ? ((cookingStepIndex + 1) / formattedSteps.length) * 100 : 100}%` }}
            ></div>
          </div>
          <p className="text-center mt-4 text-sm font-black text-[#007AFF] tracking-widest uppercase">
            步驟 {cookingStepIndex + 1} <span className="text-slate-500">/ {formattedSteps.length || 1}</span>
          </p>
        </div>

        <div className="flex-1 px-8 flex flex-col items-center justify-center overflow-hidden">
          {formattedSteps.length > 0 ? (
            <p className="text-[26px] sm:text-3xl font-black leading-snug tracking-tight text-center text-white/90 select-none">
              {formattedSteps[cookingStepIndex]}
            </p>
          ) : (
            <p className="text-xl font-bold text-white/50">無步驟資料</p>
          )}

          {/* 滑動引導動畫 */}
          <div className="mt-16 flex items-center gap-6 text-white/30 animate-pulse">
            <div className="flex flex-col items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
              <span className="text-[10px] font-bold tracking-widest uppercase">上一步</span>
            </div>
            <div className="w-px h-8 bg-white/10"></div>
            <div className="flex flex-col items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
              <span className="text-[10px] font-bold tracking-widest uppercase">下一步</span>
            </div>
          </div>
        </div>

        <div className="h-16 w-full"></div>
      </div>
    );
  }

  // 🍎 Review 模式 (心得簡化卡片)：扁平化白板
  // 🍎 Review 模式 (心得簡化卡片)：完全對齊一般模式的內外雙層結構
  if (viewMode === 'review') {
    return (
      <div className="relative overflow-hidden group rounded-[32px] border border-white/60 shadow-[0_24px_48px_rgba(0,0,0,0.06),inset_0_2px_2px_rgba(255,255,255,1)] bg-gradient-to-br from-white/95 to-white/40 backdrop-blur-[40px] backdrop-saturate-150">
        <div
          onClick={(e) => {
            e.stopPropagation();
            if (isBatchMode) onToggleSelection(recipe.id);
            else onEdit();
          }}
          className={`transition-all duration-300 relative z-10 cursor-pointer p-5 h-full ${isSelected && isBatchMode ? 'bg-white/80 ring-2 ring-[#007AFF]' : 'hover:bg-white/80'}`}
        >
          {isBatchMode && (
            <div className="absolute top-5 left-4 z-10">
              <div className={`w-6 h-6 rounded-full border flex items-center justify-center transition-colors ${isSelected ? 'bg-[#007AFF] border-[#007AFF] shadow-[0_2px_10px_rgba(0,0,0,0.03)] shadow-blue-500/20' : 'bg-white border-slate-300'}`}>
                {isSelected && <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
              </div>
            </div>
          )}
          <div className={`${isBatchMode ? 'pl-8' : ''}`}>
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-[17px] font-black tracking-tight text-slate-800 leading-tight">{recipe.name}</h3>
              <div className="flex flex-wrap justify-end gap-1.5 ml-2">
                {recipe.tags.slice(0, 2).map(t => (
                  <span key={t} className="text-[10px] bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full font-black tracking-widest whitespace-nowrap">{t}</span>
                ))}
              </div>
            </div>
            {recipe.review ? (
              <p className="text-sm font-bold text-slate-600 leading-relaxed whitespace-pre-wrap">{recipe.review}</p>
            ) : (
              <p className="text-sm font-bold text-slate-400 italic">暫無心得，點擊編輯新增...</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    // 🍎 外層大卡片：頂級毛玻璃 + 光學邊緣
    <div className="relative overflow-hidden group rounded-[32px] border border-white/60 shadow-[0_24px_48px_rgba(0,0,0,0.06),inset_0_2px_2px_rgba(255,255,255,1)] bg-gradient-to-br from-white/95 to-white/40 backdrop-blur-[40px] backdrop-saturate-150">
      {!isBatchMode && (
        <div
          className={`absolute inset-0 bg-transparent flex justify-end items-center px-6 z-0 rounded-[32px] transition-opacity duration-300 ${offsetX === 0 ? 'opacity-0' : 'opacity-100'}`}
          onClick={(e) => {
            e.stopPropagation();
            onDeleteRequest();
            setOffsetX(0);
            setSwipedOpen(false);
          }}
        >
          <div className="flex flex-col items-center">
            <svg className="text-[#FF3B30]" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            <span className="text-slate-800 text-[10px] font-black mt-1 uppercase tracking-widest">刪除</span>
          </div>
        </div>
      )}

      <div
        // 🍎 內層容器：透明懸浮感
        className={`transition-all duration-300 relative z-10 ${isOpen || isSelected ? 'bg-white/80' : 'hover:bg-white/80'} p-5`}
        style={{ transform: `translateX(${offsetX}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => {
          if (offsetX !== 0) return;
          if (isBatchMode) onToggleSelection(recipe.id);
          else setIsOpen(!isOpen);
        }}
      >
        {isBatchMode && (
          <div className="absolute top-5 left-4 z-10">
            <div className={`w-6 h-6 rounded-full border flex items-center justify-center transition-colors ${isSelected ? 'bg-[#007AFF] border-[#007AFF] shadow-[0_2px_10px_rgba(0,0,0,0.03)] shadow-blue-500/20' : 'bg-white border-slate-300'}`}>
              {isSelected && <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
            </div>
          </div>
        )}

        <div className={`${isBatchMode ? 'pl-8' : ''}`}>
          <div className="flex items-start justify-between gap-3 mb-2.5">
            <h3 className="text-[17px] font-black tracking-tight text-slate-800 leading-tight break-all">
              {recipe.name}
            </h3>
            <div className="flex items-center gap-1.5 shrink-0">
              {recipe.sourceLink && !recipe.sourceLink.startsWith('http') && (
                <span className="text-[11px] bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full font-black tracking-widest border border-slate-200">
                  來源: {recipe.sourceLink}
                </span>
              )}
              {recipe.servings && (
                <span className="text-[11px] bg-blue-50 text-[#007AFF] px-2.5 py-1 rounded-full font-black tracking-widest border border-blue-100/50 shadow-[0_1px_2px_rgba(0,122,255,0.05)]">
                  {recipe.servings} 人份
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-1">
            {recipe.tags && recipe.tags.length > 0 ? (
              recipe.tags.map((tag, idx) => (
                // 🍎 標籤：無邊框扁平膠囊
                <span
                  key={idx}
                  className="text-[10px] bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full font-black whitespace-nowrap tracking-widest"
                >
                  {tag}
                </span>
              ))
            ) : (
              <span className="text-[10px] bg-slate-50/80 text-slate-400 px-2.5 py-1 rounded-full font-black border border-white/60 whitespace-nowrap tracking-widest">
                無標籤
              </span>
            )}
          </div>
        </div>

        {isOpen && !isBatchMode && (
          <div className="mt-5 mb-2 space-y-4 animate-in slide-in-from-top-2 duration-300 cursor-default" onClick={(e) => e.stopPropagation()}>

            {/* 🍎 分頁切換 (Segmented Control)：iOS 內建風格 */}
            <div className="flex bg-slate-200/50 p-1.5 rounded-full border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
              <button
                onClick={() => setActiveTab('ingredients')}
                className={`flex-1 py-2.5 text-[13px] tracking-widest font-black rounded-full transition-all duration-300 ${activeTab === 'ingredients' ? 'bg-white text-[#007AFF] shadow-[0_2px_8px_rgba(0,0,0,0.05)] border border-white/60' : 'text-slate-500 hover:text-slate-700'}`}
              >
                備料與成本
              </button>
              <button
                onClick={() => setActiveTab('steps')}
                className={`flex-1 py-2.5 text-[13px] tracking-widest font-black rounded-full transition-all duration-300 ${activeTab === 'steps' ? 'bg-white text-[#007AFF] shadow-[0_2px_8px_rgba(0,0,0,0.05)] border border-white/60' : 'text-slate-500 hover:text-slate-700'}`}
              >
                做法
              </button>
              <button
                onClick={() => setActiveTab('review')}
                className={`flex-1 py-2.5 text-[13px] tracking-widest font-black rounded-full transition-all duration-300 ${activeTab === 'review' ? 'bg-white text-[#007AFF] shadow-[0_2px_8px_rgba(0,0,0,0.05)] border border-white/60' : 'text-slate-500 hover:text-slate-700'}`}
              >
                心得
              </button>
            </div>

            {/* 配方縮放控制區 */}
            <div className="bg-white/90 rounded-[24px] p-4 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] flex flex-wrap items-center justify-between gap-3">
              <span className="text-[13px] font-black tracking-wider text-slate-600 whitespace-nowrap flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#007AFF]"><path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" /><path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /><path d="M12 2v2" /><path d="M12 22v-2" /><path d="m17 17-1.4-1.4" /><path d="m4.9 4.9 1.4 1.4" /><path d="m19.1 4.9-1.4 1.4" /><path d="m4.9 19.1 1.4-1.4" /></svg>
                配方份量
              </span>
              <div className="flex items-center gap-2">
                {[0.5, 1.0, 2.0].map(val => (
                  <button
                    key={val}
                    onClick={() => setScaleFactor(val)}
                    // 🍎 倍率按鈕扁平化
                    className={`h-9 w-[46px] rounded-full text-xs font-black tracking-wider transition-all flex items-center justify-center border-none ${scaleFactor === val
                      ? 'bg-[#007AFF] text-white shadow-[0_4px_12px_rgba(0,122,255,0.2)] scale-105'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                  >
                    {val}x
                  </button>
                ))}
                <button
                  onClick={() => setScaleEditModal(true)}
                  className="relative h-9 w-16 bg-slate-100 hover:bg-slate-200 rounded-full transition-all flex items-center justify-center group border-none"
                >
                  <span className="text-[13px] font-black tracking-widest text-slate-700 -ml-1 pr-1">{scaleFactor}</span>
                  <span className="text-[10px] font-black text-slate-400 absolute right-3 pointer-events-none">x</span>
                </button>
              </div>
            </div>

            <div className="min-h-[200px] animate-in fade-in duration-300">

              {/* --- 頁籤一：備料與成本 --- */}
              {activeTab === 'ingredients' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-[13px] font-black tracking-wide text-slate-800">營養與成本估算</span>
                    <button
                      onClick={handleEstimate}
                      disabled={isEstimating}
                      // 🍎 按鈕扁平化與微光暈
                      className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full text-[11px] font-black tracking-widest transition-all active:scale-95 border-none ${estimationResult && !isEstimating ? 'bg-slate-100 text-[#007AFF] hover:bg-slate-200' : 'bg-[#007AFF] text-white shadow-[0_4px_12px_rgba(0,122,255,0.2)] hover:bg-blue-600'}`}
                    >
                      {isEstimating ? '估算中...' : estimationResult ? '重新估算' : 'AI 智能估算'}
                    </button>
                  </div>

                  {isEstimating && (
                    <div className="bg-white/90 border border-white/60 rounded-[28px] p-5 shadow-[0_2px_10px_rgba(0,0,0,0.03)] animate-pulse">
                      <div className="flex gap-4 mb-4"><div className="flex-1 bg-slate-100 rounded-[20px] h-20"></div><div className="flex-1 bg-slate-100 rounded-[20px] h-20"></div></div>
                      <div className="h-6 bg-slate-100 rounded-full w-full"></div>
                    </div>
                  )}

                  {finalEstimation && !isEstimating && (
                    <div className="bg-white/90 border border-white/60 rounded-[28px] p-5 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
                      <div className="flex gap-3 mb-4">
                        <div className="flex-1 bg-green-50 rounded-[20px] p-4 flex flex-col justify-between">
                          <span className="text-[10px] font-black text-emerald-600 tracking-widest uppercase">總成本</span>
                          <div className="flex items-baseline gap-0.5 text-emerald-700 mt-1"><span className="text-sm font-bold">$</span><span className="text-3xl font-black leading-none">{Math.round(finalEstimation.totalCost)}</span></div>
                        </div>
                        <div className="flex-1 bg-orange-50 rounded-[20px] p-4 flex flex-col justify-between">
                          <span className="text-[10px] font-black text-orange-600 tracking-widest uppercase">總熱量</span>
                          <div className="flex items-baseline gap-1 text-orange-700 mt-1"><span className="text-3xl font-black leading-none">{finalEstimation.nutrition.calories}</span><span className="text-[10px] font-bold">kcal</span></div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mb-4">
                        <div className="bg-blue-50/80 rounded-[16px] py-2 text-center"><span className="block text-[10px] text-blue-500 font-black tracking-widest">蛋白</span><span className="text-[15px] font-black text-blue-700">{finalEstimation.nutrition.protein}g</span></div>
                        <div className="bg-purple-50/80 rounded-[16px] py-2 text-center"><span className="block text-[10px] text-purple-500 font-black tracking-widest">碳水</span><span className="text-[15px] font-black text-purple-700">{finalEstimation.nutrition.carbs}g</span></div>
                        <div className="bg-amber-50/80 rounded-[16px] py-2 text-center"><span className="block text-[10px] text-amber-500 font-black tracking-widest">脂肪</span><span className="text-[15px] font-black text-amber-700">{finalEstimation.nutrition.fat}g</span></div>
                      </div>

                      <div className="border border-slate-100 rounded-[20px] bg-slate-50/50 overflow-hidden">
                        <button
                          onClick={() => setCostBreakdownExpanded(!costBreakdownExpanded)}
                          className="w-full px-4 py-3 flex justify-between items-center text-[13px] font-black text-slate-600 hover:bg-slate-100 transition-colors"
                        >
                          <span>查看預估成本明細</span>
                          <svg className={`w-4 h-4 transition-transform ${costBreakdownExpanded ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                        </button>
                        {costBreakdownExpanded && (
                          <div className="px-3 pb-3 pt-1 space-y-1.5 animate-in slide-in-from-top-2">
                            {finalEstimation.ingredients.map((ing, idx) => (
                              <button key={idx} onClick={(e) => { e.stopPropagation(); openPriceEdit(ing.name, ing.finalCost); }} className="w-full flex justify-between items-center bg-white px-3 py-2.5 rounded-[16px] active:scale-[0.98] transition-all border border-transparent hover:border-[#007AFF]/30 group shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
                                <div className="text-left flex items-center gap-2">
                                  <div className={`w-2 h-2 rounded-full ${ing.source === 'inventory' ? 'bg-emerald-400' : 'bg-slate-300'}`}></div>
                                  <span className="text-[14px] text-slate-700 font-black">{ing.name} <span className="text-[10px] text-slate-400 font-bold ml-1">{ing.amount}</span></span>
                                </div>
                                <span className={`text-[15px] font-black ${ing.isOverridden ? 'text-orange-500' : (ing.source === 'inventory' ? 'text-emerald-600' : 'text-slate-500')}`}>${Math.round(ing.finalCost)}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-[28px] p-5">
                    <h4 className="text-[13px] font-black tracking-wide text-slate-800 mb-4 px-1">食材清單</h4>
                    <div className="space-y-3 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                      {scaledIngredientList.map((ingItem, idx) => {
                        const status = getStockStatus(ingItem.original);
                        const isAvailable = status.found && status.quantity > 0;
                        const isInCart = shoppingList?.some(item => item.name.trim().toLowerCase() === ingItem.original.trim().toLowerCase());

                        return (
                          <div key={idx} className="flex justify-between items-center group border-b border-slate-100 last:border-0 pb-3 last:pb-0">
                            <div className="flex-1 mr-3 min-w-0">
                              <span className={`text-[14px] font-black tracking-wide block break-words leading-relaxed ${isAvailable ? 'text-slate-800' : 'text-slate-500'}`}>{ingItem.display}</span>
                              {status.found ? (
                                <span className={`text-[10px] font-black tracking-widest block mt-1 ${status.quantity > 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>庫存: {status.quantity}</span>
                              ) : (
                                <span className="text-[9px] font-black tracking-widest mt-1 inline-block text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">無紀錄</span>
                              )}
                            </div>
                            {/* 🍎 購物車按鈕扁平化 */}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); if (!isInCart) onAddToShopping(ingItem.original); }}
                              disabled={isInCart}
                              className={`p-2.5 rounded-full transition-all shrink-0 border-none ${isInCart ? 'bg-slate-100 text-slate-300 cursor-default' : 'bg-blue-50 text-[#007AFF] hover:bg-[#007AFF] hover:text-white active:scale-90'}`}
                            >
                              {isInCart ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></svg>}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* --- 頁籤二：做法與沉浸模式 --- */}
              {activeTab === 'steps' && (
                <div className="bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-[28px] p-5 flex flex-col h-full">

                  {/* 🍎 沉浸模式按鈕：原廠藍光暈 */}
                  <button
                    onClick={() => { setCookingStepIndex(0); setIsCookingMode(true); }}
                    className="w-full bg-[#007AFF] text-white py-4 rounded-full font-black tracking-widest shadow-[0_4px_12px_rgba(0,122,255,0.2)] mb-6 flex items-center justify-center gap-2 active:scale-[0.98] transition-all border-none hover:bg-blue-600"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                    開始烹飪 (沉浸模式)
                  </button>

                  <ol className="list-decimal list-outside pl-5 space-y-4">
                    {formattedSteps.length > 0 ? formattedSteps.map((step, idx) => (
                      <li key={idx} className="text-[14px] font-bold text-slate-700 leading-relaxed pl-1 marker:text-[#007AFF] marker:font-black pb-3 border-b border-slate-100 last:border-0">{step}</li>
                    )) : <li className="text-sm font-bold text-slate-400 italic">暫無步驟資料</li>}
                  </ol>
                </div>
              )}

              {/* --- 頁籤三：心得 --- */}
              {activeTab === 'review' && (
                <div className="bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-[28px] p-6 min-h-[150px]">
                  <p className="text-[15px] font-bold text-slate-600 leading-relaxed whitespace-pre-wrap">
                    {recipe.review || <span className="text-slate-400 italic font-normal">尚無心得紀錄，點擊下方編輯按鈕來新增你的第一筆料理心得吧！</span>}
                  </p>
                </div>
              )}

            </div>

          </div>
        )}

        {!isBatchMode && (
          <div className="flex justify-between items-center mt-5 pt-3 border-t border-white/60">
            <div className="flex items-center gap-2">
              {/* AI 智能升級按鈕 (僅舊版食譜顯示) */}
              {isOldRecipe && (
                <button
                  onClick={handleUpgradeRecipe}
                  disabled={isUpgrading}
                  className={`p-2.5 transition-all rounded-full border border-transparent active:scale-95 ${isUpgrading ? 'text-[#FF9500] animate-pulse bg-orange-50' : 'text-[#FF9500] hover:text-white hover:bg-[#FF9500] hover:shadow-[0_2px_10px_rgba(255,149,0,0.3)]'}`}
                  title="一鍵 AI 升級 (加入份量縮放與標記)"
                >
                  {isUpgrading ? (
                    <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /><path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" /></svg>
                  )}
                </button>
              )}
              <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-2.5 text-slate-400 hover:text-[#007AFF] hover:bg-white border border-transparent hover:border-white hover:shadow-[0_2px_10px_rgba(0,0,0,0.03)] transition-all rounded-full active:scale-95" title="編輯">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></svg>
              </button>
              <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }} className="p-2.5 text-slate-400 hover:text-[#007AFF] hover:bg-white border border-transparent hover:border-white hover:shadow-[0_2px_10px_rgba(0,0,0,0.03)] transition-all rounded-full active:scale-95" title="複製副本">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
              </button>
              <button onClick={(e) => { e.stopPropagation(); handleShareRecipe(); }} className="p-2.5 text-slate-400 hover:text-[#007AFF] hover:bg-white border border-transparent hover:border-white hover:shadow-[0_2px_10px_rgba(0,0,0,0.03)] transition-all rounded-full active:scale-95" title="分享與複製文字">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" x2="15.42" y1="13.51" y2="17.49" /><line x1="15.41" x2="8.59" y1="6.51" y2="10.49" /></svg>
              </button>
              {recipe.sourceLink && recipe.sourceLink.startsWith('http') && (
                <a href={recipe.sourceLink} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="p-2.5 text-slate-400 hover:text-[#007AFF] hover:bg-white border border-transparent hover:border-white hover:shadow-[0_2px_10px_rgba(0,0,0,0.03)] transition-all rounded-full active:scale-95" title="來源連結">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                </a>
              )}
            </div>
            <div className="flex items-center gap-1">
              <div className={`text-slate-400 p-1 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
              </div>
            </div>
          </div>
        )}
      </div>

      <InputModal
        isOpen={priceEditModal.isOpen}
        title="修改預估成本"
        message={`請輸入「${priceEditModal.ingredientName}」的新價格`}
        defaultValue={priceEditModal.currentCost}
        inputType="number"
        onConfirm={confirmPriceEdit}
        onCancel={() => setPriceEditModal({ ...priceEditModal, isOpen: false })}
      />
      <InputModal
        isOpen={scaleEditModal}
        title="修改配方份量"
        message="請輸入全新的被乘數做為配方倍率 (例如 0.5 或 2.5)"
        defaultValue={scaleFactor.toString()}
        inputType="number"
        onConfirm={(val) => {
          const num = parseFloat(val);
          if (!isNaN(num) && num > 0) setScaleFactor(num);
          setScaleEditModal(false);
        }}
        onCancel={() => setScaleEditModal(false)}
      />
    </div>
  );
};

const RecipeView: React.FC<RecipeViewProps> = ({
  recipes, inventoryItems, shoppingList, recipeTags, targetRecipeId, clearTargetRecipeId, onDelete, onEdit, onUpdate, onAddToShopping, onDuplicate
}) => {
  const getInitialState = () => {
    try {
      const saved = localStorage.getItem('homestock_recipe_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          search: parsed.search || '',
          selectedTags: new Set((parsed.selectedTags || []) as string[])
        };
      }
    } catch (e) { console.error('Failed to load recipe state', e); }
    return null;
  };
  const savedState = getInitialState();

  const [search, setSearch] = useState(savedState?.search || '');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(savedState?.selectedTags || new Set());

  useEffect(() => {
    const stateToSave = { search, selectedTags: Array.from(selectedTags) };
    localStorage.setItem('homestock_recipe_state', JSON.stringify(stateToSave));
  }, [search, selectedTags]);

  const [expandedParentTag, setExpandedParentTag] = useState<string | null>(null);
  const [activeSwipeId, setActiveSwipeId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'default' | 'review'>(() => {
    try { return localStorage.getItem('homestock_recipe_view') === 'review' ? 'review' : 'default'; } catch { return 'default'; }
  });
  const [isBatchMode, setIsBatchMode] = useState(false);

  useEffect(() => {
    if (targetRecipeId) {
      setTimeout(() => {
        const el = document.getElementById('recipe-' + targetRecipeId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Optional visual highlight
          el.classList.add('ring-4', 'ring-[#007AFF]', 'shadow-[0_0_30px_rgba(0,122,255,0.3)]', 'rounded-[32px]', 'transition-all', 'duration-500');
          setTimeout(() => {
            el.classList.remove('ring-4', 'ring-[#007AFF]', 'shadow-[0_0_30px_rgba(0,122,255,0.3)]');
            if (clearTargetRecipeId) clearTargetRecipeId();
          }, 1500);
        }
      }, 100);
    }
  }, [targetRecipeId, clearTargetRecipeId]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchEditModal, setBatchEditModal] = useState<BatchEditState>({ type: null });
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const [batchNewTag, setBatchNewTag] = useState('');

  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => { } });

  useEffect(() => { localStorage.setItem('homestock_recipe_view', viewMode); }, [viewMode]);

  const tagCounts = useMemo(() => {
    const tCounts: Record<string, number> = {};
    const pCounts: Record<string, number> = {};
    recipes.forEach(r => { r.tags.forEach(t => tCounts[t] = (tCounts[t] || 0) + 1); });
    Object.entries(recipeTags).forEach(([parent, children]: [string, string[]]) => {
      pCounts[parent] = recipes.filter(r => r.tags.some(t => children.includes(t))).length;
    });
    return { tags: tCounts, parents: pCounts };
  }, [recipes, recipeTags]);

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const toggleParentGroup = (parent: string) => {
    const children = recipeTags[parent] || [];
    const allSelected = children.every(c => selectedTags.has(c));
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (allSelected) children.forEach(c => next.delete(c));
      else children.forEach(c => next.add(c));
      return next;
    });
  };

  const clearFilters = () => { setSelectedTags(new Set()); };
  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const cancelBatchMode = () => { setIsBatchMode(false); setSelectedIds(new Set()); };

  const handleBatchUpdate = () => {
    if (batchEditModal.type === 'tags' && batchNewTag.trim()) {
      const tagToAdd = batchNewTag.trim();
      selectedIds.forEach(id => {
        const recipe = recipes.find(r => r.id === id);
        if (recipe && !recipe.tags.includes(tagToAdd)) {
          onUpdate({ ...recipe, tags: [...recipe.tags, tagToAdd] });
        }
      });
      setBatchNewTag('');
      setBatchEditModal({ type: null });
      setSelectedIds(new Set());
      setIsBatchMode(false);
    }
  };

  const filteredRecipes = recipes.filter(r => {
    const matchesSearch = r.name.toLowerCase().includes(search.toLowerCase()) ||
      (r.ingredients && r.ingredients.some(i => i.toLowerCase().includes(search.toLowerCase())));
    let matchesTags = selectedTags.size === 0 || Array.from(selectedTags).some(selected => r.tags.includes(selected));
    return matchesSearch && matchesTags;
  });

  const requestDelete = (id: string) => {
    // 移除重複的彈窗，直接交給外層 (App.tsx) 的詳細彈窗處理
    onDelete(id);
  };

  return (
    <div className="-mt-6 space-y-0 pb-24">
      {/* 🍎 頂部導覽與搜尋：統一的毛玻璃懸浮列 */}
      <div className="sticky top-0 bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 z-30 border-b border-white/60 shadow-[0_24px_48px_rgba(0,0,0,0.06),inset_0_2px_2px_rgba(255,255,255,1)] -mx-4 px-4 h-16 flex items-center gap-3">
        <div className="relative flex-1 h-11 group">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 pointer-events-none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          <input type="text" placeholder="搜尋食譜..." className="w-full h-full pl-11 pr-4 bg-white/90 border border-white/60 rounded-full text-[17px] font-bold text-slate-800 shadow-[0_2px_10px_rgba(0,0,0,0.03)] transition-all placeholder:font-normal placeholder:text-slate-400 focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none" value={search} onChange={(e) => setSearch(e.target.value)} />

          <button onClick={() => setIsFilterOpen(!isFilterOpen)} className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full transition-all active:scale-95 ${isFilterOpen || selectedTags.size > 0 ? 'text-white bg-[#007AFF] shadow-[0_4px_12px_rgba(0,122,255,0.2)]' : 'text-slate-400 hover:bg-slate-100'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
            {selectedTags.size > 0 && !isFilterOpen && <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-[#FF3B30] rounded-full border-2 border-white"></span>}
          </button>

          {/* 🍎 篩選彈窗：32px 大圓角毛玻璃 */}
          {isFilterOpen && (
            <>
              <div className="fixed inset-0 z-40 bg-transparent" onClick={() => setIsFilterOpen(false)} />
              <div className="absolute top-full left-0 right-0 w-full mt-3 bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 shadow-[0_24px_48px_rgba(0,0,0,0.06),inset_0_2px_2px_rgba(255,255,255,1)] rounded-[32px] z-[100] border border-white/60 animate-in slide-in-from-top-2 duration-200 flex flex-col max-h-[60vh] overflow-hidden">
                <div className="flex justify-between items-center p-5 border-b border-slate-100 shrink-0">
                  <h3 className="font-black tracking-tighter text-slate-900 text-base flex items-center gap-2">標籤篩選</h3>
                  {selectedTags.size > 0 && <button onClick={clearFilters} className="text-xs text-[#FF3B30] font-black hover:bg-red-50 px-3 py-1.5 rounded-full active:scale-95 transition-all">清除 ({selectedTags.size})</button>}
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                  {Object.entries(recipeTags).map(([parent, children]: [string, string[]]) => {
                    const isExpanded = expandedParentTag === parent;
                    const allSelected = children.length > 0 && children.every(c => selectedTags.has(c));
                    const someSelected = children.some(c => selectedTags.has(c));

                    return (
                      <div key={parent} className="rounded-[20px] overflow-hidden">
                        <div className={`flex items-center p-3 rounded-[20px] hover:bg-white transition-all border border-transparent hover:border-white hover:shadow-[0_2px_10px_rgba(0,0,0,0.03)] ${someSelected ? 'bg-blue-50/50' : ''}`}>
                          <div className="flex items-center justify-center w-6 h-6 mr-3 cursor-pointer active:scale-90 transition-transform" onClick={() => toggleParentGroup(parent)}>
                            <div className={`w-5 h-5 border-[1.5px] rounded-full flex items-center justify-center transition-colors ${allSelected ? 'bg-[#007AFF] border-[#007AFF] shadow-[0_2px_10px_rgba(0,0,0,0.03)]' : (someSelected ? 'bg-[#007AFF] border-[#007AFF]' : 'border-slate-300 bg-white')}`}>
                              {allSelected && <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                              {!allSelected && someSelected && <div className="w-2.5 h-2.5 bg-white rounded-full"></div>}
                            </div>
                          </div>
                          <span className="flex-1 text-[15px] font-black tracking-wide text-slate-800 cursor-pointer flex items-center" onClick={() => setExpandedParentTag(isExpanded ? null : parent)}>
                            {parent} <span className="text-xs text-slate-400 font-bold ml-2">({tagCounts.parents[parent] || 0})</span>
                          </span>
                          <button onClick={() => setExpandedParentTag(isExpanded ? null : parent)} className={`p-1.5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></button>
                        </div>
                        {isExpanded && (
                          <div className="ml-10 pl-3 border-l-2 border-slate-100 space-y-1.5 py-2 animate-in slide-in-from-top-1">
                            {children.map((child: string) => {
                              const isSubSelected = selectedTags.has(child);
                              return (
                                <div key={child} className="flex items-center p-2 hover:bg-white rounded-[24px] cursor-pointer transition-all border border-transparent hover:border-white hover:shadow-[0_2px_10px_rgba(0,0,0,0.03)]" onClick={() => toggleTag(child)}>
                                  <div className={`w-4 h-4 border-[1.5px] rounded-full flex items-center justify-center mr-3 transition-colors ${isSubSelected ? 'bg-[#007AFF] border-[#007AFF] shadow-[0_2px_10px_rgba(0,0,0,0.03)]' : 'border-slate-300 bg-white'}`}>
                                    {isSubSelected && <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                                  </div>
                                  <span className={`text-[13px] font-black tracking-wide ${isSubSelected ? 'text-[#007AFF]' : 'text-slate-500'}`}>{child} <span className="text-slate-400 font-bold ml-1">({tagCounts.tags[child] || 0})</span></span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="p-5 bg-white/90 border-t border-slate-100 shrink-0 sticky bottom-0 backdrop-blur-[40px] backdrop-saturate-150">
                  <button onClick={() => setIsFilterOpen(false)} className="w-full py-4 bg-[#007AFF] text-white font-black tracking-widest rounded-full text-[15px] shadow-[0_4px_12px_rgba(0,122,255,0.2)] border-none hover:bg-blue-600 active:scale-[0.96] transition-all">確定套用</button>
                </div>
              </div>
            </>
          )}
        </div>
        <button onClick={() => setIsBatchMode(!isBatchMode)} className={`h-11 w-11 flex items-center justify-center rounded-full transition-all active:scale-95 shrink-0 border border-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] ${isBatchMode ? 'bg-[#007AFF] text-white shadow-[0_4px_12px_rgba(0,122,255,0.2)]' : 'bg-white/80 text-[#007AFF] hover:bg-white'}`} title="批次修改">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 11 3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
        </button>
        <button onClick={() => setIsViewMenuOpen(true)} className={`h-11 w-11 flex items-center justify-center rounded-full transition-all active:scale-95 shrink-0 border border-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] ${viewMode === 'review' ? 'bg-[#007AFF] text-white shadow-[0_4px_12px_rgba(0,122,255,0.2)]' : 'bg-white/80 text-[#007AFF] hover:bg-white'}`}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="21" y2="21" /><line x1="4" x2="20" y1="3" y2="3" /><line x1="4" x2="20" y1="12" y2="12" /><circle cx="14" cy="3" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="16" cy="21" r="2" /></svg>
        </button>
      </div>

      <div className="h-4 w-full shrink-0"></div>
      <div className="pb-20">
        {filteredRecipes.length === 0 ? (
          <div className="text-center py-20 text-slate-500 bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 rounded-[32px] border border-white/60 shadow-[0_24px_48px_rgba(0,0,0,0.06),inset_0_2px_2px_rgba(255,255,255,1)]">
            <p className="font-black text-lg tracking-tighter text-slate-700">沒有符合的食譜</p>
            <p className="text-sm font-bold mt-1">試試看調整篩選條件</p>
          </div>
        ) : (
          filteredRecipes.map(recipe => (
            <div key={recipe.id} id={'recipe-' + recipe.id} className="mb-4">
              <RecipeCard recipe={recipe} inventoryItems={inventoryItems} shoppingList={shoppingList} isBatchMode={isBatchMode} isSelected={selectedIds.has(recipe.id)} viewMode={viewMode} onToggleSelection={toggleSelection} onEdit={() => onEdit(recipe)} onDuplicate={() => onDuplicate(recipe)} onShareSuccess={() => setConfirmConfig({ isOpen: true, title: '複製成功', message: '食譜文字已經複製，可以貼給朋友囉！', isAlert: true, onConfirm: () => setConfirmConfig(prev => ({ ...prev, isOpen: false })) })} onDeleteRequest={() => requestDelete(recipe.id)} onAddToShopping={onAddToShopping} onUpdate={onUpdate} isActiveSwipe={activeSwipeId === recipe.id} onSwipeStart={() => setActiveSwipeId(recipe.id)} />
            </div>
          ))
        )}
      </div>

      {/* 批次操作列：毛玻璃懸浮 */}
      {isBatchMode && (
        <div className="fixed bottom-[100px] left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 border border-white/60 px-4 py-2.5 rounded-full shadow-[0_24px_48px_rgba(0,0,0,0.06),inset_0_2px_2px_rgba(255,255,255,1)] z-[60] animate-in slide-in-from-bottom-5">
          <span className="text-sm font-black text-[#007AFF] tracking-widest mr-2 whitespace-nowrap shrink-0">{selectedIds.size} 已選</span>
          <button onClick={() => setBatchEditModal({ type: 'tags' })} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full text-xs font-black transition-colors active:scale-95 whitespace-nowrap shrink-0">+ 標籤</button>
          <div className="w-px h-5 bg-slate-200 mx-1"></div>
          <button onClick={cancelBatchMode} className="p-2 text-slate-400 hover:text-[#FF3B30] hover:bg-red-50 rounded-full transition-all active:scale-95 shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>
      )}

      {/* 批次修改標籤彈窗 */}
      {batchEditModal.type && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[40px] backdrop-saturate-150 animate-in fade-in duration-200" onClick={() => setBatchEditModal({ type: null })}>
          <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 rounded-[32px] shadow-[0_24px_48px_rgba(0,0,0,0.06),inset_0_2px_2px_rgba(255,255,255,1)] border border-white/60 w-full max-w-sm p-8 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <h3 className="font-black tracking-tighter text-xl text-slate-900 mb-6 text-center whitespace-nowrap">批次新增標籤</h3>
            <input autoFocus type="text" className="w-full px-5 py-4 rounded-full border border-white/60 bg-white/90 shadow-[0_2px_10px_rgba(0,0,0,0.03)] text-[17px] font-bold -[#007AFF]/15 mb-6 transition-all text-center focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none" value={batchNewTag} onChange={e => setBatchNewTag(e.target.value)} placeholder="輸入要加入的標籤..." />
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setBatchEditModal({ type: null })} className="py-3.5 rounded-full font-black text-slate-500 bg-white border border-white shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:bg-slate-50 active:scale-[0.96] transition-all text-[15px] tracking-widest">取消</button>
              <button onClick={handleBatchUpdate} className="py-3.5 rounded-full font-black text-white bg-[#007AFF] shadow-[0_4px_12px_rgba(0,122,255,0.2)] hover:bg-blue-600 active:scale-[0.96] transition-all text-[15px] tracking-widest border-none">確認</button>
            </div>
          </div>
        </div>
      )}

      {/* 檢視設定彈窗 */}
      {isViewMenuOpen && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[40px] backdrop-saturate-150 animate-in fade-in duration-200" onClick={() => setIsViewMenuOpen(false)}>
          <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 w-full sm:max-w-sm rounded-[32px] mb-28 sm:mb-0 shadow-[0_24px_48px_rgba(0,0,0,0.06),inset_0_2px_2px_rgba(255,255,255,1)] border border-white/60 animate-in slide-in-from-bottom duration-200 flex flex-col max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6 border-b border-slate-100 shrink-0">
              <h3 className="text-xl font-black tracking-tighter text-slate-900">檢視設定</h3>
              <button onClick={() => setIsViewMenuOpen(false)} className="p-2.5 bg-white border border-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-full text-slate-500 hover:bg-slate-50 active:scale-95 transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-8 overflow-y-auto">
              <div className="space-y-4">
                <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest pl-1">顯示模式</p>
                <div className="flex items-center justify-between bg-white px-5 py-4 rounded-[24px] border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
                  <div className="flex items-center gap-3 text-slate-800">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><path d="M3 9h18" /><path d="M9 21V9" /></svg>
                    <span className="text-[15px] font-black tracking-wide">開啟心得模式 (隱藏步驟)</span>
                  </div>
                  <button onClick={() => setViewMode(viewMode === 'default' ? 'review' : 'default')} className={`w-14 h-8 rounded-full transition-colors duration-300 focus:outline-none flex items-center px-1 shadow-[0_2px_10px_rgba(0,0,0,0.03)] ${viewMode === 'review' ? 'bg-[#34C759]' : 'bg-slate-200'}`}>
                    <div className={`w-6 h-6 bg-white rounded-full shadow-[0_2px_10px_rgba(0,0,0,0.03)] transform transition-transform duration-300 ${viewMode === 'review' ? 'translate-x-6' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
            </div>
            <div className="p-6 pt-0 shrink-0 mt-2">
              <button
                onClick={() => setIsViewMenuOpen(false)}
                className="w-full py-4 rounded-full font-black text-white bg-[#007AFF] shadow-[0_4px_12px_rgba(0,122,255,0.2)] border-none hover:bg-blue-600 active:scale-[0.96] transition-all text-[15px] tracking-widest"
              >
                確定
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal isOpen={confirmConfig.isOpen} title={confirmConfig.title} message={confirmConfig.message} onConfirm={confirmConfig.onConfirm} onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))} />
    </div>
  );
};

export default RecipeView;