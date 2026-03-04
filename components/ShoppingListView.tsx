import React, { useState, useRef, useMemo, useEffect } from 'react';
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



interface ShoppingItemRowProps {
  item: ShoppingItem;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  isActiveSwipe: boolean;
  onSwipeStart: () => void;
}

const ShoppingItemRow: React.FC<ShoppingItemRowProps> = ({ item, onRemove, onToggle, isActiveSwipe, onSwipeStart }) => {
  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [swipedOpen, setSwipedOpen] = useState(false);
  const startX = useRef(0);
  const threshold = 70;

  // 監聽外部狀態，如果自己不是被選中的那個，就自動縮回去
  useEffect(() => {
    if (!isActiveSwipe) {
      setOffsetX(0);
      setSwipedOpen(false);
    }
  }, [isActiveSwipe]);

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    setIsSwiping(true);
    onSwipeStart(); // 通知父元件：「我被滑動了」
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const currentX = e.touches[0].clientX;
    const diff = currentX - startX.current;
    let newOffset = swipedOpen ? diff - threshold : diff;
    if (newOffset > 0) newOffset = 0;
    if (newOffset < -threshold - 20) newOffset = -threshold - 20;
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
    // 🍎 單一項目列：加入了標準的底部灰線，移除圓角
    <div className="relative group border-b border-slate-100 last:border-none">

      {/* 滑動刪除的紅色底層 */}
      <div
        className={`absolute inset-0 bg-transparent flex justify-end items-center px-6 z-0 transition-opacity duration-300 ${offsetX === 0 ? 'opacity-0' : 'opacity-100'}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(item.id);
          setOffsetX(0);
          setSwipedOpen(false);
        }}
      >
        <div className="flex flex-col items-center">
          <svg className="text-[#FF3B30]" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          <span className="text-slate-800 text-[10px] font-black mt-1 uppercase tracking-widest">刪除</span>
        </div>
      </div>

      {/* 🍎 項目內容：修復高度！加入 py-4 px-5 與 min-h-[72px] 保證 iOS 標準觸控高度 */}
      <div
        className={`flex items-center gap-4 py-4 px-5 min-h-[72px] transition-all duration-300 relative z-10 cursor-pointer ${item.isChecked ? 'bg-slate-50' : 'bg-white/90 hover:bg-slate-50/50'}`}
        style={{ transform: `translateX(${offsetX}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => {
          if (offsetX !== 0) return;
          onToggle(item.id);
        }}
      >
        {/* 勾選按鈕 */}
        <div className={`w-6 h-6 rounded-full border-[1.5px] flex items-center justify-center transition-colors shrink-0 ${item.isChecked ? 'bg-[#007AFF] border-[#007AFF] shadow-[0_4px_12px_rgba(0,122,255,0.2)]' : 'border-slate-300 bg-white'}`}>
          {item.isChecked && <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
        </div>

        {/* 物品名稱 */}
        <div className="flex-1 min-w-0">
          <span className={`text-[16px] font-black tracking-tight block truncate transition-colors ${item.isChecked ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-800'}`}>
            {item.name}
          </span>
        </div>

        {/* 分類標籤 */}
        <span className={`text-[10px] px-2.5 py-1.5 rounded-full font-black tracking-widest whitespace-nowrap shrink-0 transition-colors ${item.isChecked ? 'bg-slate-100/50 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
          {item.category}
        </span>
      </div>
    </div>
  );
};

const ShoppingListView: React.FC<ShoppingListViewProps> = ({
  shoppingList, onRemove, onToggle, showAddQuickItem, onCloseAddQuickItem, onAddQuickItem, categories, existingItems
}) => {
  const [activeSwipeId, setActiveSwipeId] = useState<string | null>(null);

  const totalCount = shoppingList.length;
  const completedCount = shoppingList.filter(item => item.isChecked).length;

  const [searchTerm, setSearchTerm] = useState('');

  const filteredItems = useMemo(() => {
    const historyNames = Array.from(new Set(existingItems.map(i => (i as any).name || i.name))) as string[];

    if (searchTerm.trim()) {
      return historyNames.filter(i => i.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    return historyNames;
  }, [searchTerm, existingItems]);

  return (
    <div className="-mt-4 space-y-6 pb-24 animate-in fade-in duration-300">

      {/* 頂部乾淨標題 */}
      <div className="flex items-center gap-3.5 px-2">
        <div className="p-2.5 bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_1px_rgba(255,255,255,1)] border border-white text-[#007AFF]">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></svg>
        </div>
        <div>
          <h2 className="text-[24px] font-black tracking-tighter text-slate-800 drop-shadow-[0_2px_10px_rgba(0,0,0,0.03)] leading-none">待買清單</h2>
          {totalCount > 0 && (
            <p className="text-[11px] font-black tracking-widest text-slate-400 mt-2 uppercase">
              已完成 {completedCount} / {totalCount} 項
            </p>
          )}
        </div>
      </div>

      {/* 🍎 清單區域：包裝在單一的圓角大卡片中，內部元素各自保有充裕高度 */}
      <div>
        {shoppingList.length === 0 ? (
          <div className="text-center py-12 bg-white/40 rounded-[32px] border border-dashed border-white shadow-[inset_0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-16 h-16 bg-blue-50 text-[#007AFF] border-2 border-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-full flex items-center justify-center mx-auto mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></svg>
            </div>
            <p className="text-[15px] font-black text-slate-600 tracking-wide">購物清單空空如也</p>
            <p className="text-xs font-bold text-slate-400 mt-1">點擊下方按鈕快速加入待買物品</p>
          </div>
        ) : (
          <div className="bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-[32px] overflow-hidden flex flex-col">
            {shoppingList.map(item => (
              <ShoppingItemRow
                key={item.id}
                item={item}
                onRemove={onRemove}
                onToggle={onToggle}
                isActiveSwipe={activeSwipeId === item.id}
                onSwipeStart={() => setActiveSwipeId(item.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 底部使用小撇步區塊 */}
      {shoppingList.length > 0 && (
        <section className="bg-white/90 backdrop-blur-[40px] border border-white/60 rounded-[32px] p-6 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
          <div className="flex gap-3.5 items-start">
            <div className="p-2.5 bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_1px_rgba(255,255,255,1)] border border-white text-[#007AFF]">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
            </div>
            <div>
              <h3 className="text-[16px] font-black tracking-tighter text-slate-800 mb-1.5 drop-shadow-[0_2px_10px_rgba(0,0,0,0.03)]">使用小撇步</h3>
              <ul className="text-[13px] text-slate-500 font-bold space-y-1.5 list-disc list-inside leading-relaxed">
                <li>買完後點擊圓圈打勾。</li>
                <li>向左滑動可以刪除項目。</li>
                <li>已購買的物品在「入庫」時，會自動從此清單移除。</li>
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* 快速新增彈窗 (Slide-up Modal) */}
      {showAddQuickItem && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4 bg-slate-900/40 backdrop-blur-[40px] backdrop-saturate-150 animate-in fade-in duration-200" onClick={onCloseAddQuickItem}>
          <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 w-full sm:max-w-sm sm:rounded-[32px] rounded-t-[32px] shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-white/60 flex flex-col h-[85vh] animate-in slide-in-from-bottom duration-200" onClick={e => e.stopPropagation()}>

            {/* 標題與關閉按鈕 */}
            <div className="flex justify-between items-center p-6 border-b border-slate-100 shrink-0 bg-white/80">
              <h3 className="text-xl font-black tracking-tighter text-slate-900">快速加入待買</h3>
              <button onClick={onCloseAddQuickItem} className="p-2.5 bg-white border border-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-full text-slate-500 hover:bg-slate-50 active:scale-95 transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
              {/* 搜尋輸入框 */}
              <div className="relative">
                <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 pointer-events-none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                <input
                  autoFocus
                  type="text"
                  className="w-full pl-11 pr-4 py-3.5 rounded-full bg-white border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] -[#007AFF]/15 text-[15px] font-bold text-slate-800 placeholder:font-normal placeholder:text-slate-400 transition-all focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="搜尋物品..."
                  onKeyDown={e => {
                    if (e.key === 'Enter' && searchTerm.trim()) {
                      onAddQuickItem(searchTerm.trim(), '其他');
                      setSearchTerm('');
                    }
                  }}
                />
              </div>



              {/* 物品卡片網格 */}
              <div className="grid grid-cols-2 gap-3">
                {filteredItems.map(name => (
                  <button
                    key={name}
                    onClick={() => onAddQuickItem(name, '其他')}
                    className="p-4 bg-white/90 border border-white/60 shadow-[0_2px_8px_rgba(0,0,0,0.02)] rounded-full text-left hover:border-[#007AFF]/30 hover:shadow-[0_2px_10px_rgba(0,0,0,0.03)] active:scale-95 transition-all group overflow-hidden"
                  >
                    <span className="block text-[15px] font-black text-slate-700 group-hover:text-[#007AFF] truncate">{name}</span>
                    <span className="text-[10px] font-bold text-slate-400 mt-1 block tracking-widest">從歷史庫存記錄</span>
                  </button>
                ))}

                {filteredItems.length === 0 && searchTerm.trim() && (
                  <button
                    onClick={() => {
                      onAddQuickItem(searchTerm.trim(), '其他');
                      setSearchTerm('');
                    }}
                    className="col-span-2 p-4 bg-blue-50/80 border border-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-full text-center active:scale-95 transition-all hover:bg-blue-100 overflow-hidden"
                  >
                    <span className="block text-[15px] font-black text-[#007AFF]">新增「{searchTerm}」</span>
                    <span className="text-[10px] font-bold text-blue-400 mt-1 block tracking-widest">點擊手動加入清單</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShoppingListView;