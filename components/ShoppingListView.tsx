import React, { useState, useRef } from 'react';
import { ShoppingItem, InventoryItem } from '../types';

interface ShoppingListViewProps {
  shoppingList: ShoppingItem[];
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  showAddQuickItem: boolean;
  onCloseAddQuickItem: () => void;
  onAddQuickItem: (name: string, category: string) => void;
  categories: string[];
  existingItems: InventoryItem[];
}

const CATEGORY_MAP: Record<string, string[]> = {
  '食品': ['牛奶', '蛋', '肉', '菜', '米', '麵', '油', '鹽', '糖', '零食', '飲料', '水', '水果', '餅乾', '巧克力', '粉'],
  '雜貨': ['紙巾', '洗衣粉', '清潔劑', '電池', '垃圾袋', '衛生紙'],
  '藥品': ['維他命', '止痛藥', '感冒藥', '紗布', '酒精'],
  '盥洗用品': ['洗髮', '沐浴', '牙膏', '牙刷', '洗面乳'],
  '電子產品': ['充電線', '插頭', '耳機', '電池']
};

interface ShoppingItemRowProps {
  item: ShoppingItem;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
}

const ShoppingItemRow: React.FC<ShoppingItemRowProps> = ({ item, onRemove, onToggle }) => {
  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [swipedOpen, setSwipedOpen] = useState(false);
  const startX = useRef(0);
  const threshold = 70;

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    setIsSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const currentX = e.touches[0].clientX;
    const diff = currentX - startX.current;

    // Only allow left swipe or closing from swiped state
    let newOffset = swipedOpen ? diff - threshold : diff;
    if (newOffset > 0) newOffset = 0;
    if (newOffset < -threshold - 20) newOffset = -threshold - 20; // limit pull

    setOffsetX(newOffset);
  };

  const handleTouchEnd = () => {
    setIsSwiping(false);
    if (offsetX < -threshold / 2) {
      setOffsetX(-threshold);
      setSwipedOpen(true);
    } else {
      setOffsetX(0);
      setSwipedOpen(false);
    }
  };

  return (
    <div className="relative overflow-hidden group">
      {/* Delete Background Action */}
      <div
        className={`absolute inset-0 bg-[#FF3B30] flex justify-end items-center px-6 z-0 transition-opacity duration-300 ${offsetX === 0 ? 'opacity-0' : 'opacity-100'}`}
        onClick={() => onRemove(item.id)}
      >
        <div className="flex flex-col items-center text-white">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          <span className="text-[10px] font-black mt-1 uppercase tracking-widest">刪除</span>
        </div>
      </div>

      {/* Foreground Content (Checklist Item) */}
      <div
        className={`p-5 relative z-10 flex justify-between items-center group transition-all duration-300 ease-out cursor-pointer active:bg-white/50 ${item.isChecked ? 'bg-slate-50/40' : 'bg-white/80 hover:bg-white'}`}
        style={{ transform: `translateX(${offsetX}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => onToggle(item.id)}
      >
        <div className="flex gap-4 items-center flex-1 min-w-0">
          {/* Checkbox Icon - iOS Style */}
          <div className={`w-[26px] h-[26px] rounded-full border-[1.5px] flex items-center justify-center transition-all duration-300 shrink-0 ${item.isChecked
            ? 'bg-[#007AFF] border-[#007AFF] shadow-md shadow-blue-500/20'
            : 'border-slate-300 bg-white group-hover:border-[#007AFF]/50'
            }`}>
            {item.isChecked && (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="animate-in zoom-in duration-200"><polyline points="20 6 9 17 4 12" /></svg>
            )}
          </div>

          <div className={`min-w-0 transition-all duration-300 ${item.isChecked ? 'opacity-40' : 'opacity-100'}`}>
            <h3 className={`font-black tracking-tight text-[17px] text-slate-800 truncate transition-all ${item.isChecked ? 'line-through decoration-slate-400 text-slate-500' : ''}`}>
              {item.name}
            </h3>
            <p className="text-[11px] font-bold text-slate-400 tracking-wider truncate mt-1">
              {item.category} • 加入於 {item.addedDate}
            </p>
          </div>
        </div>

        {/* Swipe hint for mobile */}
        <div className={`sm:hidden pl-4 transition-opacity duration-300 ${item.isChecked ? 'text-slate-200 opacity-0' : 'text-slate-300'}`}>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </div>
      </div>
    </div>
  );
};

const ShoppingListView: React.FC<ShoppingListViewProps> = ({
  shoppingList,
  onRemove,
  onToggle,
  showAddQuickItem,
  onCloseAddQuickItem,
  onAddQuickItem,
  categories,
  existingItems
}) => {
  const [quickName, setQuickName] = useState('');
  const [quickCategory, setQuickCategory] = useState('其他');
  const [hasManuallySetCategory, setHasManuallySetCategory] = useState(false);

  const predictCategory = (name: string) => {
    const historical = existingItems.find(item => item.name.toLowerCase() === name.toLowerCase());
    if (historical) return historical.category;

    for (const [cat, keywords] of Object.entries(CATEGORY_MAP)) {
      if (keywords.some(k => name.includes(k))) return cat;
    }
    return null;
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setQuickName(newName);
    if (!hasManuallySetCategory) {
      const predicted = predictCategory(newName);
      if (predicted) setQuickCategory(predicted);
    }
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickName) return;
    onAddQuickItem(quickName, quickCategory);
    setQuickName('');
    setQuickCategory('其他');
    setHasManuallySetCategory(false);
  };

  const sortedList = [...shoppingList].sort((a, b) => {
    if (a.isChecked === b.isChecked) return 0;
    return a.isChecked ? 1 : -1;
  });

  return (
    <div className="-mt-6 space-y-0 pb-24">
      {/* 標題區塊 */}
      <div className="pt-6 pb-2 px-1">
        <h1 className="text-2xl font-black tracking-tighter text-slate-900">待購買清單</h1>
        <p className="text-slate-500 font-bold text-sm mt-1">{shoppingList.length} 項物品</p>
      </div>

      {/* 快速新增表單 (與總覽卡片等寬) */}
      {showAddQuickItem && (
        <form onSubmit={handleAddSubmit} className="mt-2 bg-white/70 backdrop-blur-xl p-5 rounded-[32px] shadow-[0_12px_40px_rgba(0,0,0,0.05)] border border-white/80 flex flex-col gap-4 animate-in slide-in-from-top duration-300">
          <div className="flex justify-between items-center px-1">
            <h3 className="text-[15px] font-black tracking-wide text-[#007AFF]">新增待買項目</h3>
            <button type="button" onClick={onCloseAddQuickItem} className="text-slate-400 hover:text-slate-600 bg-white/50 hover:bg-white p-2 rounded-full transition-all active:scale-90 border border-transparent hover:border-white hover:shadow-sm">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </div>
          <div className="flex gap-2 items-center w-full">
            <input
              autoFocus
              required
              type="text"
              placeholder="物品名稱..."
              className="flex-1 min-w-0 h-[46px] px-5 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none text-[15px] font-black tracking-wide text-slate-800 placeholder:font-normal placeholder:text-slate-400 transition-all"
              value={quickName}
              onChange={handleNameChange}
            />
            <select
              className="h-[46px] w-[90px] px-4 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none text-[13px] font-black tracking-wide text-slate-700 transition-all appearance-none"
              style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: `right 0.8rem center`, backgroundRepeat: `no-repeat`, backgroundSize: `1.2em 1.2em`, paddingRight: `2rem` }}
              value={quickCategory}
              onChange={e => {
                setQuickCategory(e.target.value);
                setHasManuallySetCategory(true);
              }}
            >
              {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            <button type="submit" className="h-[46px] bg-[#007AFF] text-white px-6 rounded-full font-black text-[15px] tracking-widest shadow-[0_8px_20px_rgba(0,122,255,0.3)] border-t border-l border-white/40 border-b border-r border-black/10 hover:bg-blue-600 active:scale-96 transition-all shrink-0">
              新增
            </button>
          </div>
        </form>
      )}

      {/* 主要清單區塊 (大圓角玻璃清單) */}
      <div className="mt-4 bg-white/70 backdrop-blur-xl rounded-[32px] shadow-[0_12px_40px_rgba(0,0,0,0.04)] border border-white/80 overflow-hidden divide-y divide-white/60">
        {shoppingList.length === 0 ? (
          <div className="text-center py-24 bg-white/50">
            <div className="flex justify-center mb-5 text-slate-300 drop-shadow-sm">
              <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></svg>
            </div>
            <p className="text-slate-500 font-black tracking-wide text-[17px]">目前不需要購買任何東西！</p>
          </div>
        ) : (
          sortedList.map(item => (
            <ShoppingItemRow
              key={item.id}
              item={item}
              onRemove={onRemove}
              onToggle={onToggle}
            />
          ))
        )}
      </div>

      {/* 底部使用小撇步區塊 */}
      {shoppingList.length > 0 && (
        <div className="pt-4">
          <div className="p-5 bg-white/50 backdrop-blur-md rounded-[24px] border border-white/80 shadow-[0_4px_15px_rgba(0,0,0,0.03)]">
            <div className="flex gap-3 items-start">
              <div className="text-[#007AFF] shrink-0 mt-0.5 bg-blue-50 w-[26px] h-[26px] flex items-center justify-center rounded-full border border-white shadow-sm">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
              </div>
              <div>
                <p className="text-xs text-slate-600 font-black tracking-widest mb-1.5 uppercase">使用小撇步</p>
                <ul className="text-xs text-slate-500 font-bold space-y-1.5 list-disc list-inside leading-relaxed">
                  <li>點擊項目即可標示為「已買到」<span className="text-slate-400 font-medium">(項目不會消失)</span>。</li>
                  <li>直到您回家在 <span className="text-[#007AFF] font-black">庫存頁面</span> 完成「入庫」且名稱相符，系統才會自動幫您從清單移除。</li>
                  <li>向左滑動可強制刪除項目。</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShoppingListView;