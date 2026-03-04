import React, { useState, useMemo } from 'react';
import { InventoryItem, ShoppingItem, ViewState, AppSettings } from '../types';

interface DashboardProps {
  items: InventoryItem[];
  shoppingList: ShoppingItem[];
  onSwitchView: (view: ViewState) => void;
  settings: AppSettings;
  onAddToShopping: (name: string, category: string) => void;
  onEdit: (item: InventoryItem) => void;
  onNavigateToInventoryItem?: (id: string) => void;
}

// Helper interface for aggregated restocking
interface RestockGroup {
  id: string;
  name: string;
  category: string;
  totalQuantity: number;
  maxThreshold: number;
  items: InventoryItem[];
  nextRestockDate: string | null;
}

const Dashboard: React.FC<DashboardProps> = ({ items, shoppingList, onSwitchView, settings, onAddToShopping, onEdit, onNavigateToInventoryItem }) => {
  const [isRestockExpanded, setIsRestockExpanded] = useState(false);
  const [isExpiryExpanded, setIsExpiryExpanded] = useState(true);

  const today = new Date();
  const thresholdDate = new Date();
  thresholdDate.setDate(today.getDate() + settings.expiryThresholdDays);

  const expiringItems = items.filter(item => {
    if (!item.expiryDate) return false;
    const expiry = new Date(item.expiryDate);
    const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return expiry <= thresholdDate && diffDays >= -30;
  }).sort((a, b) => {
    return (a.expiryDate!).localeCompare(b.expiryDate!);
  });

  const replenishmentItems = useMemo(() => {
    const groups: Record<string, RestockGroup> = {};

    items.forEach(item => {
      const subCat = (item.subCategory || '').trim();
      const name = item.name.trim();

      const key = subCat ? `SUB:${subCat.toLowerCase()}` : `NAME:${name.toLowerCase()}`;
      const displayName = subCat ? subCat : name;

      if (!groups[key]) {
        groups[key] = {
          id: key,
          name: displayName,
          category: item.category,
          totalQuantity: 0,
          maxThreshold: 0,
          items: [],
          nextRestockDate: null
        };
      }

      const group = groups[key];
      group.items.push(item);
      group.totalQuantity += item.quantity;
      group.maxThreshold = Math.max(group.maxThreshold, item.minThreshold ?? 0);

      if (item.nextRestockDate) {
        if (!group.nextRestockDate || item.nextRestockDate < group.nextRestockDate) {
          group.nextRestockDate = item.nextRestockDate;
        }
      }
    });

    return Object.values(groups).filter(g => g.maxThreshold > 0 && g.totalQuantity < g.maxThreshold);

  }, [items]);

  const outOfStockCount = replenishmentItems.length;

  const getRestockLabel = (dateStr: string) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const [y, m, d] = dateStr.split('-').map(Number);
    const target = new Date(y, m - 1, d);
    const diffTime = target.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays > 0) return `再 ${diffDays} 天`;
    if (diffDays === 0) return `建議今日`;
    return `立即購買`;
  };

  // 🍎 修正：回歸極簡扁平化的原廠標籤（去除漸層與高光）
  const getExpiryBadgeClass = (expiryDate: string) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const [y, m, d] = expiryDate.split('-').map(Number);
    const target = new Date(y, m - 1, d);
    const diffTime = target.getTime() - now.getTime();
    const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (days <= 3) {
      return "bg-red-50 text-[#FF3B30]";
    } else if (days <= 7) {
      return "bg-slate-100 text-slate-500";
    } else if (days <= 30) {
      return "bg-green-50 text-[#34C759]";
    } else if (days < 365) {
      return "bg-slate-100 text-slate-500";
    } else {
      return "bg-slate-100 text-slate-500";
    }
  };

  const getRestockBadgeColor = (targetDate: string) => {
    const now = new Date();
    const target = new Date(targetDate);
    const diffTime = target.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 3) return "bg-red-50 text-[#FF3B30]";
    if (diffDays <= 7) return "bg-blue-50 text-[#007AFF]"; // Changed from amber to blue
    return "bg-green-50 text-[#34C759]";
  };

  const displayedRestockItems = isRestockExpanded ? replenishmentItems : replenishmentItems.slice(0, 3);
  const hiddenRestockCount = replenishmentItems.length - displayedRestockItems.length;

  const displayedExpiryItems = isExpiryExpanded ? expiringItems : expiringItems.slice(0, 3);
  const hiddenExpiryCount = expiringItems.length - displayedExpiryItems.length;

  return (
    <div className="space-y-6 pb-24 animate-in fade-in duration-300">

      {/* 1. 頂部統計卡片 (Overview Cards) - 保持完美的外部光學 */}
      <section className="grid grid-cols-2 gap-4">
        <div
          className="bg-white/90 backdrop-blur-[40px] p-6 rounded-[32px] border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] flex flex-col items-center justify-center text-center cursor-pointer hover:bg-white active:scale-[0.96] transition-all group relative overflow-hidden"
          onClick={() => onSwitchView('inventory')}
        >
          <span className="text-[40px] font-black tracking-tighter text-slate-800 group-hover:text-[#007AFF] transition-colors drop-shadow-[0_2px_10px_rgba(0,0,0,0.03)] leading-none">{items.length}</span>
          <span className="text-[11px] font-black tracking-widest text-slate-400 mt-2.5 uppercase">總物品數</span>
        </div>

        <div
          className="bg-white/90 backdrop-blur-[40px] p-6 rounded-[32px] border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] flex flex-col items-center justify-center text-center cursor-pointer hover:bg-white active:scale-[0.96] transition-all group relative overflow-hidden"
          onClick={() => onSwitchView('shopping')}
        >
          <span className={`text-[40px] font-black tracking-tighter transition-colors drop-shadow-[0_2px_10px_rgba(0,0,0,0.03)] leading-none ${outOfStockCount > 0 ? 'text-[#FF3B30]' : 'text-slate-800 group-hover:text-[#007AFF]'}`}>
            {outOfStockCount}
          </span>
          <span className="text-[11px] font-black tracking-widest text-slate-400 mt-2.5 uppercase">缺貨待補</span>
        </div>
      </section>

      {/* 2. 即將過期 (Expiry Alerts) */}
      <section className="bg-white/90 backdrop-blur-[40px] border border-white/60 rounded-[32px] p-6 shadow-[0_2px_10px_rgba(0,0,0,0.03)] relative">
        <div
          className="flex justify-between items-center mb-5 cursor-pointer group"
          onClick={() => setIsExpiryExpanded(!isExpiryExpanded)}
        >
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_1px_rgba(255,255,255,1)] border border-white">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#FF3B30]"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
            </div>
            <h2 className="text-[20px] font-black tracking-tighter text-slate-800 drop-shadow-[0_2px_10px_rgba(0,0,0,0.03)]">即將過期</h2>
          </div>
          <button className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 border border-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] text-slate-400 group-hover:text-[#007AFF] transition-all p-2 rounded-full active:scale-95">
            {isExpiryExpanded ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
            )}
          </button>
        </div>

        {expiringItems.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-400 font-bold bg-white/40 rounded-3xl border border-dashed border-white">
            目前沒有即將過期的物品
          </div>
        ) : (
          <ul className="space-y-3 pb-24">
            {displayedExpiryItems.map(item => (
              <li
                key={item.id}
                onClick={() => onNavigateToInventoryItem ? onNavigateToInventoryItem(item.id) : onEdit(item)}
                // 🍎 內部小卡片：去除高光，回歸乾淨的半透白板與柔和陰影
                className="flex justify-between items-center gap-3 p-4 bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] cursor-pointer hover:bg-white active:scale-[0.98] transition-all rounded-3xl"
              >
                <span className="text-[16px] font-black tracking-tight text-slate-800 flex-1 truncate leading-tight">{item.name}</span>
                <span className={`text-[11px] font-black tracking-widest px-3.5 py-1.5 rounded-full whitespace-nowrap shrink-0 ${item.expiryDate ? getExpiryBadgeClass(item.expiryDate) : 'bg-slate-100 text-slate-400'}`}>
                  {item.expiryDate || '未知'}
                </span>
              </li>
            ))}
          </ul>
        )}

        {!isExpiryExpanded && hiddenExpiryCount > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setIsExpiryExpanded(true); }}
            className="w-full text-center text-[11px] font-black tracking-widest text-slate-500 mt-5 py-3.5 bg-white/80 border border-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] hover:text-[#007AFF] hover:bg-white active:scale-[0.98] rounded-full transition-all uppercase"
          >
            還有 {hiddenExpiryCount} 項即將過期...
          </button>
        )}
        {isExpiryExpanded && expiringItems.length > 3 && (
          <button
            onClick={(e) => { e.stopPropagation(); setIsExpiryExpanded(false); }}
            className="w-full text-center text-[11px] font-black tracking-widest text-slate-500 mt-5 py-3.5 bg-white/80 border border-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] hover:text-[#007AFF] hover:bg-white active:scale-[0.98] rounded-full transition-all uppercase"
          >
            收起清單
          </button>
        )}
      </section>

      {/* 3. 建議補貨 (Replenishment Suggestions) */}
      <section className="bg-white/90 backdrop-blur-[40px] border border-white/60 rounded-[32px] p-6 shadow-[0_2px_10px_rgba(0,0,0,0.03)] relative">
        <div
          className="flex justify-between items-center mb-5 cursor-pointer group"
          onClick={() => setIsRestockExpanded(!isRestockExpanded)}
        >
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_1px_rgba(255,255,255,1)] border border-white">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#007AFF]"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
            </div>
            <h2 className="text-[20px] font-black tracking-tighter text-slate-800 drop-shadow-[0_2px_10px_rgba(0,0,0,0.03)]">建議補貨</h2>
          </div>
          <button className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 border border-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] text-slate-400 group-hover:text-[#007AFF] transition-all p-2 rounded-full active:scale-95">
            {isRestockExpanded ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
            )}
          </button>
        </div>

        {replenishmentItems.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-400 font-bold bg-white/40 rounded-3xl border border-dashed border-white">
            庫存充足，無需補貨
          </div>
        ) : (
          <div className="space-y-3">
            {displayedRestockItems.map(group => {
              const isInShoppingList = shoppingList.some(s => s.name.trim().toLowerCase() === group.name.trim().toLowerCase());
              const itemNames = Array.from(new Set(group.items.map(i => i.name))).join('、');

              return (
                <div key={group.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-3xl hover:bg-white transition-all animate-in fade-in duration-300">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-[16px] font-black tracking-tight text-slate-800 block leading-tight">{group.name}</span>
                      {group.nextRestockDate && (
                        <span className="text-[10px] font-black tracking-widest px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 whitespace-nowrap uppercase">
                          {getRestockLabel(group.nextRestockDate)}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-black tracking-wide text-slate-500 mt-2 flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#FF3B30] shadow-[0_0_6px_rgba(255,59,48,0.8)]"></span>
                      <span className="text-[#FF3B30]">總量 {group.totalQuantity} <span className="text-slate-400 font-bold tracking-normal ml-0.5">(低於 {group.maxThreshold})</span></span>
                    </div>
                    {group.id.startsWith('SUB:') && (
                      <div className="text-[11px] font-bold text-slate-400 mt-1.5 truncate max-w-full bg-slate-100 inline-block px-2.5 py-1 rounded-full">
                        包含: {itemNames}
                      </div>
                    )}
                  </div>

                  {/* 🍎 修正：回歸極簡扁平的原廠藍按鈕，去除果凍光影 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isInShoppingList) {
                        onAddToShopping(group.name.trim(), group.category);
                      }
                    }}
                    disabled={isInShoppingList}
                    className={`px-5 py-3 sm:py-2.5 rounded-full text-[12px] font-black tracking-widest transition-all flex items-center justify-center gap-1.5 shrink-0 active:scale-95 uppercase ${isInShoppingList
                      ? 'bg-slate-100 text-slate-400 cursor-default'
                      : 'text-white bg-[#007AFF] shadow-[0_4px_12px_rgba(0,122,255,0.2)] hover:bg-blue-600'
                      }`}
                  >
                    {isInShoppingList ? '已加入' : '+ 加入待買'}
                  </button>
                </div>
              );
            })}

            {!isRestockExpanded && hiddenRestockCount > 0 && (
              <button
                onClick={() => setIsRestockExpanded(true)}
                className="w-full text-center text-[11px] font-black tracking-widest text-slate-500 mt-5 py-3.5 bg-white/80 border border-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] hover:text-[#007AFF] hover:bg-white active:scale-[0.98] rounded-full transition-all uppercase"
              >
                還有 {hiddenRestockCount} 項待補...
              </button>
            )}
            {isRestockExpanded && replenishmentItems.length > 3 && (
              <button
                onClick={() => setIsRestockExpanded(false)}
                className="w-full text-center text-[11px] font-black tracking-widest text-slate-500 mt-5 py-3.5 bg-white/80 border border-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] hover:text-[#007AFF] hover:bg-white active:scale-[0.98] rounded-full transition-all uppercase"
              >
                收起清單
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

export default Dashboard;