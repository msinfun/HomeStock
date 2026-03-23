import React, { useState, useRef, useEffect, useMemo } from 'react';
import { InventoryItem } from '../types';
import { recognizeItemFromImage, recognizeExpiryDate, inferItemDetailsFromText } from '../geminiService';
import ConfirmationModal from './ConfirmationModal';
import { compressImage } from '../utils/imageProcessor';

interface AddItemViewProps {
  onAdd: (item: Omit<InventoryItem, 'id'>, stayOnView?: boolean) => void;
  onCancel: () => void;
  initialData?: InventoryItem;
  categories: string[];
  locations: string[];
  existingItems?: InventoryItem[];
}

const AddItemView: React.FC<AddItemViewProps> = ({ onAdd, onCancel, initialData, categories, locations, existingItems = [] }) => {
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('準備辨識...');
  const [isExpiryAiLoading, setIsExpiryAiLoading] = useState(false);
  const [isTextAiLoading, setIsTextAiLoading] = useState(false);

  const [hasManuallySetCategory, setHasManuallySetCategory] = useState(false);
  const [hasManuallySetLocation, setHasManuallySetLocation] = useState(false);

  const [batchQueue, setBatchQueue] = useState<any[]>([]);
  const [currentBatchIndex, setCurrentBatchIndex] = useState(0);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const expiryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const loadingTimeoutsRef = useRef<NodeJS.Timeout[]>([]);
  const hasInitialized = useRef(false);
  const isMounted = useRef(true); // 🍎 QA-06 防禦：追蹤元件是否卸載

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
      if (expiryTimeoutRef.current) clearTimeout(expiryTimeoutRef.current);
      loadingTimeoutsRef.current.forEach(t => clearTimeout(t));
      loadingTimeoutsRef.current = [];
    };
  }, []);

  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isAlert?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => { },
    onCancel: () => { }
  });

  const defaultCategory = categories.length > 0 ? categories[0] : '食品';

  const [form, setForm] = useState<Omit<InventoryItem, 'id'>>({
    name: '',
    quantity: 1,
    category: defaultCategory,
    subCategory: '',
    location: '',
    expiryDate: '',
    openedDate: '',
    remarks: '',
    packageSize: '',
    price: 0,
    minThreshold: 0,
    lastUsedDate: '',
    batches: [],
    review: ''
  });

  const isEditing = !!(initialData && initialData.id);

  const aiContext = useMemo(() => {
    const distinctCategories = Array.from(new Set([...categories, ...existingItems.map(i => i.category)]));
    const distinctSubCategories = Array.from(new Set(existingItems.map(i => i.subCategory).filter(Boolean) as string[]));
    const distinctLocations = Array.from(new Set([...locations, ...existingItems.map(i => i.location)]));

    return {
      categories: distinctCategories,
      subCategories: distinctSubCategories,
      locations: distinctLocations
    };
  }, [categories, locations, existingItems]);

  const getFilteredHistory = (currentInput: string): string[] => {
    // 邏輯 B (近期清單)：挑選最新（id 最大，假設 timestamp 格式可排序）的 20 筆
    const recentItems = [...existingItems]
      .sort((a, b) => b.id.localeCompare(a.id))
      .slice(0, 20);

    let matchedItems: typeof existingItems = [];

    // 邏輯 A (關鍵字匹配)：若輸入長度 > 1，拆解為 2 字元片段進行模糊匹配
    const input = currentInput.trim();
    if (input.length > 1) {
      const fragments: string[] = [];
      for (let i = 0; i < input.length - 1; i++) {
        fragments.push(input.substring(i, i + 2));
      }

      matchedItems = existingItems.filter(item =>
        fragments.some(fragment => item.name.includes(fragment))
      );
    }

    // 合併 A + B 的聯集，去重並限制總量 40 筆
    const combinedNames = Array.from(new Set([
      ...recentItems.map(i => i.name),
      ...matchedItems.map(i => i.name)
    ]));

    return combinedNames.slice(0, 40);
  };

  useEffect(() => {
    const handleViewChange = () => {
      scrollContainerRef.current?.scrollTo({ top: 0 });
    };
    window.addEventListener('view-changed', handleViewChange);
    return () => window.removeEventListener('view-changed', handleViewChange);
  }, []);

  useEffect(() => {
    if (initialData && !hasInitialized.current) {
      hasInitialized.current = true;
      const { id, ...data } = initialData;
      const validCategory = categories.includes(data.category) ? data.category : defaultCategory;
      const validLocation = data.location && locations.includes(data.location) ? data.location : '';

      setForm({
        ...data,
        category: validCategory,
        location: validLocation,
        subCategory: data.subCategory || '',
        packageSize: data.packageSize || '',
        price: data.price || 0,
        minThreshold: data.minThreshold ?? 0,
        lastUsedDate: data.lastUsedDate ?? '',
        remarks: data.remarks || '', // 🍎 修復：明確把舊的備註載入表單
        review: data.review ?? ''
      });
      setHasManuallySetCategory(true);
      if (validLocation) setHasManuallySetLocation(true);

      if (!validLocation && !data.location) {
        const predictedLoc = predictLocation(data.name);
        if (predictedLoc) setForm(prev => ({ ...prev, location: predictedLoc }));
      }
    }
  }, [initialData, categories, locations]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const expiryFileInputRef = useRef<HTMLInputElement>(null);

  const applyHistoryToItem = (item: any) => {
    const targetName = (item.matchedHistoryName || item.name || '').trim();
    if (!targetName) return item;

    const historyMatch = existingItems.find(i => i.name === targetName);
    if (historyMatch) {
      return {
        ...item,
        name: historyMatch.name, // 強制使用歷史名稱的精確大小寫
        category: historyMatch.category || item.category,
        subCategory: historyMatch.subCategory || item.subCategory,
        location: historyMatch.location || item.location,
        minThreshold: historyMatch.minThreshold !== undefined ? historyMatch.minThreshold : item.minThreshold,
        packageSize: historyMatch.packageSize || item.packageSize,
        price: historyMatch.price || item.price,
        _historyMatch: true
      };
    }
    return item;
  };

  const predictSubCategory = (name: string) => {
    const historical = existingItems.find(item => item.name.toLowerCase() === name.toLowerCase());
    return historical ? historical.subCategory || '' : '';
  };

  const predictLocation = (name: string) => {
    const historical = existingItems.find(item => item.name.toLowerCase() === name.toLowerCase());
    return historical ? (locations.includes(historical.location) ? historical.location : '') : '';
  };

  const loadItemIntoForm = (rawItem: any) => {
    // 歷史紀錄優先：用歷史資料覆蓋 AI 辨識結果
    const item = applyHistoryToItem(rawItem);
    
    const finalCategory = categories.includes(item.category) ? item.category : defaultCategory;
    const finalLocation = item._historyMatch && locations.includes(item.location) ? item.location : (locations.includes(item.location) ? item.location : predictLocation(item.name || ''));

    setForm({
      name: item.name || '',
      quantity: item.quantity || 1,
      category: finalCategory,
      subCategory: item.subCategory || (!item._historyMatch ? predictSubCategory(item.name || '') : '') || '',
      location: finalLocation,
      expiryDate: item.expiryDate || '',
      openedDate: '',
      remarks: item.remarks || '',
      packageSize: item.packageSize || '',
      price: item.price || 0,
      minThreshold: item.minThreshold || 0,
      lastUsedDate: '',
      batches: [],
      review: ''
    });
    setHasManuallySetCategory(!!item.category);
    setHasManuallySetLocation(!!item.location);
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, name: e.target.value }));
  };

  const handleNameBlur = async () => {
    if (!form.name || isEditing || batchQueue.length > 0) return;
    const targetName = form.name.trim();
    const historyMatch = existingItems.find(i => i.name === targetName);

    if (historyMatch) {
      setForm(prev => ({
        ...prev,
        category: historyMatch.category,
        subCategory: historyMatch.subCategory || prev.subCategory,
        location: (!hasManuallySetLocation && locations.includes(historyMatch.location)) ? historyMatch.location : prev.location,
        minThreshold: historyMatch.minThreshold,
        packageSize: historyMatch.packageSize || prev.packageSize,
        price: historyMatch.price || prev.price
      }));
      setHasManuallySetCategory(true);
      if (historyMatch.location) setHasManuallySetLocation(true);
      return;
    }

    setIsTextAiLoading(true);
    try {
      const historyNames = getFilteredHistory(form.name);
      const rawAiResult = await inferItemDetailsFromText(form.name, { ...aiContext, historyNames });
      if (!isMounted.current) return; // 🍎 QA-06 解除掛載保護

      if (rawAiResult) {
        // AI 回傳後再次套用歷史優先邏輯（因為 AI 可能改了名稱）
        const aiResult = applyHistoryToItem({ ...rawAiResult, name: rawAiResult.name || form.name });
        
        const aiCategory = categories.includes(aiResult.category) ? aiResult.category : form.category;
        const aiLocation = locations.includes(aiResult.location) ? aiResult.location : (form.location || predictLocation(aiResult.name || form.name));

        setForm(prev => ({
          ...prev,
          name: aiResult.name || prev.name,
          quantity: aiResult.quantity || prev.quantity,
          category: (!hasManuallySetCategory || aiResult._historyMatch) ? aiCategory : prev.category,
          subCategory: aiResult.subCategory || prev.subCategory,
          location: (!hasManuallySetLocation || aiResult._historyMatch) ? aiLocation : prev.location,
          remarks: aiResult.remarks || prev.remarks,
          packageSize: aiResult.packageSize || prev.packageSize,
          price: aiResult.price || prev.price,
          minThreshold: aiResult.minThreshold !== undefined ? aiResult.minThreshold : prev.minThreshold
        }));
        if (aiResult.category) setHasManuallySetCategory(true);
        if (aiResult.location) setHasManuallySetLocation(true);
      }
    } catch (error) {
      if (!isMounted.current) return;
      console.error("Text inference failed", error);
    } finally {
      if (isMounted.current) setIsTextAiLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.category) return;
    if (form.quantity < 0 || form.minThreshold < 0) return; // 🍎 QA-01 防護：拒絕存入負數

    const isBatchMode = batchQueue.length > 0;
    const hasNextItem = currentBatchIndex < batchQueue.length - 1;

    onAdd(form, isBatchMode && hasNextItem);

    if (isBatchMode && hasNextItem) {
      const nextIndex = currentBatchIndex + 1;
      setCurrentBatchIndex(nextIndex);
      loadItemIntoForm(batchQueue[nextIndex]);
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setBatchQueue([]);
      setCurrentBatchIndex(0);
    }
  };

  const handleSkip = () => {
    const hasNextItem = currentBatchIndex < batchQueue.length - 1;
    if (hasNextItem) {
      const nextIndex = currentBatchIndex + 1;
      setCurrentBatchIndex(nextIndex);
      loadItemIntoForm(batchQueue[nextIndex]);
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setModalConfig({
        isOpen: true,
        title: '結束批次新增',
        message: '這已是批次清單中的最後一項。確定要跳過並結束新增流程嗎？',
        confirmText: '確認結束',
        cancelText: '繼續編輯',
        onConfirm: () => {
          setBatchQueue([]);
          setCurrentBatchIndex(0);
          setModalConfig(prev => ({ ...prev, isOpen: false }));
          onCancel();
        },
        onCancel: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
      });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (files.length > 5) {
      setModalConfig({
        isOpen: true,
        title: '圖片過多',
        message: '最多只能一次上傳 5 張照片！',
        isAlert: true,
        confirmText: '好',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
        onCancel: () => { }
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsAiLoading(true);
    setLoadingText('📦 正在壓縮圖片...');

    // 動態加載提示輪播
    const messages = [
      { delay: 600, text: '🚀 傳送至 AI 伺服器...' },
      { delay: 1500, text: '🧠 AI 正在分析物品與效期...' },
      { delay: 2500, text: '🔍 正在與歷史紀錄進行語意比對...' },
      { delay: 3500, text: '✨ 正在整理最終資料...' }
    ];

    loadingTimeoutsRef.current.forEach(t => clearTimeout(t));
    loadingTimeoutsRef.current = messages.map(m => 
      setTimeout(() => setLoadingText(m.text), m.delay)
    );

    const promises = Array.from(files).map((file: File) => compressImage(file));

    scanTimeoutRef.current = setTimeout(async () => {
      try {
        const base64Images = await Promise.all(promises);
        const historyNames = getFilteredHistory(""); // 圖片辨識時無名稱，僅傳送最新 20 筆參考
        const results = await recognizeItemFromImage(base64Images, { ...aiContext, historyNames });
        if (!isMounted.current) return; // 🍎 QA-06

        if (results && results.length > 0) {
          if (results.length === 1) {
            loadItemIntoForm(results[0]);
            setBatchQueue([]);
            setCurrentBatchIndex(0);
          } else {
            setBatchQueue(results);
            setCurrentBatchIndex(0);
            loadItemIntoForm(results[0]);
          }
        } else {
          setModalConfig({
            isOpen: true,
            title: '辨識失敗',
            message: 'AI 未能辨識出任何物品，請確認照片清晰。',
            isAlert: true,
            confirmText: '好',
            onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
            onCancel: () => { }
          });
        }
      } catch (err: any) {
        if (!isMounted.current) return;
        console.error("Image AI failed", err);
        setModalConfig({
          isOpen: true,
          title: '辨識失敗',
          message: err instanceof Error ? err.message : 'AI 圖片分析失敗，請稍後再試。',
          isAlert: true,
          confirmText: '好',
          onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
          onCancel: () => { }
        });
      } finally {
        if (isMounted.current) {
          setIsAiLoading(false);
          setLoadingText('準備辨識...'); // 重置文字
          loadingTimeoutsRef.current.forEach(t => clearTimeout(t));
          loadingTimeoutsRef.current = [];
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      }
    }, 50);
  };

  const handleExpiryScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsExpiryAiLoading(true);
    
    expiryTimeoutRef.current = setTimeout(async () => {
      try {
        const base64 = await compressImage(file);
        const expiry = await recognizeExpiryDate(base64);
        if (!isMounted.current) return; // 🍎 QA-06

        if (expiry !== null) {
          setForm(prev => ({ ...prev, expiryDate: expiry }));
        } else {
          setModalConfig({
            isOpen: true,
            title: '辨識失敗',
            message: '無法辨識效期，請手動輸入。',
            isAlert: true,
            confirmText: '好',
            onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
            onCancel: () => { }
          });
        }
      } catch (err: any) {
        if (!isMounted.current) return;
        console.error("Expiry AI failed", err);
        setModalConfig({
          isOpen: true,
          title: '辨識失敗',
          message: err instanceof Error ? err.message : 'AI 效期分析失敗，請稍後再試。',
          isAlert: true,
          confirmText: '好',
          onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
          onCancel: () => { }
        });
      } finally {
        if (isMounted.current) {
          setIsExpiryAiLoading(false);
          if (expiryFileInputRef.current) expiryFileInputRef.current.value = '';
        }
      }
    }, 50);
  };

  const setOpenedDateToToday = () => {
    const today = new Date().toISOString().split('T')[0];
    setForm(prev => ({ ...prev, openedDate: today }));
  };

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <div ref={scrollContainerRef} className="fixed inset-0 z-[100] bg-[#F2F2F7] overflow-y-auto overscroll-contain h-[100dvh] custom-scrollbar animate-in slide-in-from-bottom duration-300">

      {/* Blurred Blob Background from Dashboard */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-5%] right-[-10%] w-[350px] h-[350px] rounded-full bg-blue-500/15 blur-[80px]"></div>
        <div className="absolute top-[25%] left-[-15%] w-[300px] h-[300px] rounded-full bg-emerald-400/15 blur-[100px]"></div>
        <div className="absolute bottom-[10%] right-[-5%] w-[400px] h-[400px] rounded-full bg-purple-400/15 blur-[120px]"></div>
      </div>

      <div className="relative z-10 w-full max-w-2xl mx-auto px-4 py-8 space-y-6 pb-32">
        <div className="flex items-center justify-between">
          <h2 className="text-[20px] font-black tracking-tighter text-slate-800 drop-shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
            {isEditing ? '編輯物品' : (batchQueue.length > 0 ? '批次新增確認' : '新增物品')}
          </h2>
          {batchQueue.length > 0 && (
            <span className="bg-slate-100 text-[#007AFF] px-3.5 py-1 rounded-full text-[11px] font-black tracking-widest">
              進度：{currentBatchIndex + 1} / {batchQueue.length}
            </span>
          )}
        </div>

        {!isEditing && batchQueue.length === 0 && (
          <div className="bg-[#007AFF] rounded-[32px] p-6 text-white shadow-[0_4px_16px_rgba(0,122,255,0.15)] relative overflow-hidden">
            <div className="relative z-10">
              <h3 className="text-lg font-black tracking-tighter mb-2">AI 智慧辨識 (多圖)</h3>
              <p className="text-blue-100 text-[13px] mb-4 font-bold">
                支援同時上傳最多 5 張照片。AI 會自動分析所有圖片中的物品清單。
              </p>
              <button
                type="button"
                disabled={isAiLoading}
                onClick={() => fileInputRef.current?.click()}
                className="w-full bg-white text-[#007AFF] font-black py-3.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.1)] hover:bg-slate-50 active:scale-[0.96] transition-all flex items-center justify-center gap-2"
              >
                {isAiLoading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span className="animate-pulse">{loadingText}</span>
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg>
                    選擇照片 (最多5張)
                  </>
                )}
              </button>
              <input
                type="file"
                multiple
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                className="hidden"
              />
            </div>
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-xl" />
          </div>
        )}

        {batchQueue.length > 0 && (
          <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-[32px] p-5 text-[#007AFF] flex items-center gap-4 animate-in slide-in-from-top duration-300">
            <div className="bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-2.5 rounded-3xl">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></svg>
            </div>
            <div>
              <p className="font-black tracking-tight text-[15px]">批次確認模式</p>
              <p className="text-xs text-slate-500 mt-1 font-bold">您可以修改資料後新增，或點擊「跳過」。</p>
            </div>
          </div>
        )}

        {/* 🍎 頂級玻璃大表單 */}
        <form onSubmit={handleSubmit} className="space-y-5 bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 p-6 rounded-[32px] shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-white/60">
          <div className="space-y-1.5">
            <label className="text-[11px] font-black tracking-widest text-slate-400 uppercase px-1">物品名稱 *</label>
            <div className="relative">
              <input
                required
                type="text"
                maxLength={64}
                className="w-full px-5 py-4 rounded-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] transition-all pr-10 text-[17px] font-bold text-slate-800 placeholder:text-slate-300 placeholder:font-normal focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
                value={form.name}
                onChange={handleNameChange}
                onBlur={handleNameBlur}
                placeholder="例如：全脂牛奶"
              />
              {isTextAiLoading && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[#007AFF] flex items-center gap-1">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-black tracking-widest text-slate-400 uppercase px-1">數量</label>
              <input
                type="number"
                min="0"
                max="99999"
                className="w-full px-5 py-4 rounded-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] transition-all text-[17px] font-bold text-slate-800 text-center focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
                value={form.quantity === '' as any ? '' : form.quantity}
                onChange={e => {
                  const val = e.target.value;
                  setForm({ ...form, quantity: val === '' ? ('' as any) : parseInt(val) });
                }}
                onWheel={e => e.currentTarget.blur()} // 🍎 防止滾輪誤觸改變數字
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-black tracking-widest text-slate-400 uppercase px-1">安全庫存</label>
              <input
                type="number"
                min="0"
                max="99999"
                className="w-full px-5 py-4 rounded-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] transition-all text-[17px] font-bold text-slate-800 placeholder:font-normal placeholder:text-slate-300 text-center focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
                value={form.minThreshold === '' as any ? '' : form.minThreshold}
                onChange={e => {
                  const val = e.target.value;
                  setForm({ ...form, minThreshold: val === '' ? ('' as any) : parseInt(val) });
                }}
                placeholder="警戒值"
                onWheel={e => e.currentTarget.blur()} // 🍎 防止滾輪誤觸改變數字
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-black tracking-widest text-slate-400 uppercase px-1">規格/容量</label>
              <input
                type="text"
                className="w-full px-5 py-4 rounded-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] transition-all text-[17px] font-bold text-slate-800 placeholder:font-normal placeholder:text-slate-300 focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
                value={form.packageSize}
                onChange={e => setForm({ ...form, packageSize: e.target.value })}
                placeholder="如：500ml"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-black tracking-widest text-slate-400 uppercase px-1">單價</label>
              <div className="relative">
                <span className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                <input
                  type="number"
                  className="w-full pl-9 pr-5 py-4 rounded-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] transition-all text-[17px] font-bold text-slate-800 placeholder:font-normal placeholder:text-slate-300 focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
                  value={form.price === '' as any ? '' : (form.price ?? '')}
                  onChange={e => {
                    const val = e.target.value;
                    setForm({ ...form, price: val === '' ? ('' as any) : parseFloat(val) });
                  }}
                  placeholder="0"
                  onWheel={e => e.currentTarget.blur()} // 🍎 防止滾輪誤觸改變數字
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-black tracking-widest text-slate-400 uppercase px-1">大分類 *</label>
              <select
                required
                className="w-full px-5 py-4 rounded-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] font-bold text-slate-800 transition-all appearance-none truncate text-[17px] focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
                style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: `right 1.2rem center`, backgroundRepeat: `no-repeat`, backgroundSize: `1.2em 1.2em`, paddingRight: `3rem` }}
                value={form.category}
                onChange={e => {
                  setForm({ ...form, category: e.target.value });
                  setHasManuallySetCategory(true);
                }}
              >
                {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-black tracking-widest text-[#007AFF] uppercase px-1">小分類 (統計)</label>
              <input
                type="text"
                className="w-full px-5 py-4 rounded-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] font-bold text-[#007AFF] transition-all text-[17px] placeholder:text-blue-300 placeholder:font-normal focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
                value={form.subCategory}
                onChange={e => setForm({ ...form, subCategory: e.target.value })}
                placeholder="如：鮮乳"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-black tracking-widest text-slate-400 uppercase px-1">存放位置</label>
            <select
              className="w-full px-5 py-4 rounded-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] font-bold text-slate-800 transition-all appearance-none text-[17px] focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
              style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: `right 1.2rem center`, backgroundRepeat: `no-repeat`, backgroundSize: `1.2em 1.2em`, paddingRight: `3rem` }}
              value={form.location}
              onChange={e => {
                setForm({ ...form, location: e.target.value });
                setHasManuallySetLocation(true);
              }}
            >
              <option value="">請選擇存放位置</option>
              {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
            </select>
          </div>

          {/* 日期區塊：強制同一行，並打破 iOS 原生寬度限制與塌陷問題 */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2 mb-1 px-1 flex-wrap">
                <label className="text-[11px] font-black tracking-widest text-slate-400 uppercase">有效期限</label>
                <button
                  type="button"
                  disabled={isExpiryAiLoading}
                  onClick={() => expiryFileInputRef.current?.click()}
                  className={`text-[10px] flex items-center gap-1 px-2.5 py-1 rounded-full font-black transition-all ${isExpiryAiLoading ? 'bg-slate-100 text-slate-400' : 'bg-blue-50 text-[#007AFF] hover:bg-blue-100'}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg>
                  {isExpiryAiLoading ? '...' : '掃描'}
                </button>
                <input
                  type="file"
                  ref={expiryFileInputRef}
                  onChange={handleExpiryScan}
                  accept="image/*"
                  className="hidden"
                />
              </div>
              <input
                type="date"
                className="w-full min-w-0 appearance-none px-2 py-4 min-h-[56px] rounded-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] font-bold text-slate-800 transition-all text-[14px] text-center focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
                value={form.expiryDate}
                onChange={e => setForm({ ...form, expiryDate: e.target.value })}
              />
              {/* 🍎 QA-05 防護：過期溫和提示 */}
              {form.expiryDate && form.expiryDate < new Date().toISOString().split('T')[0] && (
                <div className="absolute mt-1 text-[11px] font-black text-[#FF3B30] flex items-center gap-1 animate-in fade-in slide-in-from-top-1 px-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
                  此日期已過期
                </div>
              )}
            </div>
            <div className="space-y-1.5 min-w-0">
              <div className="flex justify-between items-center mb-1 px-1">
                <label className="text-[11px] font-black tracking-widest text-slate-400 uppercase">開封日期</label>
                <button
                  type="button"
                  onClick={setOpenedDateToToday}
                  className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-500 px-2.5 py-1 rounded-full font-black transition-all active:scale-95"
                >
                  今天
                </button>
              </div>
              <input
                type="date"
                className="w-full min-w-0 appearance-none px-2 py-4 min-h-[56px] rounded-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] font-bold text-slate-800 transition-all text-[14px] text-center focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
                value={form.openedDate}
                onChange={e => setForm({ ...form, openedDate: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-black tracking-widest text-slate-400 uppercase px-1">其他備註</label>
            <textarea
              className="w-full px-5 py-4 rounded-3xl bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] font-bold text-slate-800 resize-none transition-all text-[17px] placeholder:font-normal placeholder:text-slate-300 focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
              rows={2}
              value={form.remarks}
              onChange={e => setForm({ ...form, remarks: e.target.value })}
              placeholder="其他注意事項..."
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-black tracking-widest text-[#007AFF] uppercase px-1">評價 / 心得</label>
            <textarea
              className="w-full px-5 py-4 rounded-3xl bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] font-bold text-slate-800 resize-none transition-all text-[17px] placeholder:font-normal placeholder:text-slate-300 focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
              rows={3}
              value={form.review}
              onChange={e => setForm({ ...form, review: e.target.value })}
              placeholder="記錄使用心得、購買評價，供日後參考..."
            />
          </div>

          <div className={`grid ${batchQueue.length > 0 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'} gap-3 mt-8 pt-4 border-t border-white/60`}>
            {batchQueue.length > 0 && (
              <button
                type="button"
                onClick={handleSkip}
                className="w-full bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 text-slate-500 font-black py-4 rounded-full border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] active:scale-[0.96] transition-all text-[15px] hover:bg-white tracking-widest"
              >
                跳過
              </button>
            )}

            <button
              type="button"
              onClick={onCancel}
              className="w-full bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 text-slate-500 font-black py-4 rounded-full border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] active:scale-[0.96] transition-all text-[15px] hover:bg-white tracking-widest"
            >
              取消
            </button>

            <button
              type="submit"
              className={`w-full bg-[#007AFF] text-white font-black py-4 rounded-full shadow-[0_4px_12px_rgba(0,122,255,0.2)] hover:bg-blue-600 active:scale-[0.96] transition-all text-[15px] tracking-widest flex items-center justify-center gap-2 border-none ${batchQueue.length > 0 ? 'col-span-2 sm:col-span-1' : ''}`}
            >
              {isEditing
                ? '儲存修改'
                : (batchQueue.length > 0 && currentBatchIndex < batchQueue.length - 1)
                  ? (
                    <>
                      確認，下一個
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
                    </>
                  )
                  : '確認新增'
              }
            </button>
          </div>
        </form>

        <ConfirmationModal
          isOpen={modalConfig.isOpen}
          title={modalConfig.title}
          message={modalConfig.message}
          confirmText={modalConfig.confirmText}
          cancelText={modalConfig.cancelText}
          isAlert={modalConfig.isAlert}
          onConfirm={modalConfig.onConfirm}
          onCancel={modalConfig.onCancel}
        />
      </div>
    </div>
  );
};

export default AddItemView;