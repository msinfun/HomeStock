
import React, { useState, useMemo } from 'react';
import { InventoryItem, ShoppingItem, ViewState, AppSettings } from '../types';

interface DashboardProps {
  items: InventoryItem[];
  shoppingList: ShoppingItem[];
  onSwitchView: (view: ViewState) => void;
  settings: AppSettings;
  onAddToShopping: (name: string, category: string) => void;
  onEdit: (item: InventoryItem) => void;
}

// Helper interface for aggregated restocking
interface RestockGroup {
  id: string; // Group ID (subCategory or name)
  name: string; // Display Name (subCategory or name)
  category: string;
  totalQuantity: number;
  maxThreshold: number;
  items: InventoryItem[]; // Items included in this group
  nextRestockDate: string | null;
}

const Dashboard: React.FC<DashboardProps> = ({ items, shoppingList, onSwitchView, settings, onAddToShopping, onEdit }) => {
  const [isRestockExpanded, setIsRestockExpanded] = useState(false);
  const [isExpiryExpanded, setIsExpiryExpanded] = useState(true);

  const today = new Date();
  const thresholdDate = new Date();
  thresholdDate.setDate(today.getDate() + settings.expiryThresholdDays);

  const expiringItems = items.filter(item => {
    if (!item.expiryDate) return false;
    const expiry = new Date(item.expiryDate);
    // Modified: Include expired items (expiry <= today) and upcoming items within threshold
    return expiry <= thresholdDate;
  }).sort((a, b) => {
    return (a.expiryDate!).localeCompare(b.expiryDate!);
  });

  // Aggregated Restock Logic
  const replenishmentItems = useMemo(() => {
    const groups: Record<string, RestockGroup> = {};
    
    items.forEach(item => {
      const subCat = (item.subCategory || '').trim();
      const name = item.name.trim();
      
      // Determine grouping key and display name
      // If subCategory exists, group by it. Otherwise group by name.
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
      // Take the MAXIMUM threshold in the group as the safety level for the group
      group.maxThreshold = Math.max(group.maxThreshold, item.minThreshold ?? 0);
      
      // Keep earliest valid nextRestockDate if available
      if (item.nextRestockDate) {
        if (!group.nextRestockDate || item.nextRestockDate < group.nextRestockDate) {
           group.nextRestockDate = item.nextRestockDate;
        }
      }
    });

    // Filter: Total Quantity < Max Threshold
    // And exclude if Max Threshold is 0 (meaning no tracking needed)
    return Object.values(groups)
      .filter(g => g.maxThreshold > 0 && g.totalQuantity < g.maxThreshold);
      
  }, [items]);

  // Modified: Sync outOfStockCount with the replenishment/aggregation logic
  const outOfStockCount = replenishmentItems.length;

  const getRestockLabel = (dateStr: string) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const [y, m, d] = dateStr.split('-').map(Number);
    const target = new Date(y, m - 1, d);
    const diffTime = target.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays > 0) return `再 ${diffDays} 天購買`;
    if (diffDays === 0) return `建議今天購買`;
    return `建議立即購買`;
  };

  const getExpiryBadgeClass = (expiryDate: string) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const [y, m, d] = expiryDate.split('-').map(Number);
    const target = new Date(y, m - 1, d);
    const diffTime = target.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 3) return "bg-red-100 text-[#FF3B30]";
    if (diffDays <= 7) return "bg-orange-100 text-[#FF9500]";
    return "bg-green-100 text-[#34C759]";
  };

  // Logic for List Expansion
  const displayedRestockItems = isRestockExpanded ? replenishmentItems : replenishmentItems.slice(0, 3);
  const hiddenRestockCount = replenishmentItems.length - displayedRestockItems.length;

  const displayedExpiryItems = isExpiryExpanded ? expiringItems : expiringItems.slice(0, 3);
  const hiddenExpiryCount = expiringItems.length - displayedExpiryItems.length;

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-300">
      {/* 1. 頂部統計卡片 (Overview Cards) */}
      <section className="grid grid-cols-2 gap-4">
        {/* 總物品數卡片 */}
        <div 
          className="bg-white/70 backdrop-blur-xl p-5 rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-white/80 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-white active:scale-[0.96] transition-all group" 
          onClick={() => onSwitchView('inventory')}
        >
          <span className="text-4xl font-black tracking-tighter text-slate-800 group-hover:text-[#007AFF] transition-colors drop-shadow-sm">{items.length}</span>
          <span className="text-xs font-black tracking-wider text-slate-400 mt-2 uppercase">總物品數</span>
        </div>
        
        {/* 缺貨待補卡片 */}
        <div 
          className="bg-white/70 backdrop-blur-xl p-5 rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-white/80 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-white active:scale-[0.96] transition-all group" 
          onClick={() => onSwitchView('shopping')}
        >
          <span className={`text-4xl font-black tracking-tighter transition-colors drop-shadow-sm ${outOfStockCount > 0 ? 'text-[#FF3B30]' : 'text-slate-800 group-hover:text-[#007AFF]'}`}>
             {outOfStockCount}
          </span>
          <span className="text-xs font-black tracking-wider text-slate-400 mt-2 uppercase">缺貨待補</span>
        </div>
      </section>

      {/* 2. 即將過期 (Expiry Alerts) */}
      <section className="bg-white/70 backdrop-blur-xl border border-white/80 rounded-[32px] p-6 shadow-[0_12px_40px_rgba(0,0,0,0.05)]">
        <div 
           className="flex justify-between items-center mb-4 cursor-pointer group"
           onClick={() => setIsExpiryExpanded(!isExpiryExpanded)}
        >
          <div className="flex items-center gap-3 text-slate-800">
            <div className="p-2.5 bg-red-50 rounded-2xl border border-white shadow-sm">
               <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#FF3B30]"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
            </div>
            <h2 className="text-xl font-black tracking-tighter text-slate-800">即將過期</h2>
          </div>
          <button className="bg-white border border-white shadow-sm text-slate-400 group-hover:text-slate-600 group-hover:bg-slate-50 transition-colors p-2 rounded-full">
             {isExpiryExpanded ? (
               <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
             ) : (
               <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
             )}
          </button>
        </div>
        
        {expiringItems.length === 0 ? (
          <div className="text-center py-6 text-sm text-slate-500 font-bold bg-white/50 rounded-[24px] border border-dashed border-slate-200">
            目前沒有即將過期的物品
          </div>
        ) : (
          <ul className="space-y-3">
            {displayedExpiryItems.map(item => (
              <li 
                key={item.id} 
                onClick={() => onEdit(item)}
                className="flex justify-between items-center gap-3 p-4 bg-white/60 border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] cursor-pointer hover:bg-white active:scale-[0.98] transition-all rounded-[24px]"
              >
                <span className="text-[17px] font-black tracking-tight text-slate-800 flex-1 truncate">{item.name}</span>
                <span className={`text-[10px] font-black tracking-widest px-3 py-1.5 rounded-full whitespace-nowrap shrink-0 border border-white shadow-sm ${item.expiryDate ? getExpiryBadgeClass(item.expiryDate) : 'bg-slate-100 text-slate-500'}`}>
                  {item.expiryDate || '未知'}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* 展開 / 收起按鈕：改為膠囊 */}
        {!isExpiryExpanded && hiddenExpiryCount > 0 && (
          <button 
            onClick={(e) => { e.stopPropagation(); setIsExpiryExpanded(true); }}
            className="w-full text-center text-xs font-black tracking-widest text-slate-500 mt-4 py-3 bg-white border border-white shadow-sm hover:text-slate-700 hover:bg-slate-50 active:scale-[0.98] rounded-full transition-all uppercase"
          >
            還有 {hiddenExpiryCount} 項即將過期...
          </button>
        )}
        {isExpiryExpanded && expiringItems.length > 3 && (
            <button 
            onClick={(e) => { e.stopPropagation(); setIsExpiryExpanded(false); }}
            className="w-full text-center text-xs font-black tracking-widest text-slate-500 mt-4 py-3 bg-white border border-white shadow-sm hover:text-slate-700 hover:bg-slate-50 active:scale-[0.98] rounded-full transition-all uppercase"
          >
            收起清單
          </button>
        )}
      </section>

      {/* 3. 建議補貨 (Replenishment Suggestions) */}
      <section className="bg-white/70 backdrop-blur-xl border border-white/80 rounded-[32px] p-6 shadow-[0_12px_40px_rgba(0,0,0,0.05)]">
         <div 
           className="flex justify-between items-center mb-4 cursor-pointer group"
           onClick={() => setIsRestockExpanded(!isRestockExpanded)}
         >
          <div className="flex items-center gap-3 text-slate-800">
            <div className="p-2.5 bg-blue-50 rounded-2xl border border-white shadow-sm">
               <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#007AFF]"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            </div>
            <h2 className="text-xl font-black tracking-tighter text-slate-800">建議補貨</h2>
          </div>
          <button className="bg-white border border-white shadow-sm text-slate-400 group-hover:text-slate-600 group-hover:bg-slate-50 transition-colors p-2 rounded-full">
             {isRestockExpanded ? (
               <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
             ) : (
               <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
             )}
          </button>
        </div>
        
        {replenishmentItems.length === 0 ? (
          <div className="text-center py-6 text-sm text-slate-500 font-bold bg-white/50 rounded-[24px] border border-dashed border-slate-200">
            庫存充足，無需補貨
          </div>
        ) : (
          <div className="space-y-3">
            {displayedRestockItems.map(group => {
              const isInShoppingList = shoppingList.some(s => s.name.trim().toLowerCase() === group.name.trim().toLowerCase());
              const itemNames = Array.from(new Set(group.items.map(i => i.name))).join('、');
              
              return (
                <div key={group.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white/60 border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] rounded-[24px] animate-in fade-in duration-300">
                  <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-[17px] font-black tracking-tight text-slate-800 block">{group.name}</span>
                        {group.nextRestockDate && (
                           <span className="text-[10px] font-black tracking-widest px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 whitespace-nowrap border border-white">
                             {getRestockLabel(group.nextRestockDate)}
                           </span>
                        )}
                      </div>
                      <div className="text-xs font-bold text-slate-500 mt-1.5 flex items-center gap-1.5">
                        <span className="inline-block w-2 h-2 rounded-full bg-[#FF3B30] shadow-[0_0_8px_rgba(255,59,48,0.4)]"></span>
                        <span className="text-[#FF3B30]">總量 {group.totalQuantity} <span className="text-slate-400 font-medium">(低於 {group.maxThreshold})</span></span>
                      </div>
                      {group.id.startsWith('SUB:') && (
                         <div className="text-[11px] font-bold text-slate-400 mt-1.5 truncate">
                           包含: {itemNames}
                         </div>
                      )}
                  </div>
                  {/* 加入按鈕：膠囊狀 */}
                  <button 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      if (!isInShoppingList) {
                        onAddToShopping(group.name.trim(), group.category); 
                      }
                    }}
                    disabled={isInShoppingList}
                    className={`px-4 py-2.5 rounded-full text-xs font-black tracking-widest transition-all flex items-center justify-center gap-1.5 shrink-0 shadow-sm border border-white active:scale-95 ${
                      isInShoppingList 
                        ? 'bg-slate-100 text-slate-400 cursor-default'
                        : 'text-[#007AFF] bg-blue-50/80 hover:bg-blue-100'
                    }`}
                  >
                    {isInShoppingList ? '已加入' : '+ 加入待買'}
                  </button>
                </div>
              );
            })}
            
            {/* 展開 / 收起按鈕：改為膠囊 */}
            {!isRestockExpanded && hiddenRestockCount > 0 && (
              <button 
                onClick={() => setIsRestockExpanded(true)}
                className="w-full text-center text-xs font-black tracking-widest text-slate-500 mt-4 py-3 bg-white border border-white shadow-sm hover:text-slate-700 hover:bg-slate-50 active:scale-[0.98] rounded-full transition-all uppercase"
              >
                還有 {hiddenRestockCount} 項待補...
              </button>
            )}
            {isRestockExpanded && replenishmentItems.length > 3 && (
               <button 
                onClick={() => setIsRestockExpanded(false)}
                className="w-full text-center text-xs font-black tracking-widest text-slate-500 mt-4 py-3 bg-white border border-white shadow-sm hover:text-slate-700 hover:bg-slate-50 active:scale-[0.98] rounded-full transition-all uppercase"
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
