import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Recipe, InventoryItem, ShoppingItem, RecipeTagStructure } from '../types';
import { estimateRecipeCostAndNutrition, CostNutritionResult } from '../geminiService';
import ConfirmationModal from './ConfirmationModal';
import InputModal from './InputModal';

interface RecipeViewProps {
  recipes: Recipe[];
  inventoryItems?: InventoryItem[];
  shoppingList?: ShoppingItem[];
  recipeTags: RecipeTagStructure;
  onDelete: (id: string) => void;
  onEdit: (recipe: Recipe) => void;
  onUpdate: (recipe: Recipe) => void;
  onAddToShopping: (name: string) => void;
}

interface BatchEditState {
  type: 'tags' | null;
}

const normalizeForMatch = (text: string) => {
  if (!text) return '';
  return text
    .replace(/[0-9.]+|[gmlkg克匙杯顆個包條片兩的只毫升公克]/gi, '')
    .replace(/[()\[\]\s]/g, '')
    .trim()
    .toLowerCase();
};

const scaleString = (text: string, factor: number, format: 'replace' | 'arrow') => {
  if (factor === 1 || !text) return text;

  const allowedUnits = [
    'g', 'ml', 'kg', 'l', 'tsp', 'tbsp', 'oz', 'lb', 'cup', 'cc',
    '公克', '毫升', '克', '公斤', '升', '茶匙', '湯匙', '杯', '碗',
    '顆', '個', '條', '片', '只', '台斤', '兩', '把', '瓣', '包', '罐', '瓶'
  ].join('|');

  const regex = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${allowedUnits})(?![a-zA-Z\\u4e00-\u9fa5])`, 'gi');

  return text.replace(regex, (match, num, unit) => {
    const val = parseFloat(num);
    if (isNaN(val)) return match;
    const scaled = Math.round(val * factor);

    if (format === 'arrow') return `${match} ➝ ${scaled}${unit}`;
    return `${scaled}${unit}`;
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
}> = ({ recipe, inventoryItems, shoppingList, isBatchMode, isSelected, viewMode, onToggleSelection, onEdit, onDeleteRequest, onAddToShopping }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [ingredientsExpanded, setIngredientsExpanded] = useState(true);
  const [stepsExpanded, setStepsExpanded] = useState(true);
  const [notesExpanded, setNotesExpanded] = useState(true);
  const [isEstimating, setIsEstimating] = useState(false);
  const [estimationResult, setEstimationResult] = useState<CostNutritionResult | null>(null);
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

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isBatchMode) return;
    startX.current = e.touches[0].clientX;
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
    } catch (error) {
      console.error("估算失敗:", error);
      // 如果 AI 伺服器塞車或報錯，跳出我們漂亮的彈窗提示
      setModalConfig({
        isOpen: true,
        title: 'AI 伺服器忙碌中',
        message: '目前估算服務負載較高 (503 錯誤)，請稍等幾分鐘後再試一次！',
        isAlert: true,
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
      });
    } finally {
      // 確保不管成功還是失敗，按鈕都會停止「轉圈圈」
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

    let matchedItems = inventoryItems.filter(inv => {
      const invSub = (inv.subCategory || '').toLowerCase();
      return invSub.includes(coreTarget) || coreTarget.includes(invSub);
    });

    if (matchedItems.length === 0) {
      matchedItems = inventoryItems.filter(inv => {
        const invName = inv.name.toLowerCase();
        return invName.includes(coreTarget) || coreTarget.includes(invName);
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

  if (viewMode === 'review') {
    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          if (isBatchMode) onToggleSelection(recipe.id);
          else onEdit();
        }}
        className={`bg-white/80 backdrop-blur-md p-5 transition-all relative rounded-[28px] border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.02)] ${isSelected && isBatchMode ? 'bg-white' : 'hover:bg-white'
          }`}
      >
        {isBatchMode && (
          <div className="absolute top-5 left-4 z-10">
            <div className={`w-6 h-6 rounded-full border flex items-center justify-center transition-colors ${isSelected ? 'bg-[#007AFF] border-[#007AFF] shadow-md shadow-blue-500/20' : 'bg-white border-slate-300'}`}>
              {isSelected && <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
            </div>
          </div>
        )}
        <div className={`${isBatchMode ? 'pl-8' : ''}`}>
          <div className="flex justify-between items-start mb-3">
            <h3 className="text-[17px] font-black tracking-tight text-slate-800 leading-tight">{recipe.name}</h3>
            <div className="flex flex-wrap justify-end gap-1.5 ml-2">
              {recipe.tags.slice(0, 2).map(t => (
                <span key={t} className="text-[10px] bg-slate-100/80 text-slate-500 px-2.5 py-1 rounded-full font-black tracking-widest border border-white shadow-sm whitespace-nowrap">{t}</span>
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
    );
  }

  return (
    <div className="relative overflow-hidden group rounded-[28px]">
      {!isBatchMode && (
        <div
          className={`absolute inset-0 bg-[#FF3B30] flex justify-end items-center px-6 z-0 rounded-[28px] transition-opacity duration-300 ${offsetX === 0 ? 'opacity-0' : 'opacity-100'}`}
          onClick={(e) => {
            e.stopPropagation();
            onDeleteRequest();
            setOffsetX(0);
            setSwipedOpen(false);
          }}
        >
          <div className="flex flex-col items-center text-white">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            <span className="text-[10px] font-black mt-1 uppercase tracking-widest">刪除</span>
          </div>
        </div>
      )}

      <div
        className={`bg-white/80 backdrop-blur-xl transition-all duration-300 relative z-10 ${isOpen || isSelected ? 'bg-white' : 'hover:bg-white'} p-5 rounded-[28px] border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.02)]`}
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
            <div className={`w-6 h-6 rounded-full border flex items-center justify-center transition-colors ${isSelected ? 'bg-[#007AFF] border-[#007AFF] shadow-md shadow-blue-500/20' : 'bg-white border-slate-300'}`}>
              {isSelected && <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
            </div>
          </div>
        )}

        <div className={`${isBatchMode ? 'pl-8' : ''}`}>
          <h3 className="text-[17px] font-black tracking-tight text-slate-800 leading-tight mb-2.5">
            {recipe.name}
          </h3>

          <div className="flex flex-wrap gap-2 mb-1">
            {recipe.tags && recipe.tags.length > 0 ? (
              recipe.tags.map((tag, idx) => (
                <span
                  key={idx}
                  className="text-[10px] bg-slate-100/80 text-slate-500 px-2.5 py-1 rounded-full font-black border border-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] whitespace-nowrap tracking-widest"
                >
                  {tag}
                </span>
              ))
            ) : (
              <span className="text-[10px] bg-slate-50/80 text-slate-400 px-2.5 py-1 rounded-full font-black border border-white/50 whitespace-nowrap tracking-widest">
                無標籤
              </span>
            )}
          </div>
        </div>

        {isOpen && !isBatchMode && (
          <div className="mt-5 mb-2 space-y-4 animate-in slide-in-from-top-2 duration-300 cursor-default" onClick={(e) => e.stopPropagation()}>

            {/* 份量調整區塊：玻璃卡片 */}
            <div className="bg-white/60 backdrop-blur-sm rounded-[24px] p-4 border border-white shadow-[0_2px_8px_rgba(0,0,0,0.02)] flex flex-wrap items-center justify-between gap-3">
              <span className="text-[13px] font-black tracking-wider text-slate-600 whitespace-nowrap flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#007AFF]"><path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" /><path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /><path d="M12 2v2" /><path d="M12 22v-2" /><path d="m17 17-1.4-1.4" /><path d="m4.9 4.9 1.4 1.4" /><path d="m19.1 4.9-1.4 1.4" /><path d="m4.9 19.1 1.4-1.4" /></svg>
                份量調整
              </span>
              <div className="flex items-center gap-2">
                {[0.5, 1.0, 2.0].map(val => (
                  <button
                    key={val}
                    onClick={() => setScaleFactor(val)}
                    className={`h-9 w-[46px] rounded-full text-xs font-black tracking-wider transition-all flex items-center justify-center border ${scaleFactor === val
                      ? 'bg-[#007AFF] text-white border-[#007AFF] shadow-[0_4px_12px_rgba(0,122,255,0.3)] scale-105'
                      : 'bg-white text-slate-500 border-white shadow-sm hover:bg-slate-50'
                      }`}
                  >
                    {val}x
                  </button>
                ))}
                <div className="relative h-9 w-16">
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    className="w-full h-full pl-2 pr-5 text-xs font-black tracking-widest text-center bg-white border border-white shadow-sm rounded-full outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/20 transition-all text-slate-700"
                    value={scaleFactor}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val) && val > 0) setScaleFactor(val);
                      else if (e.target.value === '') setScaleFactor(1);
                    }}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400 pointer-events-none">x</span>
                </div>
              </div>
            </div>

            {/* 估算按鈕 */}
            <div className="flex justify-end items-center mb-2">
              <button
                onClick={handleEstimate}
                disabled={isEstimating}
                className="flex items-center gap-1.5 bg-white border border-white shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[#007AFF] px-5 py-2.5 rounded-full text-xs font-black tracking-widest hover:bg-blue-50 transition-all active:scale-95"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                {isEstimating ? '重新估算中...' : '估算成本與營養'}
              </button>
            </div>

            {/* AI 思考中的骨架屏 (Skeleton Loading) - 大幅降低等待焦慮 */}
            {isEstimating && (
              <div className="bg-white/70 backdrop-blur-2xl border border-white/80 rounded-[32px] p-6 shadow-[0_12px_40px_rgba(0,0,0,0.04)] animate-pulse">
                <div className="flex gap-4 mb-6">
                  <div className="flex-1 bg-slate-200/50 rounded-[24px] h-24"></div>
                  <div className="flex-1 bg-slate-200/50 rounded-[24px] h-24"></div>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-6">
                  <div className="bg-slate-200/50 rounded-[20px] h-16"></div>
                  <div className="bg-slate-200/50 rounded-[20px] h-16"></div>
                  <div className="bg-slate-200/50 rounded-[20px] h-16"></div>
                </div>
                <div className="space-y-3">
                  <div className="h-4 bg-slate-200/50 rounded-full w-1/3 mb-4"></div>
                  <div className="h-10 bg-slate-200/50 rounded-2xl w-full"></div>
                  <div className="h-10 bg-slate-200/50 rounded-2xl w-full"></div>
                </div>
              </div>
            )}

            {/* Apple Health 風格的全新結果卡片 */}
            {finalEstimation && !isEstimating && (
              <div className="bg-white/80 backdrop-blur-2xl border border-white/80 rounded-[32px] p-6 shadow-[0_12px_40px_rgba(0,0,0,0.06)] animate-in slide-in-from-top-4 duration-500">

                {/* 頂部兩大指標：成本與熱量 */}
                <div className="flex gap-3 mb-5">
                  <div className="flex-1 bg-gradient-to-br from-emerald-50 to-emerald-100/50 rounded-[24px] p-4.5 border border-white shadow-sm flex flex-col justify-between">
                    <span className="text-[11px] font-black text-emerald-600 tracking-widest uppercase flex items-center gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                      預估總成本
                    </span>
                    <div className="flex items-baseline gap-0.5 text-emerald-700 mt-2 drop-shadow-sm">
                      <span className="text-lg font-bold">$</span>
                      <span className="text-4xl font-black tracking-tighter leading-none">{Math.round(finalEstimation.totalCost)}</span>
                    </div>
                  </div>

                  <div className="flex-1 bg-gradient-to-br from-orange-50 to-orange-100/50 rounded-[24px] p-4.5 border border-white shadow-sm flex flex-col justify-between">
                    <span className="text-[11px] font-black text-orange-600 tracking-widest uppercase flex items-center gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" /><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" /><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" /><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" /></svg>
                      總熱量
                    </span>
                    <div className="flex items-baseline gap-1 text-orange-700 mt-2 drop-shadow-sm">
                      <span className="text-4xl font-black tracking-tighter leading-none">{finalEstimation.nutrition.calories}</span>
                      <span className="text-xs font-bold text-orange-500">kcal</span>
                    </div>
                  </div>
                </div>

                {/* 三大營養素：果凍方塊 */}
                <div className="grid grid-cols-3 gap-3 mb-6">
                  <div className="bg-blue-50/80 rounded-[20px] p-3 text-center border border-white shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
                    <span className="block text-[11px] text-blue-500 font-black tracking-widest mb-0.5">蛋白質</span>
                    <span className="text-lg font-black text-blue-700 tracking-tight">{finalEstimation.nutrition.protein}g</span>
                  </div>
                  <div className="bg-purple-50/80 rounded-[20px] p-3 text-center border border-white shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
                    <span className="block text-[11px] text-purple-500 font-black tracking-widest mb-0.5">碳水</span>
                    <span className="text-lg font-black text-purple-700 tracking-tight">{finalEstimation.nutrition.carbs}g</span>
                  </div>
                  <div className="bg-amber-50/80 rounded-[20px] p-3 text-center border border-white shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
                    <span className="block text-[11px] text-amber-500 font-black tracking-widest mb-0.5">脂肪</span>
                    <span className="text-lg font-black text-amber-700 tracking-tight">{finalEstimation.nutrition.fat}g</span>
                  </div>
                </div>

                {/* 成本明細清單：白色膠囊式 */}
                <div className="space-y-2">
                  <div className="flex justify-between items-end mb-3 px-1">
                    <p className="text-[11px] text-slate-400 tracking-widest font-black uppercase">成本明細 (可點擊修改)</p>
                    <span className="text-[11px] text-slate-400 font-bold">總重: {finalEstimation.totalWeight}g</span>
                  </div>

                  {finalEstimation.ingredients.map((ing, idx) => (
                    <button
                      key={idx}
                      onClick={(e) => { e.stopPropagation(); openPriceEdit(ing.name, ing.finalCost); }}
                      className="w-full flex justify-between items-center bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)] px-4 py-3 rounded-[20px] active:scale-[0.98] transition-all hover:border-[#007AFF]/30 group"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-2.5 h-2.5 rounded-full shadow-sm ${ing.source === 'inventory' ? 'bg-emerald-400 shadow-emerald-400/50' : 'bg-slate-300'}`}></div>
                        <div className="text-left">
                          <span className="text-[15px] text-slate-700 font-black tracking-wide block leading-tight">{ing.name}</span>
                          <span className="text-[11px] text-slate-400 font-bold">{ing.amount}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[17px] font-black tracking-tight ${ing.isOverridden ? 'text-orange-500' : (ing.source === 'inventory' ? 'text-emerald-600' : 'text-slate-500')}`}>
                          ${Math.round(ing.finalCost)}
                        </span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300 group-hover:text-[#007AFF] transition-colors"><path d="m9 18 6-6-6-6" /></svg>
                      </div>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] font-bold text-slate-400 mt-5 text-center bg-slate-50 py-2 rounded-full">* 定錨基準：頂級超市/有機商店價格</p>
              </div>
            )}

            <div className="border border-white/80 rounded-[24px] overflow-hidden flex flex-col bg-white/50 backdrop-blur-md shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
              <button
                type="button"
                onClick={() => setIngredientsExpanded(!ingredientsExpanded)}
                className="w-full bg-white/60 px-5 py-4 flex justify-between items-center text-[15px] font-black tracking-wide text-slate-800 shrink-0 border-b border-white/60 transition-colors hover:bg-white"
              >
                <span>食材準備區</span>
                <span className="text-[11px] font-bold text-slate-400">{ingredientsExpanded ? '點擊收合' : '點擊展開'}</span>
              </button>
              {ingredientsExpanded && (
                <div className="p-4 space-y-2 animate-in fade-in duration-200 max-h-56 overflow-y-auto custom-scrollbar overscroll-contain">
                  {scaledIngredientList.map((ingItem, idx) => {
                    const status = getStockStatus(ingItem.original);
                    const isAvailable = status.found && status.quantity > 0;
                    const isInCart = shoppingList?.some(item => item.name.trim().toLowerCase() === ingItem.original.trim().toLowerCase());

                    return (
                      <div key={idx} className="flex justify-between text-sm border-b border-white/60 last:border-none pb-2.5 last:pb-0 items-center">
                        <div className="flex-1 mr-3 min-w-0">
                          <span className={`font-black tracking-wide block truncate ${isAvailable ? 'text-slate-800' : 'text-slate-500'}`}>{ingItem.display}</span>
                          {status.found ? (
                            <span className={`text-[11px] font-black tracking-widest mt-0.5 block ${status.quantity > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>庫存: {status.quantity}</span>
                          ) : (
                            <span className="text-[10px] font-black tracking-widest mt-0.5 inline-block text-slate-400 bg-slate-100/80 px-2 py-0.5 rounded-full border border-white">無紀錄</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); if (!isInCart) onAddToShopping(ingItem.original); }}
                          disabled={isInCart}
                          className={`p-2.5 rounded-full transition-all shrink-0 border ${isInCart ? 'bg-slate-100 text-slate-400 border-transparent cursor-default' : 'bg-white border-white text-[#007AFF] hover:bg-blue-50 active:scale-90 shadow-sm'}`}
                        >
                          {isInCart ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></svg>}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border border-white/80 rounded-[24px] overflow-hidden flex flex-col bg-white/50 backdrop-blur-md shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
              <button
                type="button"
                onClick={() => setStepsExpanded(!stepsExpanded)}
                className="w-full bg-blue-50/50 px-5 py-4 flex justify-between items-center text-[15px] font-black tracking-wide text-[#007AFF] shrink-0 border-b border-blue-50 transition-colors hover:bg-blue-50/80"
              >
                <span>料理做法區</span>
                <span className="text-[11px] font-bold text-blue-400">{stepsExpanded ? '點擊收合' : '點擊展開'}</span>
              </button>
              {stepsExpanded && (
                <div className="p-4 animate-in fade-in duration-200 max-h-80 overflow-y-auto custom-scrollbar overscroll-contain">
                  <ol className="list-decimal list-outside pl-5 space-y-3.5">
                    {formattedSteps.length > 0 ? formattedSteps.map((step, idx) => (
                      <li key={idx} className="text-[15px] font-bold text-slate-700 leading-relaxed pl-1 marker:text-[#007AFF] marker:font-black">{step}</li>
                    )) : <li className="text-sm font-bold text-slate-400 italic">暫無步驟資料</li>}
                  </ol>
                </div>
              )}
            </div>

            <div className="border border-white/80 rounded-[24px] overflow-hidden flex flex-col bg-white/50 backdrop-blur-md shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
              <button
                type="button"
                onClick={() => setNotesExpanded(!notesExpanded)}
                className="w-full bg-white/60 px-5 py-4 flex justify-between items-center text-[15px] font-black tracking-wide text-slate-800 shrink-0 border-b border-white/60 transition-colors hover:bg-white"
              >
                <span>料理心得</span>
                <span className="text-[11px] font-bold text-slate-400">{notesExpanded ? '點擊收合' : '點擊展開'}</span>
              </button>
              {notesExpanded && (
                <div className="p-5 animate-in fade-in duration-200 text-[15px] font-bold text-slate-600 leading-relaxed whitespace-pre-wrap">
                  {recipe.review || <span className="text-slate-400 italic font-normal">尚無心得，點擊編輯新增...</span>}
                </div>
              )}
            </div>
          </div>
        )}

        {!isBatchMode && (
          <div className="flex justify-between items-center mt-5 pt-3 border-t border-white/80">
            <div className="flex items-center gap-2">
              <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-2.5 text-slate-400 hover:text-[#007AFF] hover:bg-white border border-transparent hover:border-white hover:shadow-sm transition-all rounded-full active:scale-95" title="編輯">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></svg>
              </button>
              {recipe.sourceLink && (
                <a href={recipe.sourceLink} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="p-2.5 text-slate-400 hover:text-[#007AFF] hover:bg-white border border-transparent hover:border-white hover:shadow-sm transition-all rounded-full active:scale-95" title="來源連結">
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
    </div>
  );
};

const RecipeView: React.FC<RecipeViewProps> = ({
  recipes, inventoryItems, shoppingList, recipeTags, onDelete, onEdit, onUpdate, onAddToShopping
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
  const [viewMode, setViewMode] = useState<'default' | 'review'>(() => {
    try { return localStorage.getItem('homestock_recipe_view') === 'review' ? 'review' : 'default'; } catch { return 'default'; }
  });
  const [isBatchMode, setIsBatchMode] = useState(false);
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
    setConfirmConfig({
      isOpen: true,
      title: '確認刪除',
      message: '確定要刪除這份食譜嗎？此動作無法復原。',
      onConfirm: () => {
        onDelete(id);
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  return (
    <div className="-mt-6 space-y-0 pb-24">
      {/* iOS 26 頂部搜尋列 (無縫對齊) */}
      <div className="sticky top-0 bg-white/70 backdrop-blur-2xl z-30 border-b border-white/60 -mx-4 px-4 h-16 flex items-center gap-3">
        <div className="relative flex-1 h-11 group">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 pointer-events-none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          <input type="text" placeholder="搜尋食譜..." className="w-full h-full pl-11 pr-4 bg-white/80 border border-white/80 rounded-full text-[17px] font-bold text-slate-800 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none transition-all backdrop-blur-sm placeholder:font-normal placeholder:text-slate-400" value={search} onChange={(e) => setSearch(e.target.value)} />

          <button onClick={() => setIsFilterOpen(!isFilterOpen)} className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full transition-all active:scale-95 ${isFilterOpen || selectedTags.size > 0 ? 'text-white bg-[#007AFF] shadow-md shadow-blue-500/20' : 'text-slate-400 hover:bg-slate-100'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
            {selectedTags.size > 0 && !isFilterOpen && <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-[#FF3B30] rounded-full border-2 border-white"></span>}
          </button>

          {/* 標籤篩選 Modal */}
          {isFilterOpen && (
            <>
              <div className="fixed inset-0 z-40 bg-transparent" onClick={() => setIsFilterOpen(false)} />
              <div className="absolute top-full left-0 right-0 w-full mt-3 bg-white/90 backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.1)] rounded-[32px] z-[100] border border-white/80 animate-in slide-in-from-top-2 duration-200 flex flex-col max-h-[60vh] overflow-hidden">
                <div className="flex justify-between items-center p-5 border-b border-white/60 shrink-0">
                  <h3 className="font-black tracking-tighter text-slate-900 text-base flex items-center gap-2">訊息篩選</h3>
                  {selectedTags.size > 0 && <button onClick={clearFilters} className="text-xs text-rose-500 font-black hover:text-rose-600 bg-rose-50 px-3 py-1.5 rounded-full active:scale-95 transition-all">清除 ({selectedTags.size})</button>}
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                  {Object.entries(recipeTags).map(([parent, children]: [string, string[]]) => {
                    const isExpanded = expandedParentTag === parent;
                    const allSelected = children.every(c => selectedTags.has(c));
                    const someSelected = children.some(c => selectedTags.has(c));

                    return (
                      <div key={parent} className="rounded-[20px] overflow-hidden">
                        <div className={`flex items-center p-3 rounded-[20px] hover:bg-white transition-all border border-transparent hover:border-white hover:shadow-sm ${someSelected ? 'bg-blue-50/50' : ''}`}>
                          <div className="flex items-center justify-center w-6 h-6 mr-3 cursor-pointer active:scale-90 transition-transform" onClick={() => toggleParentGroup(parent)}>
                            <div className={`w-5 h-5 border-[1.5px] rounded-full flex items-center justify-center transition-colors ${allSelected ? 'bg-[#007AFF] border-[#007AFF] shadow-sm shadow-blue-500/20' : (someSelected ? 'bg-[#007AFF] border-[#007AFF]' : 'border-slate-300 bg-white')}`}>
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
                                <div key={child} className="flex items-center p-2 hover:bg-white rounded-2xl cursor-pointer transition-all border border-transparent hover:border-white hover:shadow-sm" onClick={() => toggleTag(child)}>
                                  <div className={`w-4 h-4 border-[1.5px] rounded-full flex items-center justify-center mr-3 transition-colors ${isSubSelected ? 'bg-[#007AFF] border-[#007AFF] shadow-sm' : 'border-slate-300 bg-white'}`}>
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
                <div className="p-5 bg-white/60 border-t border-white/60 shrink-0 sticky bottom-0 backdrop-blur-md">
                  <button onClick={() => setIsFilterOpen(false)} className="w-full py-4 bg-[#007AFF] text-white font-black tracking-widest rounded-full text-sm shadow-[0_8px_20px_rgba(0,122,255,0.3)] border-t border-l border-white/40 border-b border-r border-black/10 active:scale-[0.96] transition-all">套用</button>
                </div>
              </div>
            </>
          )}
        </div>
        <button onClick={() => setIsBatchMode(!isBatchMode)} className={`h-11 w-11 flex items-center justify-center rounded-full transition-all active:scale-95 shrink-0 border border-white shadow-sm ${isBatchMode ? 'bg-[#007AFF] text-white shadow-[0_8px_20px_rgba(0,122,255,0.3)]' : 'bg-white/80 text-[#007AFF] hover:bg-white'}`} title="批次修改">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 11 3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
        </button>
        <button onClick={() => setIsViewMenuOpen(true)} className={`h-11 w-11 flex items-center justify-center rounded-full transition-all active:scale-95 shrink-0 border border-white shadow-sm ${viewMode === 'review' ? 'bg-[#007AFF] text-white shadow-[0_8px_20px_rgba(0,122,255,0.3)]' : 'bg-white/80 text-[#007AFF] hover:bg-white'}`}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="21" y2="21" /><line x1="4" x2="20" y1="3" y2="3" /><line x1="4" x2="20" y1="12" y2="12" /><circle cx="14" cy="3" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="16" cy="21" r="2" /></svg>
        </button>
      </div>

      {/* 這裡已經移除了 px-4，讓卡片能夠完美與總覽等寬 */}
      <div className="h-4 w-full shrink-0"></div>
      <div className="pb-20">
        {filteredRecipes.length === 0 ? (
          <div className="text-center py-20 text-slate-500 bg-white/60 backdrop-blur-xl rounded-[32px] border border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
            <p className="font-black text-lg tracking-tighter text-slate-700">沒有符合的食譜</p>
            <p className="text-sm font-bold mt-1">試試看調整篩選條件</p>
          </div>
        ) : (
          filteredRecipes.map(recipe => (
            <div key={recipe.id} className="mb-4 rounded-[28px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-white/80 overflow-hidden bg-white/70 backdrop-blur-md">
              <RecipeCard recipe={recipe} inventoryItems={inventoryItems} shoppingList={shoppingList} isBatchMode={isBatchMode} isSelected={selectedIds.has(recipe.id)} viewMode={viewMode} onToggleSelection={toggleSelection} onEdit={() => onEdit(recipe)} onDeleteRequest={() => requestDelete(recipe.id)} onAddToShopping={onAddToShopping} />
            </div>
          ))
        )}
      </div>

      {isBatchMode && (
        <div className="fixed bottom-[100px] left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white/90 backdrop-blur-2xl border border-white/80 px-4 py-2.5 rounded-full shadow-[0_12px_40px_rgba(0,0,0,0.1)] z-[60] animate-in slide-in-from-bottom-5">
          <span className="text-sm font-black text-[#007AFF] tracking-widest mr-2 whitespace-nowrap shrink-0">{selectedIds.size} 已選</span>
          <button onClick={() => setBatchEditModal({ type: 'tags' })} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full text-xs font-black transition-colors active:scale-95 whitespace-nowrap shrink-0">+ 標籤</button>
          <div className="w-px h-5 bg-slate-200 mx-1"></div>
          <button onClick={cancelBatchMode} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-full transition-colors active:scale-95 shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>
      )}

      {batchEditModal.type && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-200" onClick={() => setBatchEditModal({ type: null })}>
          <div className="bg-white/90 backdrop-blur-2xl rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-white/80 w-full max-w-sm p-8 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <h3 className="font-black tracking-tighter text-xl text-slate-900 mb-6 text-center whitespace-nowrap">批次新增標籤</h3>
            <input autoFocus type="text" className="w-full px-5 py-4 rounded-full border border-white/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.03)] text-[17px] font-bold outline-none focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] mb-6 transition-all text-center" value={batchNewTag} onChange={e => setBatchNewTag(e.target.value)} placeholder="輸入要加入的標籤..." />
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setBatchEditModal({ type: null })} className="py-3.5 rounded-full font-black text-slate-500 bg-white border border-white shadow-sm hover:bg-slate-50 active:scale-[0.96] transition-all text-sm">取消</button>
              <button onClick={handleBatchUpdate} className="py-3.5 rounded-full font-black text-white bg-[#007AFF] shadow-[0_8px_20px_rgba(0,122,255,0.3)] border-t border-l border-white/40 border-b border-r border-black/10 hover:bg-blue-600 active:scale-[0.96] transition-all text-sm">確認</button>
            </div>
          </div>
        </div>
      )}

      {isViewMenuOpen && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-200" onClick={() => setIsViewMenuOpen(false)}>
          <div className="bg-white/90 backdrop-blur-2xl w-full sm:max-w-sm sm:rounded-[32px] rounded-t-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-white/80 animate-in slide-in-from-bottom duration-200 flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6 border-b border-white/60 shrink-0">
              <h3 className="text-xl font-black tracking-tighter text-slate-900">檢視設定</h3>
              <button onClick={() => setIsViewMenuOpen(false)} className="p-2.5 bg-white border border-white shadow-sm rounded-full text-slate-500 hover:bg-slate-50 active:scale-95 transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-8 overflow-y-auto">
              <div className="space-y-4">
                <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest pl-1">顯示模式</p>
                <div className="flex items-center justify-between bg-white px-5 py-4 rounded-[24px] border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                  <div className="flex items-center gap-3 text-slate-800">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><path d="M3 9h18" /><path d="M9 21V9" /></svg>
                    <span className="text-[15px] font-black tracking-wide">開啟心得模式 (隱藏步驟)</span>
                  </div>
                  <button onClick={() => setViewMode(viewMode === 'default' ? 'review' : 'default')} className={`w-14 h-8 rounded-full transition-colors duration-300 focus:outline-none flex items-center px-1 shadow-inner ${viewMode === 'review' ? 'bg-[#34C759]' : 'bg-slate-200'}`}>
                    <div className={`w-6 h-6 bg-white rounded-full shadow-md transform transition-transform duration-300 ${viewMode === 'review' ? 'translate-x-6' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
            </div>
            <div className="p-6 pt-0 shrink-0 mt-2">
              <button
                onClick={() => setIsViewMenuOpen(false)}
                className="w-full py-4 rounded-full font-black text-white bg-[#007AFF] shadow-[0_8px_20px_rgba(0,122,255,0.3)] border-t border-l border-white/40 border-b border-r border-black/10 hover:bg-blue-600 active:scale-[0.96] transition-all text-sm tracking-widest"
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