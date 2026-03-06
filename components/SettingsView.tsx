import React, { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { AppSettings, InventoryItem, InventoryDef, InventoryTransaction, Recipe, ShoppingItem, SystemBackup, RecipeTagStructure, MealPlan } from '../types';
import ConfirmationModal from './ConfirmationModal';
import InputModal from './InputModal';

interface SettingsViewProps {
  settings: AppSettings;
  onUpdateSettings: (s: AppSettings) => void;
  categories: string[];
  onUpdateCategories: (cats: string[]) => void;
  onRenameCategory: (oldName: string, newName: string) => void;
  locations: string[];
  onUpdateLocations: (locs: string[]) => void;
  onRenameLocation: (oldName: string, newName: string) => void;
  recipeTags: RecipeTagStructure;
  onUpdateRecipeTags: (tags: RecipeTagStructure) => void;
  onRenameRecipeTag: (parent: string, oldChild: string, newChild: string) => void;
  mealPlans: MealPlan;
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

type SettingPage = 'main' | 'api' | 'expiry' | 'tags' | 'categories' | 'locations' | 'data';

const SettingsView: React.FC<SettingsViewProps> = ({
  settings, onUpdateSettings,
  categories, onUpdateCategories, onRenameCategory,
  locations, onUpdateLocations, onRenameLocation,
  recipeTags, onUpdateRecipeTags, onRenameRecipeTag,
  mealPlans,
  onBack, items, defs, transactions, recipes, shoppingList,
  onExcelImport, onSystemRestore, onClearAllData
}) => {
  const [activePage, setActivePage] = useState<SettingPage>('main');

  const [newCat, setNewCat] = useState('');
  const [newLoc, setNewLoc] = useState('');
  const [newParentTag, setNewParentTag] = useState('');
  const [newChildTag, setNewChildTag] = useState<{ parent: string, value: string }>({ parent: '', value: '' });

  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  const excelInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [pendingBackup, setPendingBackup] = useState<SystemBackup | null>(null);

  // Modals
  const [confirmConfig, setConfirmConfig] = useState<{ isOpen: boolean; title: string; message: string; confirmText?: string; cancelText?: string; isAlert?: boolean; onConfirm: () => void; }>({ isOpen: false, title: '', message: '', onConfirm: () => { } });
  const [editModal, setEditModal] = useState<{ isOpen: boolean; type: 'category' | 'location' | 'tag'; oldName: string; parent?: string }>({ isOpen: false, type: 'category', oldName: '' });

  useEffect(() => {
    if (editModal.isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [editModal.isOpen]);

  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) setApiKey(savedKey);
  }, []);

  const saveApiKey = () => {
    const trimmedKey = apiKey.trim();
    localStorage.setItem('gemini_api_key', trimmedKey);

    if (trimmedKey) {
      setConfirmConfig({
        isOpen: true,
        title: '設定成功',
        message: 'API Key 已儲存！您可以開始使用 AI 功能了。',
        isAlert: true,
        confirmText: '太好了',
        onConfirm: () => {
          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
          setActivePage('main');
        }
      });
    } else {
      setConfirmConfig({
        isOpen: true,
        title: '已清除',
        message: 'API Key 已清除。在重新設定之前，AI 相關功能將無法使用。',
        isAlert: true,
        confirmText: '了解',
        onConfirm: () => {
          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        }
      });
    }
  };

  // 🍎 修復核心 Bug：補回四個遺失的儲存與新增函數
  const addCategory = () => {
    const val = newCat.trim();
    if (val && !categories.includes(val)) {
      onUpdateCategories([...categories, val]);
      setNewCat('');
    }
  };

  const addLocation = () => {
    const val = newLoc.trim();
    if (val && !locations.includes(val)) {
      onUpdateLocations([...locations, val]);
      setNewLoc('');
    }
  };

  const addParentTag = () => {
    const val = newParentTag.trim();
    if (val && !recipeTags[val]) {
      onUpdateRecipeTags({ ...recipeTags, [val]: [] });
      setNewParentTag('');
    }
  };

  const addChildTag = (parent: string) => {
    const val = newChildTag.value.trim();
    if (val && newChildTag.parent === parent && !recipeTags[parent].includes(val)) {
      onUpdateRecipeTags({ ...recipeTags, [parent]: [...recipeTags[parent], val] });
      setNewChildTag({ parent: '', value: '' });
    }
  };

  // --- List Manipulations ---
  const handleRenameConfirm = (newName: string) => {
    const val = newName.trim();
    if (val && val !== editModal.oldName) {
      if (editModal.type === 'category' && !categories.includes(val)) {
        onRenameCategory(editModal.oldName, val);
      } else if (editModal.type === 'location' && !locations.includes(val)) {
        onRenameLocation(editModal.oldName, val);
      } else if (editModal.type === 'tag' && editModal.parent && !recipeTags[editModal.parent].includes(val)) {
        onRenameRecipeTag(editModal.parent, editModal.oldName, val);
      }
    }
    setEditModal({ ...editModal, isOpen: false });
  };

  const moveLocation = (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === locations.length - 1)) return;
    const newArr = [...locations];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    [newArr[index], newArr[targetIdx]] = [newArr[targetIdx], newArr[index]];
    onUpdateLocations(newArr);
  };

  const moveCategory = (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === categories.length - 1)) return;
    const newArr = [...categories];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    [newArr[index], newArr[targetIdx]] = [newArr[targetIdx], newArr[index]];
    onUpdateCategories(newArr);
  };

  // --- Exports / Imports --- 
  const exportAllToExcel = async () => {
    const wb = XLSX.utils.book_new();
    const defsForExport = defs.map(d => ({ id: d.id, name: d.name, category: d.category, subCategory: d.subCategory, location: d.defaultLocation, minThreshold: d.minThreshold, price: d.price || 0, packageSize: d.packageSize || '', createdDate: d.createdDate }));
    const wsDefs = XLSX.utils.json_to_sheet(defsForExport); XLSX.utils.book_append_sheet(wb, wsDefs, "物品定義(Raw)");
    const wsTrans = XLSX.utils.json_to_sheet(transactions); XLSX.utils.book_append_sheet(wb, wsTrans, "異動紀錄(Raw)");
    const formattedRecipes = recipes.map(r => ({ ...r, ingredients: JSON.stringify(r.ingredients), tags: JSON.stringify(r.tags) }));
    const wsRecipes = XLSX.utils.json_to_sheet(formattedRecipes); XLSX.utils.book_append_sheet(wb, wsRecipes, "食譜(Raw)");
    const fileName = `HomeStock_Report_${new Date().toISOString().split('T')[0]}.xlsx`;
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const workbook = XLSX.read(evt.target?.result, { type: 'binary' });
        let rawDefs = workbook.SheetNames.includes("物品定義(Raw)") ? XLSX.utils.sheet_to_json(workbook.Sheets["物品定義(Raw)"]) : [];
        let rawTrans = workbook.SheetNames.includes("異動紀錄(Raw)") ? XLSX.utils.sheet_to_json(workbook.Sheets["異動紀錄(Raw)"]) : [];
        let rawRecipes = workbook.SheetNames.includes("食譜(Raw)") ? XLSX.utils.sheet_to_json(workbook.Sheets["食譜(Raw)"]) : [];
        onExcelImport(rawDefs as any, rawTrans as any, rawRecipes as any);
        setConfirmConfig({ isOpen: true, title: '匯入成功', message: 'Excel 報表匯入完成！資料已更新。', isAlert: true, confirmText: '太好了', onConfirm: () => setConfirmConfig(prev => ({ ...prev, isOpen: false })) });
      } catch (err) { setConfirmConfig({ isOpen: true, title: '匯入失敗', message: '檔案格式錯誤或內容毀損。', isAlert: true, confirmText: '關閉', onConfirm: () => setConfirmConfig(prev => ({ ...prev, isOpen: false })) }); }
      if (excelInputRef.current) excelInputRef.current.value = '';
    }; reader.readAsBinaryString(file);
  };

  const handleJsonExport = async () => {
    const backup: SystemBackup = { version: '1.0', timestamp: new Date().toISOString(), data: { defs, transactions, recipes, shoppingList, settings, categories, locations, recipeTags, mealPlans } };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const fileName = `HomeStock_Backup_${new Date().toISOString().split('T')[0]}.json`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const handleJsonUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const json = JSON.parse(evt.target?.result as string);
        if (!json.data || !Array.isArray(json.data.defs)) throw new Error("Invalid Format");
        setPendingBackup(json);
      } catch (err) { setConfirmConfig({ isOpen: true, title: '檔案錯誤', message: '備份檔案格式錯誤！請確認上傳的是正確的 .json 備份檔。', isAlert: true, confirmText: '好', onConfirm: () => setConfirmConfig(prev => ({ ...prev, isOpen: false })) }); }
      if (jsonInputRef.current) jsonInputRef.current.value = '';
    }; reader.readAsText(file);
  };

  // 🍎 統一的 UI 渲染元件，套用 HomeStock 專屬風格
  const ListRow: React.FC<{ label: string, onClick: () => void, value?: string }> = ({ label, onClick, value }) => (
    <button onClick={onClick} className="w-full flex justify-between items-center bg-transparent px-5 py-4 border-b border-white/60 last:border-0 hover:bg-white/40 active:bg-white/90 transition-all active:scale-95 rounded-full">
      <span className="text-[17px] text-slate-800 font-bold">{label}</span>
      <div className="flex items-center gap-2">
        {value && <span className="text-[15px] font-bold text-slate-400">{value}</span>}
        <svg className="w-5 h-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
      </div>
    </button>
  );

  const EditRow: React.FC<{ name: string, onEdit: () => void, onDelete: () => void, onUp?: () => void, onDown?: () => void }> = ({ name, onEdit, onDelete, onUp, onDown }) => (
    <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/60 last:border-0 hover:bg-white/80 transition-colors group">
      <div className="flex items-center gap-3">
        <button onClick={onDelete} className="w-6 h-6 rounded-full bg-[#FF3B30] text-white flex items-center justify-center shrink-0 active:scale-90 transition-all">
          <div className="w-3 h-0.5 bg-white rounded-full"></div>
        </button>
        <span className="text-[17px] font-bold text-slate-800">{name}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <button onClick={onEdit} className="px-3 py-1.5 text-[#007AFF] font-bold text-sm bg-blue-50/60 hover:bg-blue-100 rounded-full transition-all active:scale-95">編輯</button>
        {onUp && onDown && (
          <div className="flex flex-col ml-1 gap-1">
            <button onClick={onUp} className="text-slate-400 hover:text-slate-600 p-0.5 transition-all active:scale-95 rounded-full"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m18 15-6-6-6 6" /></svg></button>
            <button onClick={onDown} className="text-slate-400 hover:text-slate-600 p-0.5 transition-all active:scale-95 rounded-full"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m6 9 6 6 6-6" /></svg></button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 pb-20">

      {/* HEADER (維持 iOS 導覽感但套用字體) */}
      <div className="flex items-center justify-between px-2 mb-2">
        {activePage !== 'main' ? (
          <button onClick={() => setActivePage('main')} className="text-[#007AFF] flex items-center gap-1 font-bold active:opacity-70 text-[17px]">
            <svg className="w-6 h-6" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            設定
          </button>
        ) : (
          <h2 className="text-[28px] font-black text-slate-900 tracking-tighter">系統設定</h2>
        )}
        {activePage === 'main' && (
          <button onClick={onBack} className="text-white font-bold bg-[#007AFF] px-5 py-2 rounded-full active:scale-95 transition-all shadow-[0_4px_12px_rgba(0,122,255,0.2)]">完成</button>
        )}
      </div>

      {/* --- PAGE: MAIN --- */}
      {activePage === 'main' && (
        <div className="space-y-6">
          <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 rounded-[32px] overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-white/60">
            <ListRow label="Gemini AI 引擎" onClick={() => setActivePage('api')} value={apiKey ? "已連接" : "未設定"} />
            <ListRow label="過期提醒天數" onClick={() => setActivePage('expiry')} value={`${settings.expiryThresholdDays} 天`} />
          </div>

          <div className="px-4 text-[11px] font-black text-slate-400 uppercase tracking-widest mb-[-12px]">資料分類管理</div>
          <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 rounded-[32px] overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-white/60">
            <ListRow label="大分類管理" onClick={() => setActivePage('categories')} value={categories.length.toString()} />
            <ListRow label="存放位置管理" onClick={() => setActivePage('locations')} value={locations.length.toString()} />
            <ListRow label="食譜標籤管理" onClick={() => setActivePage('tags')} value={Object.keys(recipeTags).length.toString()} />
          </div>

          <div className="px-4 text-[11px] font-black text-slate-400 uppercase tracking-widest mb-[-12px]">系統與備份</div>
          <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 rounded-[32px] overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-white/60">
            <ListRow label="資料備份與還原" onClick={() => setActivePage('data')} />
          </div>
          <p className="text-center text-[11px] text-slate-400 font-black uppercase tracking-widest mt-8">HomeStock v3.8 (Native Edition)</p>
        </div>
      )}

      {/* --- PAGE: API --- */}
      {activePage === 'api' && (
        <div className="space-y-4 animate-in slide-in-from-right-8">
          <h3 className="text-xl font-black text-slate-900 px-2 tracking-tighter">AI 引擎設定</h3>
          <p className="text-sm font-bold text-slate-500 px-2 leading-relaxed">請輸入您的 Google Gemini API Key 以啟用智慧辨識。金鑰僅儲存在您的設備中。</p>
          <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 rounded-[32px] border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] p-6 space-y-4">
            <input type={showKey ? "text" : "password"} placeholder="在此貼上 API Key..." className="w-full px-5 py-4 rounded-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none transition-all text-[15px] font-bold text-slate-800 placeholder:font-normal placeholder:text-slate-300" value={apiKey} onChange={e => setApiKey(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setShowKey(!showKey)} className="py-4 bg-slate-100/80 text-slate-600 rounded-full font-black tracking-widest active:scale-95 transition-all text-sm">{showKey ? '隱藏' : '顯示'}</button>
              <button onClick={saveApiKey} className="py-4 bg-[#007AFF] text-white rounded-full font-black tracking-widest active:scale-95 transition-all shadow-[0_4px_12px_rgba(0,122,255,0.2)] text-sm">儲存</button>
            </div>
          </div>
        </div>
      )}

      {/* --- PAGE: EXPIRY --- */}
      {activePage === 'expiry' && (
        <div className="space-y-4 animate-in slide-in-from-right-8">
          <h3 className="text-xl font-black text-slate-900 px-2 tracking-tighter">過期提醒設定</h3>
          <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 rounded-[32px] border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] p-6 flex items-center justify-between">
            <span className="text-[17px] text-slate-800 font-bold">提前幾天提醒？</span>
            <div className="relative w-28">
              <input type="number" className="w-full px-5 py-3 rounded-full bg-white/90 border border-white/60 shadow-[inset_0_2px_8px_rgba(0,0,0,0.03)] transition-all text-[17px] font-black text-[#007AFF] text-center focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none" value={settings.expiryThresholdDays} onChange={(e) => onUpdateSettings({ ...settings, expiryThresholdDays: parseInt(e.target.value) || 0 })} />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm pointer-events-none">天</span>
            </div>
          </div>
        </div>
      )}

      {/* --- PAGE: CATEGORIES --- */}
      {activePage === 'categories' && (
        <div className="space-y-4 animate-in slide-in-from-right-8">
          <h3 className="text-xl font-black text-slate-900 px-2 tracking-tighter">大分類管理</h3>
          <div className="flex gap-2 px-2">
            <input type="text" placeholder="新增分類..." className="flex-1 px-5 py-4 rounded-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] transition-all text-[15px] font-bold text-slate-800 placeholder:font-normal placeholder:text-slate-300 focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none" value={newCat} onChange={e => setNewCat(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { addCategory(); } }} />
            <button onClick={addCategory} className="bg-[#007AFF] text-white px-6 rounded-full font-black tracking-widest active:scale-95 transition-all shadow-[0_4px_12px_rgba(0,122,255,0.2)] text-sm shrink-0">新增</button>
          </div>
          <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 rounded-[32px] overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-white/60">
            {categories.map((cat, idx) => (
              <EditRow key={`cat-${idx}`} name={cat} onUp={() => moveCategory(idx, 'up')} onDown={() => moveCategory(idx, 'down')} onEdit={() => setEditModal({ isOpen: true, type: 'category', oldName: cat })} onDelete={() => {
                setConfirmConfig({ isOpen: true, title: '刪除分類', message: `確定要刪除「${cat}」嗎？`, confirmText: '刪除', onConfirm: () => { onUpdateCategories(categories.filter(c => c !== cat)); setConfirmConfig(prev => ({ ...prev, isOpen: false })); } });
              }} />
            ))}
          </div>
          <p className="text-[11px] font-bold text-slate-400 px-4 text-center tracking-wide">修改名稱會自動更新所有關聯的物品卡片。</p>
        </div>
      )}

      {/* --- PAGE: LOCATIONS --- */}
      {activePage === 'locations' && (
        <div className="space-y-4 animate-in slide-in-from-right-8">
          <h3 className="text-xl font-black text-slate-900 px-2 tracking-tighter">存放位置管理</h3>
          <div className="flex gap-2 px-2">
            <input type="text" placeholder="新增位置..." className="flex-1 px-5 py-4 rounded-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] transition-all text-[15px] font-bold text-slate-800 placeholder:font-normal placeholder:text-slate-300 focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none" value={newLoc} onChange={e => setNewLoc(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { addLocation(); } }} />
            <button onClick={addLocation} className="bg-[#007AFF] text-white px-6 rounded-full font-black tracking-widest active:scale-95 transition-all shadow-[0_4px_12px_rgba(0,122,255,0.2)] text-sm shrink-0">新增</button>
          </div>
          <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 rounded-[32px] overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-white/60">
            {locations.map((loc, idx) => (
              <EditRow key={`loc-${idx}`} name={loc} onUp={() => moveLocation(idx, 'up')} onDown={() => moveLocation(idx, 'down')} onEdit={() => setEditModal({ isOpen: true, type: 'location', oldName: loc })} onDelete={() => {
                setConfirmConfig({ isOpen: true, title: '刪除位置', message: `確定要刪除「${loc}」嗎？`, confirmText: '刪除', onConfirm: () => { onUpdateLocations(locations.filter(l => l !== loc)); setConfirmConfig(prev => ({ ...prev, isOpen: false })); } });
              }} />
            ))}
          </div>
          <p className="text-[11px] font-bold text-slate-400 px-4 text-center tracking-wide">可使用右側上下箭頭調整選單排序。</p>
        </div>
      )}

      {/* --- PAGE: TAGS --- */}
      {activePage === 'tags' && (
        <div className="space-y-6 animate-in slide-in-from-right-8">
          <h3 className="text-xl font-black text-slate-900 px-2 tracking-tighter">食譜標籤管理</h3>
          <div className="flex gap-2 px-2">
            <input type="text" placeholder="新增主分類 (如: 料理方式)" className="flex-1 px-5 py-4 rounded-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] transition-all text-[15px] font-bold text-slate-800 placeholder:font-normal placeholder:text-slate-300 focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none" value={newParentTag} onChange={e => setNewParentTag(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { addParentTag(); } }} />
            <button onClick={addParentTag} className="bg-slate-800 text-white px-5 rounded-full font-black tracking-widest active:scale-95 transition-all text-sm shrink-0 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">新增群組</button>
          </div>
          <div className="space-y-5">
            {Object.entries(recipeTags).map(([parent, children]: [string, string[]]) => (
              <div key={parent} className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 rounded-[32px] shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-white/60 overflow-hidden">
                <div className="bg-transparent px-5 py-4 flex justify-between items-center border-b border-white/60">
                  <h4 className="font-black text-slate-800 text-[17px] tracking-tight">{parent}</h4>
                  <button onClick={() => {
                    setConfirmConfig({ isOpen: true, title: '刪除群組', message: `確定刪除「${parent}」及其所有標籤嗎？`, confirmText: '刪除', onConfirm: () => { const next = { ...recipeTags }; delete next[parent]; onUpdateRecipeTags(next); setConfirmConfig(prev => ({ ...prev, isOpen: false })); } });
                  }} className="text-[#FF3B30] text-[11px] tracking-widest font-black px-3 py-1.5 bg-red-50 rounded-full">刪除群組</button>
                </div>
                <div className="p-0">
                  {children.map((child, idx) => (
                    <EditRow key={`tag-${parent}-${idx}`} name={child} onEdit={() => setEditModal({ isOpen: true, type: 'tag', oldName: child, parentTag: parent })} onDelete={() => {
                      setConfirmConfig({ isOpen: true, title: '刪除標籤', message: `確定要刪除「${child}」嗎？`, confirmText: '刪除', onConfirm: () => { onUpdateRecipeTags({ ...recipeTags, [parent]: recipeTags[parent].filter(t => t !== child) }); setConfirmConfig(prev => ({ ...prev, isOpen: false })); } });
                    }} />
                  ))}
                  {children.length === 0 && <div className="py-6 text-center text-sm font-bold text-slate-400">目前無標籤</div>}
                </div>
                <div className="p-4 bg-white/80 border-t border-white/60 flex gap-2">
                  <input type="text" placeholder={`新增 ${parent} 標籤...`} className="flex-1 px-4 py-3 rounded-full bg-white/90 border border-white/60 shadow-[inset_0_2px_8px_rgba(0,0,0,0.02)] text-[15px] font-bold text-slate-800 placeholder:font-normal focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none" value={newChildTag.parent === parent ? newChildTag.value : ''} onChange={e => setNewChildTag({ parent, value: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') addChildTag(parent); }} />
                  <button onClick={() => addChildTag(parent)} className="bg-[#007AFF] text-white w-12 rounded-full font-black text-lg shadow-[0_2px_10px_rgba(0,0,0,0.03)] active:scale-95 shrink-0 flex items-center justify-center">+</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --- PAGE: DATA --- */}
      {activePage === 'data' && (
        <div className="space-y-6 animate-in slide-in-from-right-8">
          <h3 className="text-xl font-black text-slate-900 px-2 tracking-tighter">資料與備份</h3>

          <div className="px-4 text-[11px] font-black text-slate-400 uppercase tracking-widest mb-[-12px]">JSON 系統完整備份 (推薦)</div>
          <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 rounded-[32px] overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-white/60">
            <button onClick={handleJsonExport} className="w-full flex items-center gap-3 px-5 py-4 border-b border-white/60 hover:bg-white/40 active:bg-white/90 text-slate-800 font-bold text-[17px] transition-all active:scale-95 rounded-full">
              <svg className="w-5 h-5 text-[#007AFF]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
              匯出備份檔
            </button>
            <button onClick={() => jsonInputRef.current?.click()} className="w-full flex items-center gap-3 px-5 py-4 hover:bg-white/40 active:bg-white/90 text-slate-800 font-bold text-[17px] transition-colors">
              <svg className="w-5 h-5 text-[#34C759]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" /></svg>
              還原備份檔
            </button>
            <input type="file" accept=".json" ref={jsonInputRef} onChange={handleJsonUpload} className="hidden" />
          </div>

          <div className="px-4 text-[11px] font-black text-slate-400 uppercase tracking-widest mb-[-12px]">Excel 報表</div>
          <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 rounded-[32px] overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-white/60">
            <button onClick={exportAllToExcel} className="w-full flex items-center gap-3 px-5 py-4 border-b border-white/60 hover:bg-white/40 active:bg-white/90 text-slate-800 font-bold text-[17px] transition-all active:scale-95 rounded-full">
              <svg className="w-5 h-5 text-[#007AFF]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M8 13h2" /><path d="M8 17h2" /><path d="M14 13h2" /><path d="M14 17h2" /></svg>
              匯出 Excel
            </button>
            <button onClick={() => excelInputRef.current?.click()} className="w-full flex items-center gap-3 px-5 py-4 hover:bg-white/40 active:bg-white/90 text-slate-800 font-bold text-[17px] transition-colors">
              <svg className="w-5 h-5 text-[#34C759]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M12 18v-6" /><path d="m9 15 3-3 3 3" /></svg>
              匯入 Excel
            </button>
            <input type="file" accept=".xlsx, .xls" ref={excelInputRef} onChange={handleExcelUpload} className="hidden" />
          </div>

          <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 rounded-[32px] overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-white/60 mt-8">
            <button onClick={() => {
              setConfirmConfig({ isOpen: true, title: '清除所有資料', message: '【警告】此動作將清除所有庫存、紀錄、食譜與設定資料，且無法復原！確定要重置所有資料嗎？', confirmText: '確認清除', onConfirm: () => { onClearAllData(); setConfirmConfig(prev => ({ ...prev, isOpen: false })); } });
            }} className="w-full text-center px-5 py-4 text-[#FF3B30] font-black tracking-widest text-[17px] active:bg-red-50 transition-colors">
              重置所有資料
            </button>
          </div>
        </div>
      )}

      {/* Reused Modals */}
      <InputModal
        isOpen={editModal.isOpen}
        title={`修改${editModal.type === 'category' ? '分類' : editModal.type === 'location' ? '位置' : '標籤'}名稱`}
        message={`正在修改：「${editModal.oldName}」`}
        defaultValue={editModal.oldName}
        onConfirm={handleRenameConfirm}
        onCancel={() => setEditModal({ ...editModal, isOpen: false })}
      />

      {pendingBackup && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[40px] backdrop-saturate-150" onClick={(e) => e.stopPropagation()}>
          <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 rounded-[32px] shadow-[0_24px_48px_rgba(0,0,0,0.06),inset_0_2px_2px_rgba(255,255,255,1)] border border-white/60 w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 p-6 overscroll-contain" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-black text-slate-900 mb-2 text-center tracking-tighter">選擇還原模式</h3>
            <p className="text-sm font-bold text-slate-500 mb-6 leading-relaxed text-center">您選擇了一個備份檔案 ({new Date(pendingBackup.timestamp).toLocaleDateString()})。<br />請問您希望如何處理現有資料？</p>
            <div className="space-y-3">
              <button onClick={() => { onSystemRestore(pendingBackup, 'merge'); setPendingBackup(null); setConfirmConfig({ isOpen: true, title: '還原成功', message: '資料合併完成！', isAlert: true, confirmText: '好的', onConfirm: () => setConfirmConfig(prev => ({ ...prev, isOpen: false })) }); }} className="w-full py-4 rounded-full bg-[#007AFF] text-white font-black tracking-widest shadow-[0_4px_12px_rgba(0,122,255,0.2)] active:scale-[0.98] transition-all text-center">
                智能合併 (推薦) <span className="block text-[10px] font-normal opacity-80 mt-0.5 tracking-normal">保留現有，僅加入新項目</span>
              </button>
              <button onClick={() => { setConfirmConfig({ isOpen: true, title: '確認覆蓋', message: '確定要覆蓋嗎？現有資料將完全消失。', confirmText: '確認覆蓋', onConfirm: () => { onSystemRestore(pendingBackup, 'overwrite'); setPendingBackup(null); setConfirmConfig(prev => ({ ...prev, isOpen: false })); setTimeout(() => setConfirmConfig({ isOpen: true, title: '還原成功', message: '資料已完整還原！', isAlert: true, confirmText: '好的', onConfirm: () => setConfirmConfig(prev => ({ ...prev, isOpen: false })) }), 300); } }); }} className="w-full py-4 rounded-full bg-red-50 text-[#FF3B30] font-black tracking-widest active:scale-[0.98] transition-all text-center">
                完全覆蓋 <span className="block text-[10px] font-normal opacity-70 mt-0.5 tracking-normal">刪除當前資料，完全替換為備份</span>
              </button>
            </div>
            <button onClick={() => setPendingBackup(null)} className="w-full mt-4 text-slate-400 text-sm font-bold py-3 hover:text-slate-600 transition-colors">取消操作</button>
          </div>
        </div>
      )}

      <ConfirmationModal isOpen={confirmConfig.isOpen} title={confirmConfig.title} message={confirmConfig.message} confirmText={confirmConfig.confirmText} cancelText={confirmConfig.cancelText} isAlert={confirmConfig.isAlert} onConfirm={confirmConfig.onConfirm} onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))} />
    </div>
  );
};

export default SettingsView;