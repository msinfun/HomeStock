
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { InventoryItem } from '../types';
import { recognizeItemFromImage, recognizeExpiryDate, inferItemDetailsFromText } from '../geminiService';
import ConfirmationModal from './ConfirmationModal';

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
  const [isExpiryAiLoading, setIsExpiryAiLoading] = useState(false);
  const [isTextAiLoading, setIsTextAiLoading] = useState(false);
  
  const [hasManuallySetCategory, setHasManuallySetCategory] = useState(false);
  const [hasManuallySetLocation, setHasManuallySetLocation] = useState(false);
  
  const [batchQueue, setBatchQueue] = useState<any[]>([]);
  const [currentBatchIndex, setCurrentBatchIndex] = useState(0);

  // Modal State for Skipping Last Item or Alerts
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
    onConfirm: () => {},
    onCancel: () => {}
  });

  // Ensure initial category is valid
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
    packageSize: '', // New
    price: 0, // New
    minThreshold: 0, 
    lastUsedDate: '',
    batches: [],
    review: ''
  });

  const isEditing = !!(initialData && initialData.id);

  // Compute AI Context: Extract unique values from existing data
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

  useEffect(() => {
    if (initialData) {
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

  const predictSubCategory = (name: string) => {
    const historical = existingItems.find(item => item.name.toLowerCase() === name.toLowerCase());
    return historical ? historical.subCategory || '' : '';
  };

  const predictLocation = (name: string) => {
    const historical = existingItems.find(item => item.name.toLowerCase() === name.toLowerCase());
    return historical ? (locations.includes(historical.location) ? historical.location : '') : '';
  };

  const loadItemIntoForm = (item: any) => {
    const finalCategory = categories.includes(item.category) ? item.category : defaultCategory;
    const finalLocation = locations.includes(item.location) ? item.location : predictLocation(item.name || '');

    setForm({
      name: item.name || '',
      quantity: item.quantity || 1,
      category: finalCategory,
      subCategory: item.subCategory || predictSubCategory(item.name || '') || '',
      location: finalLocation,
      expiryDate: item.expiryDate || '',
      openedDate: '',
      remarks: item.remarks || '',
      packageSize: item.packageSize || '',
      price: item.price || 0,
      minThreshold: 0,
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
    const normalizedName = form.name.trim().toLowerCase();
    
    // PRIORITY: Check Local History First
    const historyMatch = existingItems.find(i => i.name.trim().toLowerCase() === normalizedName);
    
    if (historyMatch) {
      setForm(prev => ({
        ...prev,
        category: historyMatch.category,
        subCategory: historyMatch.subCategory || prev.subCategory,
        location: (!hasManuallySetLocation && locations.includes(historyMatch.location)) ? historyMatch.location : prev.location,
        minThreshold: historyMatch.minThreshold,
        packageSize: historyMatch.packageSize || prev.packageSize, // Auto-fill specs
        price: historyMatch.price || prev.price // Auto-fill price
      }));
      setHasManuallySetCategory(true);
      if (historyMatch.location) setHasManuallySetLocation(true);
      return; 
    }

    setIsTextAiLoading(true);
    try {
      const aiResult = await inferItemDetailsFromText(form.name, aiContext);
      if (aiResult) {
        const aiCategory = categories.includes(aiResult.category) ? aiResult.category : form.category;
        const aiLocation = locations.includes(aiResult.location) ? aiResult.location : (form.location || predictLocation(aiResult.name || form.name));

        setForm(prev => ({
          ...prev,
          name: aiResult.name || prev.name,
          quantity: aiResult.quantity || prev.quantity,
          category: (!hasManuallySetCategory) ? aiCategory : prev.category,
          subCategory: aiResult.subCategory || prev.subCategory,
          location: (!hasManuallySetLocation) ? aiLocation : prev.location,
          remarks: aiResult.remarks || prev.remarks,
          packageSize: aiResult.packageSize || prev.packageSize
        }));
        if (aiResult.category) setHasManuallySetCategory(true);
        if (aiResult.location) setHasManuallySetLocation(true);
      }
    } catch (error) {
      console.error("Text inference failed", error);
    } finally {
      setIsTextAiLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.category) return;
    const isBatchMode = batchQueue.length > 0;
    const hasNextItem = currentBatchIndex < batchQueue.length - 1;
    
    onAdd(form, isBatchMode && hasNextItem);
    
    if (isBatchMode && hasNextItem) {
      const nextIndex = currentBatchIndex + 1;
      setCurrentBatchIndex(nextIndex);
      loadItemIntoForm(batchQueue[nextIndex]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
       window.scrollTo({ top: 0, behavior: 'smooth' });
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
        onCancel: () => {}
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsAiLoading(true);
    const promises = Array.from(files).map((file: File) => {
       return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
       });
    });

    setTimeout(async () => {
      try {
        const base64Images = await Promise.all(promises);
        const results = await recognizeItemFromImage(base64Images, aiContext);
        
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
             onCancel: () => {}
           });
        }
      } catch (err) {
        console.error("Image AI failed", err);
      } finally {
        setIsAiLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = ''; 
      }
    }, 50);
  };

  const handleExpiryScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsExpiryAiLoading(true);
    
    setTimeout(() => {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const base64 = (reader.result as string).split(',')[1];
            const expiry = await recognizeExpiryDate(base64);
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
                onCancel: () => {}
              });
            }
          } catch (err) {
            console.error("Expiry AI failed", err);
          } finally {
            setIsExpiryAiLoading(false);
            if (expiryFileInputRef.current) expiryFileInputRef.current.value = '';
          }
        };
        reader.readAsDataURL(file);
    }, 50);
  };

  const setOpenedDateToToday = () => {
    const today = new Date().toISOString().split('T')[0];
    setForm(prev => ({ ...prev, openedDate: today }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-black tracking-tighter text-slate-800">
          {isEditing ? '編輯物品' : (batchQueue.length > 0 ? '批次新增確認' : '新增物品')}
        </h2>
        {batchQueue.length > 0 && (
          <span className="bg-white/80 border border-white shadow-sm text-[#007AFF] px-3 py-1 rounded-full text-xs font-black backdrop-blur-sm">
             進度：{currentBatchIndex + 1} / {batchQueue.length}
          </span>
        )}
      </div>

      {!isEditing && batchQueue.length === 0 && (
        <div className="bg-[#007AFF] rounded-[32px] p-6 text-white shadow-[0_12px_30px_rgba(0,122,255,0.2)] border-t border-white/30 relative overflow-hidden">
          <div className="relative z-10">
            <h3 className="text-lg font-black tracking-tighter mb-2">AI 智慧辨識 (多圖)</h3>
            <p className="text-blue-100 text-sm mb-4 font-medium">
              支援同時上傳最多 5 張照片。AI 會自動分析所有圖片中的物品清單。
            </p>
            {/* 改為全圓角膠囊按鈕 */}
            <button 
              type="button"
              disabled={isAiLoading}
              onClick={() => fileInputRef.current?.click()}
              className="w-full bg-white/90 backdrop-blur-sm text-[#007AFF] font-black py-3.5 rounded-full shadow-sm hover:bg-white active:scale-[0.96] transition-all flex items-center justify-center gap-2 border border-white"
            >
              {isAiLoading ? (
                <>
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  辨識中...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
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
         <div className="bg-white/70 backdrop-blur-md border border-white/80 shadow-[0_4px_15px_rgba(0,0,0,0.03)] rounded-[28px] p-4 text-sm text-[#007AFF] font-medium flex items-center gap-3 animate-in slide-in-from-top duration-300">
            <div className="bg-blue-50 p-2 rounded-full">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>
            </div>
            <div>
              <p className="font-black tracking-tight">批次確認模式</p>
              <p className="text-xs text-slate-500 mt-0.5 font-bold">您可以修改資料後新增，或點擊「跳過」。</p>
            </div>
         </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 bg-white/70 backdrop-blur-xl p-6 rounded-[32px] shadow-[0_12px_40px_rgba(0,0,0,0.06)] border border-white/80">
        <div className="space-y-1">
          <label className="text-xs font-black tracking-wider text-slate-400 uppercase px-1">物品名稱 *</label>
          <div className="relative">
            {/* 單行輸入框：改為 rounded-full */}
            <input 
              required
              type="text" 
              className="w-full px-5 py-4 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none transition-all pr-10 text-[17px] font-bold text-slate-800" 
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
          <div className="space-y-1">
            <label className="text-xs font-black tracking-wider text-slate-400 uppercase px-1">數量</label>
            {/* 單行輸入框：改為 rounded-full */}
            <input 
              type="number" 
              className="w-full px-5 py-4 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none transition-all text-[17px] font-bold text-slate-800 text-center" 
              value={form.quantity}
              onChange={e => setForm({...form, quantity: parseInt(e.target.value) || 0})}
            />
          </div>
           <div className="space-y-1">
            <label className="text-xs font-black tracking-wider text-slate-400 uppercase px-1">安全庫存</label>
            {/* 單行輸入框：改為 rounded-full */}
            <input 
              type="number" 
              className="w-full px-5 py-4 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none transition-all text-[17px] font-bold text-slate-800 placeholder:font-normal text-center" 
              value={form.minThreshold}
              onChange={e => setForm({...form, minThreshold: parseInt(e.target.value) || 0})}
              placeholder="警戒值"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-black tracking-wider text-slate-400 uppercase px-1">規格/容量</label>
            {/* 單行輸入框：改為 rounded-full */}
            <input 
              type="text" 
              className="w-full px-5 py-4 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none transition-all text-[17px] font-bold text-slate-800 placeholder:font-normal" 
              value={form.packageSize}
              onChange={e => setForm({...form, packageSize: e.target.value})}
              placeholder="如：500ml"
            />
          </div>
           <div className="space-y-1">
            <label className="text-xs font-black tracking-wider text-slate-400 uppercase px-1">單價</label>
            <div className="relative">
              <span className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
              {/* 單行輸入框：改為 rounded-full */}
              <input 
                type="number" 
                className="w-full pl-9 pr-5 py-4 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none transition-all text-[17px] font-bold text-slate-800 placeholder:font-normal" 
                value={form.price || ''}
                onChange={e => setForm({...form, price: parseFloat(e.target.value) || 0})}
                placeholder="0"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-black tracking-wider text-slate-400 uppercase px-1">大分類 *</label>
            {/* 單行選單：改為 rounded-full */}
            <select 
              required
              className="w-full px-5 py-4 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none font-bold text-slate-800 transition-all appearance-none truncate text-[17px]"
              style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: `right 1.2rem center`, backgroundRepeat: `no-repeat`, backgroundSize: `1.2em 1.2em`, paddingRight: `3rem` }}
              value={form.category}
              onChange={e => {
                setForm({...form, category: e.target.value});
                setHasManuallySetCategory(true);
              }}
            >
              {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-black tracking-wider text-[#007AFF] uppercase px-1">小分類 (統計)</label>
            {/* 單行輸入框：改為 rounded-full */}
            <input 
              type="text"
              className="w-full px-5 py-4 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none font-bold text-[#007AFF] transition-all text-[17px] placeholder:text-blue-300 placeholder:font-normal"
              value={form.subCategory}
              onChange={e => setForm({...form, subCategory: e.target.value})}
              placeholder="如：鮮乳"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-black tracking-wider text-slate-400 uppercase px-1">存放位置</label>
          {/* 單行選單：改為 rounded-full */}
          <select 
            className="w-full px-5 py-4 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none font-bold text-slate-800 transition-all appearance-none text-[17px]" 
            style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: `right 1.2rem center`, backgroundRepeat: `no-repeat`, backgroundSize: `1.2em 1.2em`, paddingRight: `3rem` }}
            value={form.location}
            onChange={e => {
                setForm({...form, location: e.target.value});
                setHasManuallySetLocation(true);
            }}
          >
            <option value="">請選擇存放位置</option>
            {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-1 mb-1 px-1 flex-wrap">
              <label className="text-xs font-black tracking-wider text-slate-400 uppercase">有效期限</label>
              <button 
                type="button"
                disabled={isExpiryAiLoading}
                onClick={() => expiryFileInputRef.current?.click()}
                className={`text-[10px] flex items-center gap-1 px-2 py-0.5 rounded-full font-black transition-all ${isExpiryAiLoading ? 'bg-slate-100 text-slate-400' : 'bg-blue-50/80 text-[#007AFF] hover:bg-blue-100 border border-blue-100'}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
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
            {/* 單行日期：改為 rounded-full */}
            <input 
              type="date" 
              className="w-full px-5 py-4 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none font-bold text-slate-800 transition-all text-[17px]" 
              value={form.expiryDate}
              onChange={e => setForm({...form, expiryDate: e.target.value})}
            />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between items-center mb-1 px-1">
              <label className="text-xs font-black tracking-wider text-slate-400 uppercase">開封日期</label>
              <button 
                type="button"
                onClick={setOpenedDateToToday}
                className="text-[10px] bg-white border border-white shadow-sm hover:bg-slate-50 text-slate-500 px-2 py-0.5 rounded-full font-black transition-colors"
              >
                今天
              </button>
            </div>
            {/* 單行日期：改為 rounded-full */}
            <input 
              type="date" 
              className="w-full px-5 py-4 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none font-bold text-slate-800 transition-all text-[17px]" 
              value={form.openedDate}
              onChange={e => setForm({...form, openedDate: e.target.value})}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-black tracking-wider text-slate-400 uppercase px-1">其他備註</label>
          {/* 多行文字：維持 rounded-2xl 方圓角 */}
          <textarea 
            className="w-full px-5 py-4 rounded-2xl bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none font-bold text-slate-800 resize-none transition-all text-[17px] placeholder:font-normal" 
            rows={2}
            value={form.remarks}
            onChange={e => setForm({...form, remarks: e.target.value})}
            placeholder="其他注意事項..."
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-black tracking-wider text-[#007AFF] uppercase px-1">評價 / 心得</label>
          {/* 多行文字：維持 rounded-2xl 方圓角 */}
          <textarea 
            className="w-full px-5 py-4 rounded-2xl bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none font-bold text-slate-800 resize-none transition-all text-[17px] placeholder:font-normal" 
            rows={3}
            value={form.review}
            onChange={e => setForm({...form, review: e.target.value})}
            placeholder="記錄使用心得、購買評價，供日後參考..."
          />
        </div>

        <div className={`grid ${batchQueue.length > 0 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'} gap-3 mt-8 pt-4 border-t border-slate-100`}>
           {batchQueue.length > 0 && (
             /* 底部按鈕：改為 rounded-full 膠囊 */
             <button 
               type="button"
               onClick={handleSkip}
               className="w-full bg-white text-slate-500 font-black py-4 rounded-full border border-white shadow-sm active:scale-[0.96] transition-all text-sm hover:bg-slate-50"
             >
               跳過
             </button>
           )}

           {/* 底部按鈕：改為 rounded-full 膠囊 */}
           <button 
             type="button"
             onClick={onCancel}
             className="w-full bg-white text-slate-500 font-black py-4 rounded-full border border-white shadow-sm active:scale-[0.96] transition-all text-sm hover:bg-slate-50"
           >
             取消
           </button>

           {/* 底部主要按鈕：改為 rounded-full 膠囊，並維持立體亮邊 */}
           <button 
             type="submit"
             className={`w-full bg-[#007AFF] text-white font-black py-4 rounded-full shadow-[0_10px_25px_rgba(0,122,255,0.3)] border-t border-l border-white/40 border-b border-r border-black/10 active:scale-[0.96] transition-all text-sm flex items-center justify-center gap-2 ${batchQueue.length > 0 ? 'col-span-2 sm:col-span-1' : ''}`}
           >
             {isEditing 
                ? '儲存修改' 
                : (batchQueue.length > 0 && currentBatchIndex < batchQueue.length - 1)
                    ? (
                        <>
                          確認，下一個
                          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
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
  );
};

export default AddItemView;
