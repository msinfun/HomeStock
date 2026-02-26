import React, { useState, useRef, useMemo, useEffect } from 'react';
import { InventoryItem, ShoppingItem, AppSettings } from '../types';
import ConfirmationModal from './ConfirmationModal';

interface InventoryListProps {
  items: InventoryItem[];
  shoppingList: ShoppingItem[];
  onUpdate: (item: InventoryItem) => void;
  onScrap: (item: InventoryItem) => void;
  onDelete: (id: string) => void;
  onEdit: (item: InventoryItem) => void;
  onDuplicate: (item: InventoryItem) => void;
  categories: string[];
  onAddToShopping: (name: string, category: string) => void;
  settings: AppSettings;
}

interface QuickAdjust {
  item: InventoryItem;
  mode: 'add' | 'subtract';
}

interface BatchEditState {
  type: 'category' | 'location' | null;
}

const InventoryItemCard: React.FC<{
  item: InventoryItem;
  isExpanded: boolean;
  selectedIds: Set<string>;
  isBatchMode: boolean;
  viewMode: 'inventory' | 'review';
  shoppingList: ShoppingItem[];
  settings: AppSettings;
  onToggleExpansion: (id: string) => void;
  onToggleSelection: (id: string) => void;
  onEdit: (item: InventoryItem) => void;
  onDuplicate: (item: InventoryItem) => void;
  onScrapRequest: (item: InventoryItem) => void;
  onDeleteRequest: (id: string) => void;
  onAddToShopping: (name: string, category: string) => void;
  onUpdate: (item: InventoryItem) => void;
  onConsumeRequest: (item: InventoryItem) => void;
  isActiveSwipe?: boolean;
  onSwipeStart?: () => void;
}> = ({ item, isExpanded, selectedIds, isBatchMode, viewMode, shoppingList, settings, onToggleExpansion, onToggleSelection, onEdit, onDuplicate, onScrapRequest, onDeleteRequest, onAddToShopping, onUpdate, onConsumeRequest, isActiveSwipe, onSwipeStart }) => {
  const [offsetX, setOffsetX] = useState(0);
  const [swipedOpen, setSwipedOpen] = useState(false);
  const startX = useRef(0);
  const threshold = 70;

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

  const handleOpenItem = (e: React.MouseEvent, item: InventoryItem) => {
    e.stopPropagation();
    const today = new Date().toISOString().split('T')[0];
    onUpdate({ ...item, openedDate: today });
  };

  const getExpiryBadge = (expiryDate?: string) => {
    if (!expiryDate) return null;
    const today = new Date().setHours(0, 0, 0, 0);
    const expiry = new Date(expiryDate).getTime();
    const diff = expiry - today;
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    const thresholdDays = settings.expiryThresholdDays;

    let text = "";
    let badgeClass = "bg-slate-100 text-slate-500";

    if (days < 0) { text = `已過期 ${Math.abs(days)} 天`; badgeClass = "bg-rose-50 text-[#FF3B30]"; }
    else if (days <= 3) { text = `剩 ${days} 天`; badgeClass = "bg-rose-50 text-[#FF3B30]"; }
    else if (days <= 7) { text = `剩 ${days} 天`; badgeClass = "bg-orange-50 text-[#FF9500]"; }
    else if (days <= thresholdDays) { text = `剩 ${days} 天`; badgeClass = "bg-amber-50 text-amber-600"; }
    else if (days < 30) { text = `剩 ${Math.floor(days / 7)} 週`; badgeClass = "bg-emerald-50 text-[#34C759]"; }
    else if (days < 365) { text = `剩 ${Math.floor(days / 30)} 個月`; badgeClass = "bg-slate-100 text-slate-500"; }
    else { text = `剩 ${Math.floor(days / 365)} 年`; badgeClass = "bg-slate-100 text-slate-500"; }

    return (
      <span className={`text-[10px] px-2.5 py-1 rounded-full font-black tracking-widest whitespace-nowrap ${badgeClass}`}>
        {text}
      </span>
    );
  };

  const isInShoppingList = shoppingList.some(s => s.name.trim().toLowerCase() === item.name.trim().toLowerCase());

  if (viewMode === 'review') {
    return (
      <div
        onClick={(e) => { e.stopPropagation(); onEdit(item); }}
        className="transition-all duration-300 relative z-10 cursor-pointer hover:bg-white/30 p-5 h-full"
      >
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-[17px] font-black tracking-tight text-slate-800">{item.name}</h3>
          <span className="text-[10px] bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full font-black tracking-widest whitespace-nowrap">
            {item.subCategory || item.category}
          </span>
        </div>
        {item.review ? (
          <p className="text-sm font-bold text-slate-600 leading-relaxed whitespace-pre-wrap">{item.review}</p>
        ) : (
          <p className="text-sm font-bold text-slate-400 italic">暫無心得，點擊編輯新增...</p>
        )}
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden group rounded-[32px]">
      {!isBatchMode && (
        <div
          className={`absolute inset-0 bg-[#FF3B30] flex justify-end items-center px-6 z-0 rounded-[32px] transition-opacity duration-300 ${offsetX === 0 ? 'opacity-0' : 'opacity-100'}`}
          onClick={(e) => {
            e.stopPropagation();
            onDeleteRequest(item.id);
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
        className={`transition-all duration-300 relative z-10 cursor-pointer select-none ${(selectedIds.has(item.id) || isExpanded) ? 'bg-white/50' : 'hover:bg-white/30'} p-5 h-full`}
        style={{ transform: `translateX(${offsetX}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => {
          if (offsetX !== 0) return;
          isBatchMode ? onToggleSelection(item.id) : onToggleExpansion(item.id);
        }}
      >
        {isBatchMode && (
          <div className="absolute top-5 left-4 z-10">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${selectedIds.has(item.id) ? 'bg-[#007AFF] shadow-md shadow-blue-500/20' : 'bg-white border border-slate-300'}`}>
              {selectedIds.has(item.id) && (
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              )}
            </div>
          </div>
        )}

        <div className={`flex justify-between items-start ${isBatchMode ? 'pl-8' : ''}`}>
          <div className="flex-1 min-w-0 pr-3">
            <div className="flex items-start justify-between">
              <h3 className={`text-[17px] font-black tracking-tight text-slate-800 leading-tight break-all ${item.quantity === 0 ? 'line-through decoration-slate-300 text-slate-400' : ''}`}>
                {item.name}
              </h3>
              {!isBatchMode && (
                <div className={`text-slate-400 ml-2 mt-0.5 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                </div>
              )}
            </div>

            <div className="flex items-center flex-wrap gap-2 mt-2.5">
              <span className="text-[10px] bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full font-black whitespace-nowrap tracking-widest">
                {item.category}
                {item.subCategory ? ` · ${item.subCategory}` : ''}
              </span>

              {item.location && (
                <span className="text-[10px] bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full font-black whitespace-nowrap tracking-widest">
                  {item.location}
                </span>
              )}

              {item.packageSize && (
                <span className="text-[10px] bg-blue-50 text-[#007AFF] px-2.5 py-1 rounded-full font-black whitespace-nowrap tracking-widest">
                  {item.packageSize}
                </span>
              )}

              {/* 🍎 單價移至此處，與容量相同風格 */}
              {(item.price ?? 0) > 0 && (
                <span className="text-[10px] bg-blue-50 text-[#007AFF] px-2.5 py-1 rounded-full font-black whitespace-nowrap tracking-widest">
                  ${item.price}
                </span>
              )}

              {getExpiryBadge(item.expiryDate)}

              {item.quantity === 0 && (
                <span className="text-[10px] font-black tracking-widest bg-slate-200 text-slate-500 px-2.5 py-1 rounded-full whitespace-nowrap">
                  已用完
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center justify-center shrink-0 ml-1 h-full min-h-[2.5rem]">
            <span className={`min-w-[2rem] text-center font-black tracking-tighter text-2xl text-slate-800 ${item.quantity === 0 ? 'text-rose-500' : ''}`}>
              {item.quantity}
            </span>
          </div>
        </div>

        {isExpanded && (
          <div className="animate-in slide-in-from-top-2 duration-200">
            {/* 🍎 移除「批次庫存」區塊，直接顯示底部詳細資訊 */}
            {(item.expiryDate || item.openedDate || item.remarks || item.lastUsedDate || item.lastPurchasedDate) && (
              <div className={`mt-4 pt-4 mb-1 border-t border-white/40 flex flex-wrap gap-x-5 gap-y-3 text-[11px] font-bold text-slate-500 ${isBatchMode ? 'pl-8' : ''}`}>
                {/* 🍎 單價已移至上方標籤區 */}
                {/* 🍎 效期改為與其他資訊並排，無條件顯示 */}
                {item.expiryDate && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 tracking-wider">效期:</span> {item.expiryDate}
                  </div>
                )}
                {item.openedDate && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 tracking-wider">開封:</span> {item.openedDate}
                  </div>
                )}
                {item.lastUsedDate && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 tracking-wider">使用:</span> {item.lastUsedDate}
                  </div>
                )}
                {item.lastPurchasedDate && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 tracking-wider">購買:</span> {item.lastPurchasedDate}
                  </div>
                )}
                {item.remarks && (
                  <div className="w-full flex items-center gap-1.5 text-slate-500">
                    <span className="text-slate-400 tracking-wider">備註:</span> {item.remarks}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!isBatchMode && (
          <div className={`flex justify-between items-center mt-4 pt-3 border-t border-white/40 ${isExpanded ? '' : 'pt-3'}`}>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(item); }}
                className="p-2.5 text-slate-400 hover:text-[#007AFF] hover:bg-white transition-all rounded-full"
                title="編輯"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></svg>
              </button>

              <button
                onClick={(e) => { e.stopPropagation(); onDuplicate(item); }}
                className="p-2.5 text-slate-400 hover:text-[#007AFF] hover:bg-white transition-all rounded-full"
                title="複製"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
              </button>

              <button
                title={item.openedDate ? '重新開封' : '開封'}
                onClick={(e) => handleOpenItem(e, item)}
                className={`p-2.5 transition-all rounded-full hover:bg-white ${item.openedDate ? 'text-[#007AFF]' : 'text-slate-400 hover:text-[#007AFF]'}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22v-9" />
                  <path d="m12 13 4-8" />
                  <path d="m12 13-4-8" />
                  <path d="M20 10l-4-5" />
                  <path d="M4 10l4-5" />
                  <path d="M3 10v7.5l9 5.5 9-5.5V10" />
                  <path d="m3 10 9 3 9-3" />
                </svg>
              </button>
            </div>

            <div className="w-px h-5 bg-slate-200/50 mx-2"></div>

            <div className="flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); onConsumeRequest(item); }}
                className="p-2.5 text-rose-500 hover:bg-rose-50 transition-all rounded-full"
                title="消耗"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /></svg>
              </button>

              <button
                disabled={isInShoppingList}
                onClick={(e) => { e.stopPropagation(); if (!isInShoppingList) onAddToShopping(item.name, item.category); }}
                className={`p-2.5 transition-all rounded-full ${isInShoppingList ? 'text-slate-300 cursor-default' : 'text-[#007AFF] hover:bg-blue-50'}`}
                title={isInShoppingList ? "已在清單" : "加入待買"}
              >
                {isInShoppingList ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></svg>
                )}
              </button>

              {item.quantity > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onScrapRequest(item); }}
                  className="p-2.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-all rounded-full"
                  title="報廢"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></svg>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const InventoryList: React.FC<InventoryListProps> = (props) => {
  const getInitialState = () => {
    try {
      const saved = localStorage.getItem('homestock_inventory_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          search: parsed.search || '',
          filters: {
            categories: new Set((parsed.filters?.categories || []) as string[]),
            subCategories: new Set((parsed.filters?.subCategories || []) as string[])
          },
          hideOutOfStock: parsed.hideOutOfStock ?? true,
          sortOrder: parsed.sortOrder || 'default'
        };
      }
    } catch (e) { console.error('Failed to load inventory state', e); }
    return null;
  };
  const savedState = getInitialState();

  const [search, setSearch] = useState(savedState?.search || '');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filters, setFilters] = useState<{ categories: Set<string>; subCategories: Set<string> }>(
    savedState?.filters || { categories: new Set(), subCategories: new Set() }
  );

  const [expandedFilterCategory, setExpandedFilterCategory] = useState<string | null>(null);

  const [hideOutOfStock, setHideOutOfStock] = useState<boolean>(savedState?.hideOutOfStock ?? true);
  const [sortOrder, setSortOrder] = useState<'default' | 'name' | 'expiry'>(savedState?.sortOrder as any || 'default');

  useEffect(() => {
    const stateToSave = {
      search,
      filters: {
        categories: Array.from(filters.categories),
        subCategories: Array.from(filters.subCategories)
      },
      hideOutOfStock,
      sortOrder
    };
    localStorage.setItem('homestock_inventory_state', JSON.stringify(stateToSave));
  }, [search, filters, hideOutOfStock, sortOrder]);

  const [viewMode, setViewMode] = useState<'inventory' | 'review'>(() => {
    try {
      const saved = localStorage.getItem('homestock_view_mode');
      return saved === 'review' ? 'review' : 'inventory';
    } catch { return 'inventory'; }
  });

  useEffect(() => {
    localStorage.setItem('homestock_view_mode', viewMode);
  }, [viewMode]);

  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set());
  const [activeSwipeId, setActiveSwipeId] = useState<string | null>(null);
  const [quickAdjust, setQuickAdjust] = useState<QuickAdjust | null>(null);
  const [customDelta, setCustomDelta] = useState<string>('');

  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchEditModal, setBatchEditModal] = useState<BatchEditState>({ type: null });
  const [batchTargetValue, setBatchTargetValue] = useState('');
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);

  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => { },
  });

  const toggleItemExpansion = (id: string) => {
    setExpandedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const availableStructure = useMemo(() => {
    const map = new Map<string, Set<string>>();
    props.categories.forEach(c => map.set(c, new Set()));

    props.items.forEach(item => {
      const cat = item.category;
      if (!map.has(cat)) map.set(cat, new Set());
      if (item.subCategory) {
        map.get(cat)!.add(item.subCategory);
      }
    });
    return map;
  }, [props.items, props.categories]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const subCounts: Record<string, number> = {};

    props.categories.forEach(c => counts[c] = 0);

    props.items.forEach(item => {
      counts[item.category] = (counts[item.category] || 0) + 1;
      if (item.subCategory) {
        subCounts[item.subCategory] = (subCounts[item.subCategory] || 0) + 1;
      }
    });
    return { cats: counts, subs: subCounts };
  }, [props.items, props.categories]);

  const filteredItems = props.items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.location.toLowerCase().includes(search.toLowerCase());

    const hasActiveFilters = filters.categories.size > 0 || filters.subCategories.size > 0;

    let matchesFilter = true;
    if (hasActiveFilters) {
      const catMatch = filters.categories.has(item.category);
      const subMatch = item.subCategory ? filters.subCategories.has(item.subCategory) : false;
      matchesFilter = catMatch || subMatch;
    }

    const matchesStockStatus = (search.trim() !== '' || !hideOutOfStock || item.quantity > 0);

    return matchesSearch && matchesStockStatus && matchesFilter;
  });

  const sortedItems = [...filteredItems].sort((a, b) => {
    if (sortOrder === 'name') return a.name.localeCompare(b.name);
    if (sortOrder === 'expiry') {
      if (!a.expiryDate) return 1;
      if (!b.expiryDate) return -1;
      return a.expiryDate.localeCompare(b.expiryDate);
    }
    return 0;
  });

  const toggleFilterCategory = (cat: string) => {
    const newCats = new Set(filters.categories);
    if (newCats.has(cat)) newCats.delete(cat);
    else newCats.add(cat);
    setFilters(prev => ({ ...prev, categories: newCats }));
  };

  const toggleFilterSubCategory = (sub: string) => {
    const newSubs = new Set(filters.subCategories);
    if (newSubs.has(sub)) newSubs.delete(sub);
    else newSubs.add(sub);
    setFilters(prev => ({ ...prev, subCategories: newSubs }));
  };

  const clearFilters = () => {
    setFilters({ categories: new Set(), subCategories: new Set() });
  };

  const activeFilterCount = filters.categories.size + filters.subCategories.size;

  const pinnedCategoryReviews = useMemo(() => {
    const trimmedSearch = search.trim();
    if (!trimmedSearch) return null;

    const allSubCategories = new Set(props.items.map(i => i.subCategory).filter(Boolean) as string[]);

    const matchedSubCat = Array.from(allSubCategories).find(
      sub => sub.toLowerCase() === trimmedSearch.toLowerCase()
    );

    if (!matchedSubCat) return null;

    const reviews = props.items
      .filter(i => i.subCategory === matchedSubCat && i.review && i.review.trim() !== '')
      .map(i => ({ name: i.name, review: i.review! }));

    const uniqueReviews = new Map<string, string>();
    reviews.forEach(r => uniqueReviews.set(r.name, r.review));

    if (uniqueReviews.size === 0) return null;

    return {
      categoryName: matchedSubCat,
      reviews: Array.from(uniqueReviews.entries()).map(([name, review]) => ({ name, review }))
    };
  }, [search, props.items]);

  // 🍎 簡化版的調整數量邏輯：直達指令
  const handleAdjustQuantity = (item: InventoryItem, delta: number) => {
    const newTotalQty = Math.max(0, item.quantity + delta);
    const updates: any = { quantity: newTotalQty };
    if (delta < 0) updates.lastUsedDate = new Date().toISOString().split('T')[0];
    props.onUpdate({ ...item, ...updates });
  };

  const handleApplyQuickAdjust = () => {
    if (!quickAdjust) return;
    const deltaVal = parseInt(customDelta);
    if (!isNaN(deltaVal) && deltaVal > 0) {
      const actualDelta = quickAdjust.mode === 'add' ? deltaVal : -deltaVal;
      handleAdjustQuantity(quickAdjust.item, actualDelta);
    }
    setQuickAdjust(null);
    setCustomDelta('');
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchUpdate = () => {
    if (!batchEditModal.type || !batchTargetValue) return;

    selectedIds.forEach(id => {
      const item = props.items.find(i => i.id === id);
      if (item) {
        props.onUpdate({ ...item, [batchEditModal.type!]: batchTargetValue });
      }
    });

    setBatchEditModal({ type: null });
    setBatchTargetValue('');
    setSelectedIds(new Set());
    setIsBatchMode(false);
  };

  const cancelBatchMode = () => {
    setIsBatchMode(false);
    setSelectedIds(new Set());
  };

  const requestConsume = (item: InventoryItem) => {
    setConfirmConfig({
      isOpen: true,
      title: '確認消耗',
      message: `確定要消耗 1 個「${item.name}」嗎？`,
      onConfirm: () => {
        handleAdjustQuantity(item, -1);
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const requestScrap = (item: InventoryItem) => {
    setConfirmConfig({
      isOpen: true,
      title: '確認報廢',
      message: `確定要報廢這張「${item.name}」的卡片嗎？這將會把數量歸零並記錄為浪費。`,
      onConfirm: () => {
        props.onScrap(item);
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  return (
    <div className="-mt-6 space-y-0 pb-24">
      <div className="sticky top-0 bg-white/60 backdrop-blur-[40px] backdrop-saturate-150 z-30 border-b border-white/40 shadow-[0_4px_20px_rgba(0,0,0,0.02)] -mx-4 px-4 h-16 flex items-center gap-3">

        <div className="relative flex-1 h-11 group">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 pointer-events-none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          <input
            type="text"
            placeholder="搜尋物品..."
            className="w-full h-full pl-11 pr-4 bg-white/90 border border-white/60 rounded-full text-[17px] font-bold text-slate-800 shadow-[0_2px_10px_rgba(0,0,0,0.03)] focus:ring-2 focus:ring-[#007AFF]/20 focus:border-[#007AFF] outline-none transition-all placeholder:font-normal placeholder:text-slate-400"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <button
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full transition-all active:scale-95 ${isFilterOpen || activeFilterCount > 0
              ? 'bg-[#007AFF] text-white shadow-[0_4px_12px_rgba(0,122,255,0.2)]'
              : 'bg-transparent text-slate-400 hover:bg-slate-100'
              }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
            {activeFilterCount > 0 && !isFilterOpen && (
              <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-[#FF3B30] rounded-full border-2 border-white"></span>
            )}
          </button>

          {isFilterOpen && (
            <>
              <div className="fixed inset-0 z-40 bg-transparent" onClick={() => setIsFilterOpen(false)} />
              <div className="absolute top-full left-0 right-0 w-full mt-3 bg-white/80 backdrop-blur-[40px] backdrop-saturate-150 shadow-[0_24px_48px_rgba(0,0,0,0.1),inset_0_2px_2px_rgba(255,255,255,1)] rounded-[32px] z-[100] border border-white/40 animate-in slide-in-from-top-2 duration-200 flex flex-col max-h-[60vh] overflow-hidden">
                <div className="flex justify-between items-center p-5 border-b border-white/40 shrink-0 bg-white/50">
                  <h3 className="font-black tracking-tighter text-slate-900 text-base flex items-center gap-2">
                    篩選條件
                  </h3>
                  {activeFilterCount > 0 && (
                    <button onClick={clearFilters} className="text-xs text-rose-500 font-black hover:text-rose-600 bg-rose-50 px-3 py-1.5 rounded-full active:scale-95 transition-all">
                      清除 ({activeFilterCount})
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar overscroll-contain">
                  {Array.from(availableStructure.keys()).map((cat: string) => {
                    const subCats = Array.from(availableStructure.get(cat) || []) as string[];
                    const hasSubCats = subCats.length > 0;
                    const isExpanded = expandedFilterCategory === cat;
                    const isSelected = filters.categories.has(cat);

                    return (
                      <div key={cat} className="rounded-[20px] overflow-hidden">
                        <div className={`flex items-center p-3 rounded-[20px] hover:bg-white/50 transition-all cursor-pointer ${isSelected ? 'bg-blue-50/50' : ''}`}>
                          <div
                            className="flex items-center justify-center w-6 h-6 mr-3 active:scale-90 transition-transform"
                            onClick={(e) => { e.stopPropagation(); toggleFilterCategory(cat); }}
                          >
                            <div className={`w-5 h-5 border-[1.5px] rounded-full flex items-center justify-center transition-colors ${isSelected ? 'bg-[#007AFF] border-[#007AFF] shadow-sm shadow-blue-500/20' : 'border-slate-300 bg-white'}`}>
                              {isSelected && <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                            </div>
                          </div>
                          <span
                            className="flex-1 text-[15px] font-black tracking-wide text-slate-800 flex items-center"
                            onClick={() => setExpandedFilterCategory(isExpanded ? null : cat)}
                          >
                            {cat}
                            <span className="text-xs text-slate-400 font-bold ml-2">({categoryCounts.cats[cat] || 0})</span>
                          </span>
                          {hasSubCats && (
                            <button
                              onClick={() => setExpandedFilterCategory(isExpanded ? null : cat)}
                              className={`p-1.5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                            </button>
                          )}
                        </div>

                        {isExpanded && hasSubCats && (
                          <div className="ml-10 pl-3 border-l-2 border-white/60 space-y-1.5 py-2 animate-in slide-in-from-top-1">
                            {subCats.map((sub: string) => {
                              const isSubSelected = filters.subCategories.has(sub);
                              return (
                                <div key={sub} className="flex items-center p-2 hover:bg-white/50 rounded-2xl cursor-pointer transition-all" onClick={() => toggleFilterSubCategory(sub)}>
                                  <div className={`w-4 h-4 border-[1.5px] rounded-full flex items-center justify-center mr-3 transition-colors ${isSubSelected ? 'bg-[#007AFF] border-[#007AFF] shadow-sm' : 'border-slate-300 bg-white'}`}>
                                    {isSubSelected && <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                                  </div>
                                  <span className={`text-[13px] font-black tracking-wide ${isSubSelected ? 'text-[#007AFF]' : 'text-slate-500'}`}>
                                    {sub} <span className="text-slate-400 font-bold ml-1">({categoryCounts.subs[sub] || 0})</span>
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="p-5 bg-white/50 border-t border-white/40 shrink-0 sticky bottom-0 backdrop-blur-md">
                  <button
                    onClick={() => setIsFilterOpen(false)}
                    className="w-full py-4 bg-[#007AFF] text-white font-black tracking-widest rounded-full text-sm shadow-[0_4px_12px_rgba(0,122,255,0.2)] hover:bg-blue-600 active:scale-[0.96] transition-all"
                  >
                    套用
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <button
          onClick={() => setIsBatchMode(!isBatchMode)}
          className={`h-11 w-11 flex items-center justify-center rounded-full transition-all active:scale-95 shrink-0 border ${isBatchMode
            ? 'bg-[#007AFF] text-white border-[#007AFF] shadow-[0_4px_12px_rgba(0,122,255,0.2)]'
            : 'bg-white/80 border-white/60 text-[#007AFF] hover:bg-white shadow-[0_2px_8px_rgba(0,0,0,0.03)]'
            }`}
          title="批次修改"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 11 3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
        </button>

        <button
          onClick={() => setIsFilterMenuOpen(true)}
          className={`h-11 w-11 flex items-center justify-center rounded-full transition-all active:scale-95 shrink-0 border ${(!hideOutOfStock || sortOrder !== 'default' || viewMode === 'review')
            ? 'bg-[#007AFF] text-white border-[#007AFF] shadow-[0_4px_12px_rgba(0,122,255,0.2)]'
            : 'bg-white/80 border-white/60 text-[#007AFF] hover:bg-white shadow-[0_2px_8px_rgba(0,0,0,0.03)]'
            }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="21" y2="21" /><line x1="4" x2="20" y1="3" y2="3" /><line x1="4" x2="20" y1="12" y2="12" /><circle cx="14" cy="3" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="16" cy="21" r="2" /></svg>
        </button>
      </div>

      {pinnedCategoryReviews && (
        <div className="bg-gradient-to-br from-white/80 to-white/40 backdrop-blur-[40px] backdrop-saturate-150 border border-white/40 rounded-[32px] p-6 shadow-[0_24px_48px_rgba(0,0,0,0.06),0_8px_16px_rgba(0,0,0,0.03),inset_0_2px_2px_rgba(255,255,255,1),inset_2px_0_4px_rgba(255,255,255,0.5),inset_0_-1px_1px_rgba(255,255,255,0.2)] animate-in slide-in-from-top duration-300 relative overflow-hidden mt-4 mb-6">
          <div className="absolute right-0 top-0 opacity-5 p-2 pointer-events-none">
            <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-4.5a1 1 0 0 1-2 0V7a1 1 0 0 1 2 0z" /></svg>
          </div>
          <div className="relative z-10">
            <h3 className="text-sm font-black tracking-widest text-[#007AFF] flex items-center gap-2 mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" /></svg>
              {pinnedCategoryReviews.categoryName} - 心得精選
            </h3>
            <div className="space-y-3 max-h-56 overflow-y-auto pr-2 custom-scrollbar">
              {pinnedCategoryReviews.reviews.map((item, idx) => (
                <div key={idx} className="bg-white/90 p-4 rounded-[24px] border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
                  <span className="block font-black tracking-tight text-[#007AFF] text-[15px] mb-1.5">{item.name}</span>
                  <p className="text-slate-600 font-bold text-sm leading-relaxed">{item.review}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="h-4 w-full shrink-0"></div>
      <div className="pb-20">
        {sortedItems.length === 0 ? (
          <div className="text-center py-20 text-slate-500 bg-white/50 backdrop-blur-xl rounded-[32px] border border-white/40 shadow-inner">
            <p className="font-black text-lg tracking-tighter text-slate-700">沒有符合條件的物品</p>
            <p className="text-sm font-bold mt-1">請嘗試搜尋關鍵字或調整篩選</p>
          </div>
        ) : (
          sortedItems.map(item => (
            <div key={item.id} className="mb-4 rounded-[32px] border border-white/40 shadow-[0_12px_32px_rgba(0,0,0,0.05),inset_0_2px_2px_rgba(255,255,255,1),inset_0_-1px_1px_rgba(255,255,255,0.2)] overflow-hidden bg-gradient-to-br from-white/95 to-white/40 backdrop-blur-[40px] backdrop-saturate-150">
              <InventoryItemCard
                item={item}
                isExpanded={expandedItemIds.has(item.id)}
                selectedIds={selectedIds}
                isBatchMode={isBatchMode}
                viewMode={viewMode}
                shoppingList={props.shoppingList}
                settings={props.settings}
                onToggleExpansion={toggleItemExpansion}
                onToggleSelection={toggleSelection}
                onEdit={props.onEdit}
                onDuplicate={props.onDuplicate}
                onScrapRequest={requestScrap}
                onDeleteRequest={props.onDelete}
                onAddToShopping={props.onAddToShopping}
                onUpdate={props.onUpdate}
                onConsumeRequest={requestConsume}
                isActiveSwipe={activeSwipeId === item.id}
                onSwipeStart={() => setActiveSwipeId(item.id)}
              />
            </div>
          ))
        )}
      </div>

      {quickAdjust && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-200" onClick={() => setQuickAdjust(null)}>
          <div className="bg-white/80 backdrop-blur-[40px] backdrop-saturate-150 rounded-[32px] border border-white/40 shadow-[0_24px_48px_rgba(0,0,0,0.1),inset_0_2px_2px_rgba(255,255,255,1)] w-full max-w-sm p-8 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <h3 className="font-black tracking-tighter text-xl text-slate-900 mb-2 text-center">
              {quickAdjust.mode === 'add' ? '快速入庫' : '快速消耗'}
            </h3>
            <p className="text-sm font-bold text-slate-500 mb-5 text-center">
              請輸入 {quickAdjust.item.name} 的{quickAdjust.mode === 'add' ? '增加' : '減少'}數量
            </p>
            <input
              autoFocus
              type="number"
              className="w-full px-5 py-4 rounded-full border-none bg-white shadow-[inset_0_2px_8px_rgba(0,0,0,0.03)] text-[17px] font-bold text-center outline-none focus:ring-2 focus:ring-[#007AFF]/20 transition-all mb-6"
              value={customDelta}
              onChange={e => setCustomDelta(e.target.value)}
              placeholder="數量"
            />
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setQuickAdjust(null)} className="py-3.5 rounded-full font-black text-slate-500 bg-slate-100 hover:bg-slate-200 active:scale-[0.96] transition-all text-sm">取消</button>
              <button onClick={handleApplyQuickAdjust} className="py-3.5 rounded-full font-black text-white bg-[#007AFF] shadow-[0_4px_12px_rgba(0,122,255,0.2)] hover:bg-blue-600 active:scale-[0.96] transition-all text-sm">確認</button>
            </div>
          </div>
        </div>
      )}

      {isBatchMode && (
        <div className="fixed bottom-[100px] left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white/80 backdrop-blur-[40px] backdrop-saturate-150 border border-white/40 px-4 py-2.5 rounded-full shadow-[0_16px_40px_rgba(0,0,0,0.1),inset_0_1px_1px_rgba(255,255,255,1)] z-[60] animate-in slide-in-from-bottom-5">
          <span className="text-sm font-black text-[#007AFF] tracking-widest mr-2 whitespace-nowrap shrink-0">{selectedIds.size} 已選</span>
          <button onClick={() => setBatchEditModal({ type: 'category' })} className="px-4 py-2 bg-white/90 hover:bg-white text-slate-700 rounded-full text-xs font-black transition-colors active:scale-95 whitespace-nowrap shrink-0 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">分類</button>
          <button onClick={() => setBatchEditModal({ type: 'location' })} className="px-4 py-2 bg-white/90 hover:bg-white text-slate-700 rounded-full text-xs font-black transition-colors active:scale-95 whitespace-nowrap shrink-0 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">位置</button>
          <div className="w-px h-5 bg-slate-300 mx-1"></div>
          <button onClick={cancelBatchMode} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50/50 rounded-full transition-colors active:scale-95">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>
      )}

      {batchEditModal.type && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-200" onClick={() => setBatchEditModal({ type: null })}>
          <div className="bg-white/80 backdrop-blur-[40px] backdrop-saturate-150 rounded-[32px] border border-white/40 shadow-[0_24px_48px_rgba(0,0,0,0.1),inset_0_2px_2px_rgba(255,255,255,1)] w-full max-w-sm p-8 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <h3 className="font-black tracking-tighter text-xl text-slate-900 mb-6 text-center whitespace-nowrap">
              批次修改{batchEditModal.type === 'category' ? '分類' : '位置'}
            </h3>
            <input
              autoFocus
              type="text"
              className="w-full px-5 py-4 rounded-full border-none bg-white shadow-[inset_0_2px_8px_rgba(0,0,0,0.03)] text-[17px] font-bold text-center outline-none focus:ring-2 focus:ring-[#007AFF]/20 transition-all mb-6"
              value={batchTargetValue}
              onChange={e => setBatchTargetValue(e.target.value)}
              placeholder={`輸入新的...`}
            />
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setBatchEditModal({ type: null })} className="py-3.5 rounded-full font-black text-slate-500 bg-slate-100 hover:bg-slate-200 active:scale-[0.96] transition-all text-sm">取消</button>
              <button onClick={handleBatchUpdate} className="py-3.5 rounded-full font-black text-white bg-[#007AFF] shadow-[0_4px_12px_rgba(0,122,255,0.2)] hover:bg-blue-600 active:scale-[0.96] transition-all text-sm">確認</button>
            </div>
          </div>
        </div>
      )}

      {isFilterMenuOpen && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-200" onClick={() => setIsFilterMenuOpen(false)}>
          <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 w-full sm:max-w-sm rounded-[32px] mb-28 sm:mb-0 shadow-[0_24px_48px_rgba(0,0,0,0.1),inset_0_2px_2px_rgba(255,255,255,1)] border border-white/40 animate-in slide-in-from-bottom duration-200 flex flex-col max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6 border-b border-white/40 shrink-0 bg-white/50">
              <h3 className="text-xl font-black tracking-tighter text-slate-900">檢視設定</h3>
              <button onClick={() => setIsFilterMenuOpen(false)} className="p-2.5 bg-white/90 border border-white shadow-sm rounded-full text-slate-500 hover:bg-white active:scale-95 transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-8 overflow-y-auto custom-scrollbar">
              <div className="space-y-4">
                <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest pl-1">排序方式</p>
                <div className="grid grid-cols-1 gap-3">
                  {[
                    { id: 'default', label: '預設 (最後異動)', icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20" /><path d="m17 17-5 5-5-5" /><path d="m17 7-5-5-5 5" /></svg> },
                    { id: 'name', label: '名稱 (A-Z)', icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m3 16 4 4 4-4" /><path d="M7 20V4" /><path d="M11 4h4" /><path d="M11 8h7" /><path d="M11 12h10" /></svg> },
                    { id: 'expiry', label: '效期 (最近優先)', icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2" /><line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" /><line x1="3" x2="21" y1="10" y2="10" /><path d="m9 16 2 2 4-4" /></svg> }
                  ].map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setSortOrder(opt.id as any)}
                      className={`flex items-center justify-between px-5 py-4 rounded-[24px] border-none transition-all active:scale-[0.98] ${sortOrder === opt.id ? 'bg-blue-50/80 text-[#007AFF] shadow-sm' : 'bg-white shadow-[0_2px_8px_rgba(0,0,0,0.03)] text-slate-600 hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center gap-3">
                        {opt.icon}
                        <span className="text-[15px] font-black tracking-wide">{opt.label}</span>
                      </div>
                      {sortOrder === opt.id && <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest pl-1">顯示設定</p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between bg-white px-5 py-4 rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                    <div className="flex items-center gap-3 text-slate-800">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><path d="M3 9h18" /><path d="M9 21V9" /></svg>
                      <span className="text-[15px] font-black tracking-wide">開啟心得模式</span>
                    </div>
                    <button
                      onClick={() => setViewMode(viewMode === 'review' ? 'inventory' : 'review')}
                      className={`w-14 h-8 rounded-full transition-colors duration-300 focus:outline-none flex items-center px-1 shadow-inner ${viewMode === 'review' ? 'bg-[#34C759]' : 'bg-slate-200'}`}
                    >
                      <div className={`w-6 h-6 bg-white rounded-full shadow-md transform transition-transform duration-300 ${viewMode === 'review' ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between bg-white px-5 py-4 rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                    <div className="flex items-center gap-3 text-slate-800">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></svg>
                      <span className="text-[15px] font-black tracking-wide">隱藏零庫存</span>
                    </div>
                    <button
                      onClick={() => setHideOutOfStock(!hideOutOfStock)}
                      className={`w-14 h-8 rounded-full transition-colors duration-300 focus:outline-none flex items-center px-1 shadow-inner ${hideOutOfStock ? 'bg-[#34C759]' : 'bg-slate-200'}`}
                    >
                      <div className={`w-6 h-6 bg-white rounded-full shadow-md transform transition-transform duration-300 ${hideOutOfStock ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="p-6 pt-0 shrink-0 mt-2">
              <button
                onClick={() => setIsFilterMenuOpen(false)}
                className="w-full py-4 rounded-full font-black text-white bg-[#007AFF] shadow-[0_4px_12px_rgba(0,122,255,0.2)] hover:bg-blue-600 active:scale-[0.96] transition-all text-sm tracking-widest"
              >
                確定
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

export default InventoryList;