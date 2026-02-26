import React, { useState, useEffect, useMemo } from 'react';
import { InventoryItem, ShoppingItem, ViewState, AppSettings, InventoryDef, InventoryTransaction, InventoryBatch, Recipe, SystemBackup, RecipeTagStructure } from './types';
import Dashboard from './components/Dashboard';
import InventoryList from './components/InventoryList';
import ShoppingListView from './components/ShoppingListView';
import AddItemView from './components/AddItemView';
import SettingsView from './components/SettingsView';
import AnalysisView from './components/AnalysisView';
import RecipeView from './components/RecipeView';
import AddRecipeView from './components/AddRecipeView';
import Navbar from './components/Navbar';
import ConfirmationModal from './components/ConfirmationModal';

const DEFAULT_CATEGORIES = ['食品', '雜貨', '藥品', '盥洗用品', '電子產品', '其他'];
const DEFAULT_LOCATIONS = ['冷凍室', '冷藏室', '微凍結', '廚房櫥櫃', '備品櫥櫃', '側邊櫃'];
const DEFAULT_SETTINGS: AppSettings = { expiryThresholdDays: 7 };

const DEFAULT_RECIPE_TAGS: RecipeTagStructure = {
  "料理方式": ["煎", "煮", "炒", "炸", "蒸", "烤", "燉", "涼拌"],
  "主食材": ["雞肉", "豬肉", "牛肉", "魚/海鮮", "蔬菜", "蛋/豆腐", "澱粉"],
  "風味": ["中式", "西式", "日式", "泰式", "清淡", "重口味", "素食"],
  "情境": ["快速料理", "便當菜", "宴客菜", "下酒菜", "減脂"]
};

const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
const normalizeForMatch = (str: string) => str.replace(/[()\[\]\s]/g, '').toLowerCase();

// 🍎 虛擬身分證解析器：分離原始身分證與批次效期
const parseVirtualId = (virtualId: string) => {
  const parts = virtualId.split('__');
  const defId = parts[0];
  const exp = parts.length > 1 ? parts.slice(1).join('__') : 'empty';
  return { defId, expiryDate: exp === 'empty' ? undefined : (exp === '無效期' ? '無效期' : exp) };
};

const App: React.FC = () => {
  const [defs, setDefs] = useState<InventoryDef[]>(() => {
    try {
      const saved = localStorage.getItem('homestock_defs');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  const [transactions, setTransactions] = useState<InventoryTransaction[]>(() => {
    try {
      const saved = localStorage.getItem('homestock_transactions');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  const [recipes, setRecipes] = useState<Recipe[]>(() => {
    try {
      const saved = localStorage.getItem('homestock_recipes');
      const parsed = saved ? JSON.parse(saved) : [];
      return parsed.map((r: any) => {
        let tags = r.tags || [];
        if (!tags.length) {
          if (r.cuisine) tags.push(r.cuisine);
          if (r.dishType) tags.push(r.dishType);
        }

        const safeIngredients = Array.isArray(r.ingredients)
          ? r.ingredients.map((i: any) => typeof i === 'string' ? i : `${i.name || ''} ${i.quantity || ''}`)
          : [];

        return {
          ...r,
          tags: tags.filter((t: string) => t),
          ingredients: safeIngredients,
          steps: typeof r.steps === 'string' ? r.steps : ''
        };
      });
    } catch (e) { return []; }
  });

  const [shoppingList, setShoppingList] = useState<ShoppingItem[]>(() => {
    try {
      const saved = localStorage.getItem('homestock_shopping');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  const [categories, setCategories] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('homestock_categories');
      return saved ? JSON.parse(saved) : DEFAULT_CATEGORIES;
    } catch (e) { return DEFAULT_CATEGORIES; }
  });

  const [locations, setLocations] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('homestock_locations');
      return saved ? JSON.parse(saved) : DEFAULT_LOCATIONS;
    } catch (e) { return DEFAULT_LOCATIONS; }
  });

  const [recipeTags, setRecipeTags] = useState<RecipeTagStructure>(() => {
    try {
      const saved = localStorage.getItem('homestock_recipe_tags');
      return saved ? JSON.parse(saved) : DEFAULT_RECIPE_TAGS;
    } catch (e) { return DEFAULT_RECIPE_TAGS; }
  });

  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('homestock_settings');
      return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
    } catch (e) { return DEFAULT_SETTINGS; }
  });

  const [activeView, setActiveView] = useState<ViewState>('dashboard');
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [isAddingQuickShopping, setIsAddingQuickShopping] = useState(false);

  const [modalConfig, setModalConfig] = useState<{
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
    onConfirm: () => { },
  });

  useEffect(() => {
    const handleShowAlert = (event: CustomEvent) => {
      setModalConfig({
        isOpen: true,
        title: event.detail.title || '提示',
        message: event.detail.message || '',
        isAlert: true,
        confirmText: '確定',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
      });
    };
    window.addEventListener('show-alert' as any, handleShowAlert);
    return () => window.removeEventListener('show-alert' as any, handleShowAlert);
  }, []);

  useEffect(() => {
    localStorage.setItem('homestock_defs', JSON.stringify(defs));
    localStorage.setItem('homestock_transactions', JSON.stringify(transactions));
    localStorage.setItem('homestock_shopping', JSON.stringify(shoppingList));
    localStorage.setItem('homestock_categories', JSON.stringify(categories));
    localStorage.setItem('homestock_locations', JSON.stringify(locations));
    localStorage.setItem('homestock_settings', JSON.stringify(settings));
    localStorage.setItem('homestock_recipes', JSON.stringify(recipes));
    localStorage.setItem('homestock_recipe_tags', JSON.stringify(recipeTags));
  }, [defs, transactions, shoppingList, categories, locations, settings, recipes, recipeTags]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeView]);

  // 🍎 核心重構：發派「虛擬身分證」，直接將不同批次轉換為獨立卡片
  const items: InventoryItem[] = useMemo(() => {
    const virtualItems: InventoryItem[] = [];

    defs.forEach(def => {
      const itemLogs = transactions.filter(t => t.defId === def.id);
      const batchGroups: Record<string, number> = {};
      itemLogs.forEach(t => {
        const exp = t.expiryDate || '無效期';
        batchGroups[exp] = (batchGroups[exp] || 0) + t.delta;
      });

      const lastUsed = itemLogs.filter(t => t.delta < 0).sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
      const lastPurchased = itemLogs.filter(t => t.delta > 0).sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];

      let hasBatches = false;
      Object.entries(batchGroups).forEach(([exp, qty]) => {
        if (qty > 0) {
          hasBatches = true;
          virtualItems.push({
            id: `${def.id}__${exp}`, // 虛擬身分證
            name: def.name,
            quantity: qty,
            category: def.category,
            subCategory: def.subCategory,
            location: def.defaultLocation,
            openedDate: def.openedDate,
            expiryDate: exp === '無效期' ? undefined : exp,
            minThreshold: def.minThreshold,
            batches: [], // 簡化：不再需要包裹
            review: def.review,
            lastUsedDate: lastUsed?.timestamp.split('T')[0],
            lastPurchasedDate: lastPurchased?.timestamp.split('T')[0],
            packageSize: def.packageSize,
            price: def.price,
            remarks: def.remarks
          });
        }
      });

      // 處理數量為 0 的空卡片
      if (!hasBatches) {
        virtualItems.push({
          id: `${def.id}__empty`,
          name: def.name,
          quantity: 0,
          category: def.category,
          subCategory: def.subCategory,
          location: def.defaultLocation,
          openedDate: def.openedDate,
          expiryDate: undefined,
          minThreshold: def.minThreshold,
          batches: [],
          review: def.review,
          lastUsedDate: lastUsed?.timestamp.split('T')[0],
          lastPurchasedDate: lastPurchased?.timestamp.split('T')[0],
          packageSize: def.packageSize,
          price: def.price,
          remarks: def.remarks
        });
      }
    });
    return virtualItems;
  }, [defs, transactions]);

  const handleAddRecipe = (recipe: Recipe) => {
    if (editingRecipe) {
      setRecipes(prev => prev.map(r => r.id === recipe.id ? recipe : r));
    } else {
      setRecipes(prev => [...prev, { ...recipe, id: generateId() }]);
    }
    setActiveView('recipes');
    setEditingRecipe(null);
  };

  const handleUpdateRecipeDirectly = (updated: Recipe) => {
    setRecipes(prev => prev.map(r => r.id === updated.id ? updated : r));
  };

  const handleDeleteRecipe = (id: string) => {
    setModalConfig({
      isOpen: true,
      title: '刪除食譜',
      message: '確定要刪除這份食譜嗎？此動作無法復原。',
      onConfirm: () => {
        setRecipes(prev => prev.filter(r => r.id !== id));
        setModalConfig(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  // 🍎 升級的刪除邏輯：精準刪除虛擬卡片，不波及無辜
  const handleDeleteInventoryItem = (virtualId: string) => {
    setModalConfig({
      isOpen: true,
      title: '刪除卡片紀錄',
      message: '確定要刪除這張卡片嗎？如果數量大於 0，將會先清空數量；如果數量已為 0，將永久移除此物品。',
      onConfirm: () => {
        const { defId, expiryDate } = parseVirtualId(virtualId);

        const itemLogs = transactions.filter(t => t.defId === defId);
        const currentQty = itemLogs
          .filter(t => (t.expiryDate || '無效期') === (expiryDate || '無效期'))
          .reduce((acc, t) => acc + t.delta, 0);

        if (expiryDate === undefined && virtualId.endsWith('__empty')) {
          setDefs(prev => prev.filter(d => d.id !== defId));
          setTransactions(prev => prev.filter(t => t.defId !== defId));
        } else if (currentQty > 0) {
          setTransactions(prev => [...prev, {
            id: generateId(),
            defId: defId,
            type: 'adjust',
            delta: -currentQty,
            timestamp: new Date().toISOString(),
            expiryDate: expiryDate === '無效期' ? undefined : expiryDate
          }]);
        } else {
          setDefs(prev => prev.filter(d => d.id !== defId));
          setTransactions(prev => prev.filter(t => t.defId !== defId));
        }
        setModalConfig(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleDeleteShoppingItem = (id: string) => {
    setModalConfig({
      isOpen: true,
      title: '移除待買項目',
      message: '確定要從清單中移除此項目嗎？',
      onConfirm: () => {
        setShoppingList(prev => prev.filter(s => s.id !== id));
        setModalConfig(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleClearAllData = () => {
    localStorage.clear();
    window.location.reload();
  };

  const handleExcelImport = (newDefs: InventoryDef[], newTrans: InventoryTransaction[], newRecipes?: Recipe[]) => {
    setDefs(newDefs);
    setTransactions(newTrans);
    if (newRecipes) setRecipes(newRecipes);
  };

  const handleSystemRestore = (backup: SystemBackup, mode: 'merge' | 'overwrite') => {
    const data = backup.data;
    if (mode === 'overwrite') {
      setDefs(data.defs || []);
      setTransactions(data.transactions || []);
      setRecipes(data.recipes || []);
      setShoppingList(data.shoppingList || []);
      setSettings(data.settings || DEFAULT_SETTINGS);
      setCategories(data.categories || DEFAULT_CATEGORIES);
      setLocations(data.locations || DEFAULT_LOCATIONS);
      setRecipeTags(data.recipeTags || DEFAULT_RECIPE_TAGS);
    } else {
      setDefs(prev => {
        const map = new Map(prev.map(i => [i.id, i]));
        data.defs.forEach(i => map.set(i.id, i));
        return Array.from(map.values());
      });
      setTransactions(prev => {
        const map = new Map(prev.map(i => [i.id, i]));
        data.transactions.forEach(i => map.set(i.id, i));
        return Array.from(map.values());
      });
      setRecipes(prev => {
        const map = new Map(prev.map(i => [i.id, i]));
        data.recipes.forEach(i => map.set(i.id, i));
        return Array.from(map.values());
      });
      setShoppingList(prev => {
        const map = new Map(prev.map(i => [i.id, i]));
        data.shoppingList.forEach(i => map.set(i.id, i));
        return Array.from(map.values());
      });
      setCategories(prev => Array.from(new Set([...prev, ...(data.categories || [])])));
      setLocations(prev => Array.from(new Set([...prev, ...(data.locations || [])])));
      setSettings(prev => ({ ...prev, ...data.settings }));
      if (data.recipeTags) {
        setRecipeTags(prev => {
          const next = { ...prev };
          Object.entries(data.recipeTags || {}).forEach(([key, values]) => {
            if (!next[key]) next[key] = [];
            next[key] = Array.from(new Set([...next[key], ...values]));
          });
          return next;
        });
      }
    }
  };

  // 🍎 升級的修改邏輯：直達指令，不繞遠路
  const handleUpdateItem = (updated: InventoryItem, transactionType?: InventoryTransaction['type']) => {
    const timestamp = new Date().toISOString();
    const { defId, expiryDate: oldExpiry } = parseVirtualId(updated.id);

    const currentDef = defs.find(d => d.id === defId);
    if (!currentDef) return;

    // 精準取得當前這張卡片的數量
    const itemLogs = transactions.filter(t => t.defId === defId);
    const currentQty = itemLogs
      .filter(t => (t.expiryDate || '無效期') === (oldExpiry || '無效期'))
      .reduce((acc, t) => acc + t.delta, 0);

    const delta = updated.quantity - currentQty;

    if (delta > 0) {
      setShoppingList(prev => prev.filter(s => {
        if (!s.isChecked) return true;
        return !s.name.trim().toLowerCase().includes(updated.name.trim().toLowerCase());
      }));
    }

    if (delta !== 0) {
      setTransactions(prev => [...prev, {
        id: generateId(),
        defId: defId,
        type: transactionType || (delta > 0 ? 'restock' : 'consume'),
        delta: delta,
        timestamp,
        // 消耗記在舊效期上，入庫記在新效期上
        expiryDate: delta < 0 ? (oldExpiry === '無效期' ? undefined : oldExpiry) : updated.expiryDate,
      }]);
    }

    const newExpiryStr = updated.expiryDate || '無效期';
    const oldExpiryStr = oldExpiry || '無效期';

    // 如果效期被修改，把流水帳裡的標記一起改掉
    if (newExpiryStr !== oldExpiryStr) {
      setTransactions(prev => prev.map(t =>
        (t.defId === defId && (t.expiryDate || '無效期') === oldExpiryStr)
          ? { ...t, expiryDate: updated.expiryDate }
          : t
      ));
    }

    // 確立「共用屬性」連動：更新這個身分證的所有共通資料
    setDefs(prev => prev.map(d => d.id === defId ? {
      ...d,
      name: updated.name,
      category: updated.category,
      subCategory: updated.subCategory,
      defaultLocation: updated.location,
      minThreshold: updated.minThreshold,
      review: updated.review,
      openedDate: updated.openedDate,
      packageSize: updated.packageSize,
      price: updated.price,
      remarks: updated.remarks
    } : d));
  };

  const handleHeaderAddClick = () => {
    if (activeView === 'recipes') {
      setEditingRecipe(null);
      setActiveView('add-recipe');
    } else if (activeView === 'shopping') {
      setIsAddingQuickShopping(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setEditingItem(null);
      setActiveView('add');
    }
  };

  const tryRemoveFromShoppingList = (itemName: string) => {
    setShoppingList(prev => prev.filter(s => {
      if (!s.isChecked) return true;
      const shoppingName = s.name.trim().toLowerCase();
      const inventoryName = itemName.trim().toLowerCase();
      if (shoppingName.includes(inventoryName)) return false;
      return true;
    }));
  };

  return (
    <div className="min-h-screen pb-24 flex flex-col items-center text-slate-900 relative overflow-hidden bg-[#F2F2F7]">

      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-5%] right-[-10%] w-[350px] h-[350px] rounded-full bg-blue-500/15 blur-[80px]"></div>
        <div className="absolute top-[25%] left-[-15%] w-[300px] h-[300px] rounded-full bg-emerald-400/15 blur-[100px]"></div>
        <div className="absolute bottom-[10%] right-[-5%] w-[400px] h-[400px] rounded-full bg-purple-400/15 blur-[120px]"></div>
      </div>

      <div className="relative z-10 w-full flex flex-col items-center">
        <header className="w-full max-w-2xl px-4 py-3 flex justify-between items-center bg-white/60 backdrop-blur-[40px] backdrop-saturate-150 sticky top-0 z-40 border-b border-white shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <button
            onClick={() => setActiveView('analysis')}
            className={`p-2.5 rounded-full transition-all active:scale-95 border ${activeView === 'analysis'
              ? 'bg-[#007AFF] text-white border-[#007AFF] shadow-[0_4px_12px_rgba(0,122,255,0.3)]'
              : 'bg-transparent text-slate-400 border-transparent hover:bg-white hover:border-white hover:shadow-sm'
              }`}
            title="分析報表"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
          </button>

          <div className="flex gap-2">
            <button
              onClick={() => window.location.reload()}
              className="text-slate-400 p-2.5 rounded-full transition-all active:scale-95 border border-transparent hover:bg-white hover:border-white hover:shadow-sm"
              title="重新整理"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></svg>
            </button>
            <button
              onClick={() => setActiveView('settings')}
              className={`p-2.5 rounded-full transition-all active:scale-95 border ${activeView === 'settings'
                ? 'bg-[#007AFF] text-white border-[#007AFF] shadow-[0_4px_12px_rgba(0,122,255,0.3)]'
                : 'bg-transparent text-slate-400 border-transparent hover:bg-white hover:border-white hover:shadow-sm'
                }`}
              title="設定"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
            </button>
          </div>
        </header>

        <main className="w-full max-w-2xl px-4 py-6">
          {activeView === 'dashboard' && (
            <Dashboard
              items={items}
              shoppingList={shoppingList}
              onSwitchView={setActiveView}
              settings={settings}
              onAddToShopping={(name, cat) => setShoppingList(prev => [...prev, { id: generateId(), name, category: cat, addedDate: new Date().toLocaleDateString() }])}
              onEdit={(item) => { setEditingItem(item); setActiveView('edit'); }}
            />
          )}
          {activeView === 'inventory' && (
            <InventoryList
              items={items}
              shoppingList={shoppingList}
              onUpdate={handleUpdateItem}
              onScrap={(i) => handleUpdateItem({ ...i, quantity: 0 }, 'scrap')}
              onDelete={handleDeleteInventoryItem}
              onEdit={(i) => { setEditingItem(i); setActiveView('edit'); }}
              onDuplicate={(i) => {
                const { id, ...rest } = i;
                setEditingItem({ ...rest, id: '' } as InventoryItem);
                setActiveView('add');
              }}
              categories={categories}
              onAddToShopping={(name, cat) => setShoppingList(prev => [...prev, { id: generateId(), name, category: cat, addedDate: new Date().toLocaleDateString() }])}
              settings={settings}
            />
          )}
          {activeView === 'recipes' && (
            <RecipeView
              recipes={recipes}
              inventoryItems={items}
              shoppingList={shoppingList}
              recipeTags={recipeTags}
              onDelete={handleDeleteRecipe}
              onEdit={(r) => { setEditingRecipe(r); setActiveView('edit-recipe'); }}
              onUpdate={handleUpdateRecipeDirectly}
              onAddToShopping={(name) => setShoppingList(prev => [...prev, { id: generateId(), name, category: '食品', addedDate: new Date().toLocaleDateString() }])}
            />
          )}
          {activeView === 'add-recipe' && <AddRecipeView onSave={handleAddRecipe} onCancel={() => setActiveView('recipes')} recipeTags={recipeTags} />}
          {activeView === 'edit-recipe' && editingRecipe && <AddRecipeView initialData={editingRecipe} onSave={handleAddRecipe} onCancel={() => setActiveView('recipes')} recipeTags={recipeTags} />}
          {activeView === 'shopping' && (
            <ShoppingListView
              shoppingList={shoppingList}
              onRemove={handleDeleteShoppingItem}
              onToggle={(id) => setShoppingList(prev => prev.map(s => s.id === id ? { ...s, isChecked: !s.isChecked } : s))}
              showAddQuickItem={isAddingQuickShopping}
              onCloseAddQuickItem={() => setIsAddingQuickShopping(false)}
              onAddQuickItem={(name, cat) => setShoppingList(prev => [...prev, { id: generateId(), name, category: cat, addedDate: new Date().toLocaleDateString() }])}
              categories={categories}
              existingItems={items}
            />
          )}
          {activeView === 'analysis' && <AnalysisView items={items} transactions={transactions} defs={defs} />}
          {activeView === 'settings' && (
            <SettingsView
              settings={settings}
              onUpdateSettings={setSettings}
              categories={categories}
              onUpdateCategories={setCategories}
              locations={locations}
              onUpdateLocations={setLocations}
              recipeTags={recipeTags}
              onUpdateRecipeTags={setRecipeTags}
              onBack={() => setActiveView('dashboard')}
              items={items}
              defs={defs}
              transactions={transactions}
              recipes={recipes}
              shoppingList={shoppingList}
              onExcelImport={handleExcelImport}
              onSystemRestore={handleSystemRestore}
              onClearAllData={handleClearAllData}
            />
          )}
          {(activeView === 'add' || activeView === 'edit') && (
            <AddItemView
              initialData={editingItem || undefined}
              categories={categories}
              locations={locations}
              existingItems={items}
              onAdd={(item, stay) => {
                if (editingItem && editingItem.id) {
                  // 因為編輯的是虛擬身分證卡片，id 本身就是對位的指標
                  handleUpdateItem({ ...item, id: editingItem.id } as any);
                } else {
                  const existingDef = defs.find(d =>
                    d.name.trim() === item.name.trim() &&
                    d.defaultLocation === item.location
                  );

                  if (existingDef) {
                    const transactionId = generateId();
                    const newTransaction: InventoryTransaction = {
                      id: transactionId,
                      defId: existingDef.id,
                      type: 'restock',
                      delta: item.quantity,
                      timestamp: new Date().toISOString(),
                      expiryDate: item.expiryDate
                    };
                    setTransactions(prev => [...prev, newTransaction]);

                    setDefs(prev => prev.map(d => d.id === existingDef.id ? {
                      ...d,
                      category: item.category,
                      subCategory: item.subCategory,
                      remarks: item.remarks,
                      packageSize: item.packageSize,
                      price: item.price
                    } : d));

                    tryRemoveFromShoppingList(item.name);

                  } else {
                    const id = generateId();
                    setDefs(prev => [...prev, { ...item, id, defaultLocation: item.location, createdDate: new Date().toISOString() }]);
                    setTransactions(prev => [...prev, { id: generateId(), defId: id, type: 'init', delta: item.quantity, timestamp: new Date().toISOString(), expiryDate: item.expiryDate }]);

                    tryRemoveFromShoppingList(item.name);
                  }
                }
                if (!stay) setActiveView('inventory');
              }}
              onCancel={() => setActiveView('inventory')}
            />
          )}
        </main>
      </div>

      <Navbar
        activeView={activeView === 'add-recipe' || activeView === 'edit-recipe' ? 'recipes' : activeView}
        setActiveView={setActiveView}
        onAddClick={handleHeaderAddClick}
      />

      <ConfirmationModal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        message={modalConfig.message}
        onConfirm={modalConfig.onConfirm}
        onCancel={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
        confirmText={modalConfig.confirmText}
        cancelText={modalConfig.cancelText}
        isAlert={modalConfig.isAlert}
      />
    </div>
  );
};

export default App;