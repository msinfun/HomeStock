import React, { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { AppSettings, InventoryItem, InventoryDef, InventoryTransaction, Recipe, ShoppingItem, SystemBackup, RecipeTagStructure } from '../types';
import ConfirmationModal from './ConfirmationModal';

interface SettingsViewProps {
  settings: AppSettings;
  onUpdateSettings: (s: AppSettings) => void;
  categories: string[];
  onUpdateCategories: (cats: string[]) => void;
  locations: string[];
  onUpdateLocations: (locs: string[]) => void;
  recipeTags: RecipeTagStructure;
  onUpdateRecipeTags: (tags: RecipeTagStructure) => void;
  onBack: () => void;
  items: InventoryItem[];
  defs: InventoryDef[];
  transactions: InventoryTransaction[];
  recipes: Recipe[];
  shoppingList: ShoppingItem[];
  onExcelImport: (newDefs: InventoryDef[], newTrans: InventoryTransaction[], newRecipes?: Recipe[]) => void;
  onSystemRestore: (backup: SystemBackup, mode: 'merge' | 'overwrite') => void;
  onClearAllData: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ 
  settings, onUpdateSettings, 
  categories, onUpdateCategories,
  locations, onUpdateLocations,
  recipeTags, onUpdateRecipeTags,
  onBack,
  items,
  defs,
  transactions,
  recipes,
  shoppingList,
  onExcelImport,
  onSystemRestore,
  onClearAllData
}) => {
  const [newCat, setNewCat] = useState('');
  const [newLoc, setNewLoc] = useState('');
  
  const [newParentTag, setNewParentTag] = useState('');
  const [newChildTag, setNewChildTag] = useState<{ parent: string, value: string }>({ parent: '', value: '' });
  
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  
  const excelInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const [pendingBackup, setPendingBackup] = useState<SystemBackup | null>(null);
  
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isAlert?: boolean;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) setApiKey(savedKey);
  }, []);

  const saveApiKey = () => {
    localStorage.setItem('gemini_api_key', apiKey.trim());
    setConfirmConfig({
      isOpen: true,
      title: '設定成功',
      message: 'API Key 已儲存！您可以開始使用 AI 功能了。',
      isAlert: true,
      confirmText: '太棒了',
      onConfirm: () => setConfirmConfig(prev => ({ ...prev, isOpen: false }))
    });
  };

  const addCategory = () => {
    if (newCat && !categories.includes(newCat)) {
      onUpdateCategories([...categories, newCat]);
      setNewCat('');
    }
  };

  const removeCategory = (cat: string) => {
    onUpdateCategories(categories.filter(c => c !== cat));
  };

  const addLocation = () => {
    if (newLoc && !locations.includes(newLoc)) {
      onUpdateLocations([...locations, newLoc]);
      setNewLoc('');
    }
  };

  const removeLocation = (loc: string) => {
    onUpdateLocations(locations.filter(l => l !== loc));
  };

  const addParentTag = () => {
    if (newParentTag && !recipeTags[newParentTag]) {
      onUpdateRecipeTags({ ...recipeTags, [newParentTag]: [] });
      setNewParentTag('');
    }
  };

  const removeParentTag = (parent: string) => {
    setConfirmConfig({
      isOpen: true,
      title: '刪除標籤分類',
      message: `確定要刪除主標籤「${parent}」及其所有子標籤嗎？`,
      confirmText: '確認刪除',
      onConfirm: () => {
        const next = { ...recipeTags };
        delete next[parent];
        onUpdateRecipeTags(next);
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const addChildTag = (parent: string) => {
    const val = newChildTag.value.trim();
    if (val && recipeTags[parent] && !recipeTags[parent].includes(val)) {
      onUpdateRecipeTags({
        ...recipeTags,
        [parent]: [...recipeTags[parent], val]
      });
      setNewChildTag({ parent: '', value: '' });
    }
  };

  const removeChildTag = (parent: string, child: string) => {
    if (recipeTags[parent]) {
      onUpdateRecipeTags({
        ...recipeTags,
        [parent]: recipeTags[parent].filter(t => t !== child)
      });
    }
  };
  
  const exportAllToExcel = async () => {
    const wb = XLSX.utils.book_new();
    
    const defsForExport = defs.map(d => ({
        id: d.id,
        name: d.name,
        category: d.category,
        subCategory: d.subCategory,
        location: d.defaultLocation,
        minThreshold: d.minThreshold,
        price: d.price || 0,
        packageSize: d.packageSize || '',
        createdDate: d.createdDate
    }));

    const wsDefs = XLSX.utils.json_to_sheet(defsForExport);
    XLSX.utils.book_append_sheet(wb, wsDefs, "物品定義(Raw)");
    
    const wsTrans = XLSX.utils.json_to_sheet(transactions);
    XLSX.utils.book_append_sheet(wb, wsTrans, "異動紀錄(Raw)");
    
    const formattedRecipes = recipes.map(r => ({
      ...r,
      ingredients: JSON.stringify(r.ingredients),
      tags: JSON.stringify(r.tags)
    }));
    const wsRecipes = XLSX.utils.json_to_sheet(formattedRecipes);
    XLSX.utils.book_append_sheet(wb, wsRecipes, "食譜(Raw)");

    const fileName = `HomeStock_Report_${new Date().toISOString().split('T')[0]}.xlsx`;
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    if (navigator.share) {
      const file = new File([blob], fileName, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'HomeStock 報表' });
          return;
        } catch (err) {}
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        let rawDefs = workbook.SheetNames.includes("物品定義(Raw)") ? XLSX.utils.sheet_to_json(workbook.Sheets["物品定義(Raw)"]) : [];
        let rawTrans = workbook.SheetNames.includes("異動紀錄(Raw)") ? XLSX.utils.sheet_to_json(workbook.Sheets["異動紀錄(Raw)"]) : [];
        let rawRecipes = workbook.SheetNames.includes("食譜(Raw)") ? XLSX.utils.sheet_to_json(workbook.Sheets["食譜(Raw)"]) : [];
        onExcelImport(rawDefs as any, rawTrans as any, rawRecipes as any);
        setConfirmConfig({
          isOpen: true,
          title: '匯入成功',
          message: 'Excel 報表匯入完成！資料已更新。',
          isAlert: true,
          confirmText: '太好了',
          onConfirm: () => setConfirmConfig(prev => ({ ...prev, isOpen: false }))
        });
      } catch (err) { 
        setConfirmConfig({
          isOpen: true,
          title: '匯入失敗',
          message: '檔案格式錯誤或內容毀損，請確認後再試。',
          isAlert: true,
          confirmText: '關閉',
          onConfirm: () => setConfirmConfig(prev => ({ ...prev, isOpen: false }))
        });
      }
      if (excelInputRef.current) excelInputRef.current.value = '';
    };
    reader.readAsBinaryString(file);
  };

  const handleJsonExport = async () => {
    const backup: SystemBackup = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      data: {
        defs,
        transactions,
        recipes,
        shoppingList,
        settings,
        categories,
        locations,
        recipeTags
      }
    };
    
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const fileName = `HomeStock_Backup_${new Date().toISOString().split('T')[0]}.json`;

    if (navigator.share) {
      const file = new File([blob], fileName, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'HomeStock 系統備份' });
          return;
        } catch (err) {}
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleJsonUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const json = JSON.parse(evt.target?.result as string);
        if (!json.data || !Array.isArray(json.data.defs)) {
          throw new Error("Invalid Format");
        }
        setPendingBackup(json); 
      } catch (err) {
        setConfirmConfig({
          isOpen: true,
          title: '檔案錯誤',
          message: '備份檔案格式錯誤！請確認上傳的是正確的 .json 備份檔。',
          isAlert: true,
          confirmText: '好',
          onConfirm: () => setConfirmConfig(prev => ({ ...prev, isOpen: false }))
        });
      }
      if (jsonInputRef.current) jsonInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const handleClearAllDataConfirm = () => {
    setConfirmConfig({
      isOpen: true,
      title: '清除所有資料',
      message: '【警告】此動作將清除所有庫存、紀錄、食譜與設定資料，且無法復原！確定要重置所有資料嗎？',
      confirmText: '確認清除',
      onConfirm: () => {
        onClearAllData();
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  return (
    <div className="-mt-6 space-y-6 pb-24 animate-in fade-in duration-300">
      {/* Header */}
      <div className="pt-6 pb-2 px-1 flex items-center justify-between">
        <h1 className="text-2xl font-black tracking-tighter text-slate-900">設定</h1>
        <button onClick={onBack} className="bg-white/80 backdrop-blur-md border border-white shadow-sm text-slate-500 hover:text-slate-700 hover:bg-white p-2.5 rounded-full transition-all active:scale-90">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>

      {/* API Key Management (Glass Blue Card) */}
      <section className="bg-[#007AFF] p-6 rounded-[32px] shadow-[0_12px_30px_rgba(0,122,255,0.2)] border-t border-white/30 text-white space-y-4 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-xl" />
        <div className="relative z-10 flex items-center justify-between">
          <h3 className="font-black text-lg tracking-wide flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            Gemini API 設定
          </h3>
          <span className="text-[10px] font-black tracking-widest bg-white/20 px-2.5 py-1 rounded-full border border-white/20">本地儲存</span>
        </div>
        <div className="relative z-10 space-y-3">
          <p className="text-[13px] text-blue-100 font-medium leading-relaxed">
             請輸入您的 Google Gemini API Key 以啟用 AI 辨識功能。金鑰僅儲存在您的瀏覽器中。
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input 
                type={showKey ? "text" : "password"}
                placeholder="在此貼上 API Key" 
                className="w-full h-[46px] px-5 pr-10 rounded-full border border-white/30 bg-white/10 backdrop-blur-md text-white placeholder-blue-200 focus:ring-2 focus:ring-white/50 outline-none text-[15px] font-bold tracking-wider transition-all"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button 
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-200 hover:text-white p-1 transition-colors"
              >
                {showKey ? (
                   <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
                ) : (
                   <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
            <button 
              onClick={saveApiKey}
              className="h-[46px] bg-white text-[#007AFF] px-6 rounded-full font-black text-[15px] tracking-widest shadow-sm hover:bg-blue-50 active:scale-95 transition-all shrink-0"
            >
              儲存
            </button>
          </div>
        </div>
      </section>

      {/* 過期提醒 */}
      <section className="bg-white/70 backdrop-blur-xl p-6 rounded-[32px] shadow-[0_12px_40px_rgba(0,0,0,0.04)] border border-white/80 space-y-4">
        <h3 className="font-black tracking-tight text-slate-800 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#FF9500]"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
          過期提醒設定
        </h3>
        <div className="flex items-center justify-between gap-4 bg-white p-4 rounded-3xl border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
          <label className="text-[15px] font-black text-slate-600">提前幾天提醒？</label>
          <div className="flex items-center gap-2">
             <input 
               type="number" 
               className="w-[72px] h-[40px] px-3 rounded-full bg-slate-50 border border-white shadow-inner text-center font-black text-[#007AFF] text-lg focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 transition-all"
               value={settings.expiryThresholdDays}
               onChange={(e) => onUpdateSettings({ ...settings, expiryThresholdDays: parseInt(e.target.value) || 0 })}
             />
             <span className="text-sm font-bold text-slate-400">天</span>
          </div>
        </div>
      </section>

      {/* 食譜標籤管理 */}
      <section className="bg-white/70 backdrop-blur-xl p-6 rounded-[32px] shadow-[0_12px_40px_rgba(0,0,0,0.04)] border border-white/80 space-y-5">
        <h3 className="font-black tracking-tight text-slate-800 flex items-center gap-2">
           <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-500"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
           食譜標籤管理
        </h3>
        
        {/* Add Parent Tag */}
        <div className="flex gap-2">
          <input 
            type="text" 
            placeholder="新增主標籤 (如: 料理方式)..." 
            className="flex-1 min-w-0 h-[46px] px-5 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none text-[15px] font-black tracking-wide text-slate-800 placeholder:font-normal placeholder:text-slate-400 transition-all" 
            value={newParentTag} 
            onChange={(e) => setNewParentTag(e.target.value)} 
          />
          <button onClick={addParentTag} className="h-[46px] bg-[#007AFF] text-white px-6 rounded-full font-black text-[15px] tracking-widest shadow-[0_8px_20px_rgba(0,122,255,0.3)] border-t border-l border-white/40 border-b border-r border-black/10 hover:bg-blue-600 active:scale-95 transition-all shrink-0">新增</button>
        </div>

        <div className="space-y-4">
          {Object.entries(recipeTags).map(([parent, children]: [string, string[]]) => (
            <div key={parent} className="border border-white/80 shadow-sm rounded-[28px] p-5 bg-white/50 backdrop-blur-md">
              <div className="flex justify-between items-center mb-3">
                <h4 className="font-black text-slate-800 text-[15px] tracking-wide">{parent}</h4>
                <button onClick={() => removeParentTag(parent)} className="text-[11px] font-black tracking-widest text-[#FF3B30] bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-full transition-colors active:scale-95">刪除分類</button>
              </div>
              
              <div className="flex flex-wrap gap-2 mb-4">
                {children.map((child: string) => (
                  <span key={child} className="inline-flex items-center gap-1.5 bg-white border border-white shadow-sm px-3 py-1.5 rounded-full text-[13px] font-black text-slate-600 tracking-wide">
                    {child}
                    <button onClick={() => removeChildTag(parent, child)} className="text-slate-300 hover:text-[#FF3B30] bg-slate-50 rounded-full p-0.5 transition-colors">
                       <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                  </span>
                ))}
              </div>

              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder={`新增 ${parent} 子標籤...`} 
                  className="flex-1 min-w-0 h-[40px] px-4 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)] focus:ring-2 focus:ring-[#007AFF]/20 outline-none text-[13px] font-bold text-slate-700 placeholder:font-normal transition-all" 
                  value={newChildTag.parent === parent ? newChildTag.value : ''} 
                  onChange={(e) => setNewChildTag({ parent: parent, value: e.target.value })} 
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        addChildTag(parent);
                    }
                  }}
                />
                <button onClick={() => addChildTag(parent)} className="h-[40px] bg-slate-100 border border-white shadow-sm text-slate-600 px-5 rounded-full font-black text-[13px] hover:bg-slate-200 active:scale-95 transition-all shrink-0">
                  新增
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 類別管理 */}
      <section className="bg-white/70 backdrop-blur-xl p-6 rounded-[32px] shadow-[0_12px_40px_rgba(0,0,0,0.04)] border border-white/80 space-y-4">
        <h3 className="font-black tracking-tight text-slate-800 flex items-center gap-2">
           <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
           類別管理
        </h3>
        <div className="flex gap-2">
          <input type="text" placeholder="新增類別..." className="flex-1 min-w-0 h-[46px] px-5 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none text-[15px] font-black tracking-wide text-slate-800 placeholder:font-normal placeholder:text-slate-400 transition-all" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
          <button onClick={addCategory} className="h-[46px] bg-[#007AFF] text-white px-6 rounded-full font-black text-[15px] tracking-widest shadow-[0_8px_20px_rgba(0,122,255,0.3)] border-t border-l border-white/40 border-b border-r border-black/10 hover:bg-blue-600 active:scale-95 transition-all shrink-0">新增</button>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          {categories.map(cat => (
            <span key={cat} className="inline-flex items-center gap-1.5 bg-slate-100/80 border border-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] px-3.5 py-1.5 rounded-full text-[13px] font-black text-slate-600 tracking-wide">
              {cat}
              <button onClick={() => removeCategory(cat)} className="text-slate-400 hover:text-[#FF3B30] bg-white rounded-full p-0.5 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </span>
          ))}
        </div>
      </section>

      {/* 存放位置管理 */}
      <section className="bg-white/70 backdrop-blur-xl p-6 rounded-[32px] shadow-[0_12px_40px_rgba(0,0,0,0.04)] border border-white/80 space-y-4">
        <h3 className="font-black tracking-tight text-slate-800 flex items-center gap-2">
           <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
           存放位置管理
        </h3>
        <div className="flex gap-2">
          <input type="text" placeholder="新增位置..." className="flex-1 min-w-0 h-[46px] px-5 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none text-[15px] font-black tracking-wide text-slate-800 placeholder:font-normal placeholder:text-slate-400 transition-all" value={newLoc} onChange={(e) => setNewLoc(e.target.value)} />
          <button onClick={addLocation} className="h-[46px] bg-[#007AFF] text-white px-6 rounded-full font-black text-[15px] tracking-widest shadow-[0_8px_20px_rgba(0,122,255,0.3)] border-t border-l border-white/40 border-b border-r border-black/10 hover:bg-blue-600 active:scale-95 transition-all shrink-0">新增</button>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          {locations.map(loc => (
            <span key={loc} className="inline-flex items-center gap-1.5 bg-slate-100/80 border border-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] px-3.5 py-1.5 rounded-full text-[13px] font-black text-slate-600 tracking-wide">
              {loc}
              <button onClick={() => removeLocation(loc)} className="text-slate-400 hover:text-[#FF3B30] bg-white rounded-full p-0.5 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </span>
          ))}
        </div>
      </section>

      {/* 資料管理 (雙軌制) */}
      <section className="bg-white/70 backdrop-blur-xl p-6 rounded-[32px] shadow-[0_12px_40px_rgba(0,0,0,0.04)] border border-white/80 space-y-6">
        <h3 className="font-black tracking-tight text-slate-800 flex items-center gap-2">
           <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
           資料管理
        </h3>
        
        {/* Track 1: System Backup (JSON) */}
        <div className="space-y-4">
          <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest pl-1">系統備份 (JSON)</p>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={handleJsonExport} className="bg-blue-50/80 text-[#007AFF] font-black tracking-widest py-3.5 rounded-full border border-white shadow-sm hover:bg-blue-100 transition-all active:scale-95 text-[13px]">
               完整備份
            </button>
            <button onClick={() => jsonInputRef.current?.click()} className="bg-[#007AFF] text-white font-black tracking-widest py-3.5 rounded-full shadow-[0_8px_20px_rgba(0,122,255,0.3)] border-t border-l border-white/40 border-b border-r border-black/10 hover:bg-blue-600 active:scale-95 transition-all text-[13px]">
               還原備份
            </button>
            <input type="file" accept=".json" ref={jsonInputRef} onChange={handleJsonUpload} className="hidden" />
          </div>
          <p className="text-[11px] font-bold text-slate-400 leading-relaxed px-1">
            * 推薦使用。可完整備份並精確還原所有資料（含設定、清單與紀錄）。
          </p>
        </div>

        <div className="border-t border-white/60"></div>

        {/* Track 2: Excel Reports */}
        <div className="space-y-4">
          <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest pl-1">報表管理 (Excel)</p>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={exportAllToExcel} className="bg-emerald-50/80 text-emerald-600 font-black tracking-widest py-3.5 rounded-full border border-white shadow-sm hover:bg-emerald-100 transition-all active:scale-95 text-[13px]">
               匯出報表
            </button>
            <button onClick={() => excelInputRef.current?.click()} className="bg-white text-slate-600 font-black tracking-widest py-3.5 rounded-full border border-white shadow-sm hover:bg-slate-50 transition-all active:scale-95 text-[13px]">
               匯入 Excel
            </button>
            <input type="file" accept=".xlsx, .xls" ref={excelInputRef} onChange={handleExcelUpload} className="hidden" />
          </div>
        </div>

        <div className="border-t border-white/60 pt-6">
           <button onClick={handleClearAllDataConfirm} className="w-full bg-rose-50/80 text-[#FF3B30] font-black tracking-widest py-4 rounded-full border border-white shadow-sm hover:bg-rose-100 active:scale-95 transition-all text-sm">
             ⚠️ 清除所有資料 (重置)
           </button>
        </div>
      </section>

      <div className="pt-2 flex flex-col items-center gap-4">
        <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">HomeStock v3.7.1 (Personal Edition)</p>
      </div>

      {/* Restore Mode Modal */}
      {pendingBackup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white/90 backdrop-blur-2xl rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-white/80 w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 p-8">
             <h3 className="text-xl font-black tracking-tighter text-slate-900 mb-3 text-center">選擇還原模式</h3>
             <p className="text-sm font-bold text-slate-500 mb-6 leading-relaxed text-center">
               您選擇了一個備份檔案 ({new Date(pendingBackup.timestamp).toLocaleDateString()})。<br/>請問您希望如何處理現有資料？
             </p>
             
             <div className="space-y-3">
                <button 
                  onClick={() => { 
                    onSystemRestore(pendingBackup, 'merge'); 
                    setPendingBackup(null); 
                    setConfirmConfig({
                      isOpen: true,
                      title: '還原成功',
                      message: '資料合併完成！',
                      isAlert: true,
                      confirmText: '好的',
                      onConfirm: () => setConfirmConfig(prev => ({ ...prev, isOpen: false }))
                    });
                  }}
                  className="w-full p-5 rounded-[24px] bg-indigo-50 border border-white shadow-sm hover:bg-indigo-100 transition-all text-left relative group active:scale-[0.98]"
                >
                  <span className="block text-[15px] font-black tracking-wide text-indigo-700 mb-1">智能合併 (推薦)</span>
                  <span className="text-xs font-bold text-indigo-500 opacity-80 leading-relaxed block pr-6">保留現有資料，僅更新重複項並加入新項目。</span>
                  <div className="absolute right-5 top-1/2 -translate-y-1/2 text-indigo-400 group-hover:translate-x-1 transition-transform">
                     <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                  </div>
                </button>

                <button 
                  onClick={() => { 
                    setConfirmConfig({
                      isOpen: true,
                      title: '確認覆蓋',
                      message: '確定要覆蓋嗎？現有資料將完全消失，且無法復原。',
                      confirmText: '確認覆蓋',
                      onConfirm: () => {
                        onSystemRestore(pendingBackup, 'overwrite'); 
                        setPendingBackup(null); 
                        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
                        setConfirmConfig({
                          isOpen: true,
                          title: '還原成功',
                          message: '資料已完整還原！',
                          isAlert: true,
                          confirmText: '好的',
                          onConfirm: () => setConfirmConfig(prev => ({ ...prev, isOpen: false }))
                        });
                      }
                    });
                  }}
                  className="w-full p-5 rounded-[24px] bg-white border border-white shadow-sm hover:bg-rose-50 transition-all text-left relative group active:scale-[0.98]"
                >
                  <span className="block text-[15px] font-black tracking-wide text-rose-600 mb-1">完全覆蓋</span>
                  <span className="text-xs font-bold text-slate-400 leading-relaxed block">刪除當前所有資料，完全替換為備份內容。</span>
                </button>
             </div>

             <button onClick={() => setPendingBackup(null)} className="w-full mt-6 text-slate-400 text-sm font-black py-2 hover:text-slate-600 active:scale-95 transition-all bg-white border border-white shadow-sm rounded-full">
               取消操作
             </button>
          </div>
        </div>
      )}

      {/* Clear Data Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        confirmText={confirmConfig.confirmText}
        cancelText={confirmConfig.cancelText}
        isAlert={confirmConfig.isAlert}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
      />

    </div>
  );
};

export default SettingsView;