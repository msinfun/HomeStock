import React, { useState, useMemo } from 'react';
import { InventoryItem, InventoryTransaction, InventoryDef } from '../types';

interface AnalysisViewProps {
  items: InventoryItem[];
  transactions: InventoryTransaction[];
  defs: InventoryDef[];
}

interface AnalyzedGroup {
  id: string;
  name: string;
  category: string;
  totalQuantity: number;
  avgCycle: number | undefined;
  type: 'subCategory' | 'item';
  nextRestockDate?: string;
  burnRate?: number;
}

const AnalysisView: React.FC<AnalysisViewProps> = ({ items, transactions, defs }) => {
  const [activeTab, setActiveTab] = useState<'frequency' | 'fsn' | 'waste'>('frequency');
  const [thresholdDays, setThresholdDays] = useState<number>(14);

  // --- Core Algorithm: Burn Rate based on Restock Intervals ---
  // Lazy Tracking: We assume if you bought it, you consumed the previous batch.
  const calculateCycleForGroup = (trans: InventoryTransaction[]) => {
    // 1. Filter: Only consider "incoming" stock (init or restock)
    const restocks = trans
      .filter(t => (t.type === 'restock' || t.type === 'init') && t.delta > 0)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (restocks.length < 2) return undefined;

    // 2. Merge Dense Purchases: Restocks within 5 days are considered one "Shopping Trip"
    const trips: { date: number, quantity: number }[] = [];

    restocks.forEach(r => {
      const rDate = new Date(r.timestamp).getTime();
      const lastTrip = trips[trips.length - 1];

      // 5 days in milliseconds
      const MERGE_WINDOW = 5 * 24 * 60 * 60 * 1000;

      if (lastTrip && (rDate - lastTrip.date) < MERGE_WINDOW) {
        // Merge into last trip
        lastTrip.quantity += r.delta;
        // Optionally update date to latest? Let's keep first date of trip.
      } else {
        trips.push({ date: rDate, quantity: r.delta });
      }
    });

    if (trips.length < 2) return undefined;

    // 3. Calculate Interval & Consumption
    const firstTrip = trips[0];
    const lastTrip = trips[trips.length - 1];

    const totalIntervalDays = (lastTrip.date - firstTrip.date) / (1000 * 60 * 60 * 24);
    if (totalIntervalDays <= 0) return undefined;

    // We assume everything bought *before* the last trip has been consumed by the time of the last trip.
    // Excluding the last trip quantity because we are currently consuming it.
    let totalConsumed = 0;
    for (let i = 0; i < trips.length - 1; i++) {
      totalConsumed += trips[i].quantity;
    }

    // 4. Burn Rate (Daily Consumption)
    const dailyBurnRate = totalConsumed / totalIntervalDays;

    // 5. Avg Single Purchase Quantity
    const totalPurchased = trips.reduce((acc, t) => acc + t.quantity, 0);
    const avgPurchaseQty = totalPurchased / trips.length;

    // 6. Estimated Cycle (Days to consume one average purchase)
    const estimatedCycle = Math.round(avgPurchaseQty / dailyBurnRate);

    return estimatedCycle > 0 ? estimatedCycle : undefined;
  };

  const analyzedGroups = useMemo(() => {
    const defMap = new Map<string, InventoryDef>();
    defs.forEach(d => defMap.set(d.id, d));
    const groups = new Map<string, { name: string; category: string; trans: InventoryTransaction[]; ids: Set<string>; type: 'subCategory' | 'item'; lastPurchased?: string; }>();

    defs.forEach(def => {
      const subCat = (def.subCategory || '').trim();
      const name = def.name.trim();
      // Grouping Priority: SubCategory > Item Name
      let key = subCat ? `SUB:${subCat.toLowerCase()}` : `ITEM:${name.toLowerCase()}`;
      let displayName = subCat ? subCat : name;
      let groupType: 'subCategory' | 'item' = subCat ? 'subCategory' : 'item';

      if (!groups.has(key)) groups.set(key, { name: displayName, category: def.category, trans: [], ids: new Set(), type: groupType });
      groups.get(key)!.ids.add(def.id);
    });

    transactions.forEach(t => {
      const def = defMap.get(t.defId);
      if (!def) return;
      const subCat = (def.subCategory || '').trim();
      const name = def.name.trim();
      const key = subCat ? `SUB:${subCat.toLowerCase()}` : `ITEM:${name.toLowerCase()}`;
      if (groups.has(key)) {
        const g = groups.get(key)!;
        g.trans.push(t);
        if ((t.type === 'restock' || t.type === 'init') && t.delta > 0) {
          if (!g.lastPurchased || t.timestamp > g.lastPurchased) g.lastPurchased = t.timestamp;
        }
      }
    });

    const results: AnalyzedGroup[] = [];
    groups.forEach((group, key) => {
      let totalQty = 0;
      items.forEach(item => { if (group.ids.has(item.id)) totalQty += item.quantity; });

      const avgCycle = calculateCycleForGroup(group.trans);

      let nextRestockDate;
      if (avgCycle !== undefined && group.lastPurchased) {
        const last = new Date(group.lastPurchased);
        last.setDate(last.getDate() + avgCycle);
        nextRestockDate = last.toISOString().split('T')[0];
      }
      if (avgCycle !== undefined) {
        results.push({ id: key, name: group.name, category: group.category, totalQuantity: totalQty, avgCycle: avgCycle, type: group.type, nextRestockDate });
      }
    });
    return results;
  }, [items, transactions, defs]);

  const frequentGroups = useMemo(() => {
    return analyzedGroups
      .filter(g => g.avgCycle !== undefined && g.avgCycle <= thresholdDays)
      .sort((a, b) => (a.avgCycle || 0) - (b.avgCycle || 0));
  }, [analyzedGroups, thresholdDays]);

  const { fastMovingItems, slowMovingItems, nonMovingItems } = useMemo(() => {
    const todayTime = new Date().setHours(0, 0, 0, 0);
    const getDaysSinceUsed = (dateStr?: string) => {
      if (!dateStr) return 999;
      const diff = todayTime - new Date(dateStr).getTime();
      return Math.floor(diff / (1000 * 60 * 60 * 24));
    };
    const usageMap = new Map<string, { days: number, name: string, id: string }>();
    items.forEach(item => {
      const subCat = (item.subCategory || '').trim();
      const name = item.name.trim();
      const key = subCat ? `SUB:${subCat.toLowerCase()}` : `ITEM:${name.toLowerCase()}`;
      const displayName = subCat ? subCat : name;
      const days = getDaysSinceUsed(item.lastUsedDate);
      const current = usageMap.get(key);
      if (!current || days < current.days) usageMap.set(key, { days, name: displayName, id: key });
    });
    const f: any[] = [], s: any[] = [], n: any[] = [];
    usageMap.forEach((val) => {
      if (val.days <= 7) f.push(val);
      else if (val.days > 30 && val.days <= 90) s.push(val);
      else if (val.days > 90) n.push(val);
    });
    return { fastMovingItems: f, slowMovingItems: s, nonMovingItems: n };
  }, [items]);

  const wasteGroups = useMemo(() => {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - 6);
    const cutoffTime = cutoffDate.getTime();

    const nameMap = new Map<string, { name: string, subCategory?: string }>();
    defs.forEach(d => nameMap.set(d.id, { name: d.name, subCategory: d.subCategory }));

    items.forEach(i => {
      if (!nameMap.has(i.id)) nameMap.set(i.id, { name: i.name, subCategory: i.subCategory });
    });

    const statsMap = new Map<string, { scrapped: number, purchased: number, name: string }>();

    transactions.forEach(t => {
      if (new Date(t.timestamp).getTime() < cutoffTime) return;

      const info = nameMap.get(t.defId);
      if (!info) return;

      const subCat = (info.subCategory || '').trim();
      const name = info.name.trim();
      const key = subCat ? `SUB:${subCat.toLowerCase()}` : `ITEM:${name.toLowerCase()}`;
      const displayName = subCat ? subCat : name;

      if (!statsMap.has(key)) statsMap.set(key, { scrapped: 0, purchased: 0, name: displayName });
      const stat = statsMap.get(key)!;

      const type = (t.type || '').toLowerCase();

      if (type === 'scrap') {
        stat.scrapped += Math.abs(t.delta);
      } else if (t.delta > 0 && type !== 'edit' && type !== 'consume') {
        stat.purchased += t.delta;
      }
    });

    const results: any[] = [];
    statsMap.forEach((val) => {
      if (val.scrapped > 0) {
        const rate = val.purchased > 0 ? Math.round((val.scrapped / val.purchased) * 100) : 100;
        results.push({ name: val.name, rate: rate, scrapped: val.scrapped, purchased: val.purchased });
      }
    });
    return results.sort((a, b) => b.rate - a.rate);
  }, [transactions, defs, items]);

  const CLASSES = {
    CARD_HEADER: "text-xl font-black tracking-tighter text-slate-800 drop-shadow-[0_2px_10px_rgba(0,0,0,0.03)]",
    ITEM_NAME: "text-[17px] font-black tracking-tight text-slate-700 leading-tight",
    METRIC_PRIMARY: "text-3xl font-black tracking-tighter text-[#007AFF]",
    METRIC_DANGER: "text-3xl font-black tracking-tighter text-[#FF3B30]",
    LABEL: "text-[10px] font-bold text-slate-400 uppercase tracking-widest",
    SUBTEXT: "text-xs font-bold text-slate-500",
  };

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-300">

      {/* 🍎 頂部導覽 Tabs：iOS Segmented Control 風格 */}
      <div className="flex p-1 bg-slate-200/50 backdrop-blur-[40px] backdrop-saturate-150 rounded-full border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] mt-2">
        <button onClick={() => setActiveTab('frequency')} className={`flex-1 py-2.5 rounded-full text-[13px] transition-all active:scale-[0.96] tracking-widest ${activeTab === 'frequency' ? 'bg-white text-[#007AFF] shadow-[0_2px_8px_rgba(0,0,0,0.05)] font-black' : 'text-slate-500 font-bold hover:text-slate-700'}`}>
          頻繁採購
        </button>
        <button onClick={() => setActiveTab('fsn')} className={`flex-1 py-2.5 rounded-full text-[13px] transition-all active:scale-[0.96] tracking-widest ${activeTab === 'fsn' ? 'bg-white text-[#007AFF] shadow-[0_2px_8px_rgba(0,0,0,0.05)] font-black' : 'text-slate-500 font-bold hover:text-slate-700'}`}>
          庫存流動
        </button>
        <button onClick={() => setActiveTab('waste')} className={`flex-1 py-2.5 rounded-full text-[13px] transition-all active:scale-[0.96] tracking-widest ${activeTab === 'waste' ? 'bg-white text-[#007AFF] shadow-[0_2px_8px_rgba(0,0,0,0.05)] font-black' : 'text-slate-500 font-bold hover:text-slate-700'}`}>
          浪費檢討
        </button>
      </div>

      {activeTab === 'frequency' && (
        <section className="space-y-4">
          {/* 🍎 玻璃外層大卡片 */}
          <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 border border-white/60 rounded-[32px] p-6 shadow-[0_2px_10px_rgba(0,0,0,0.03)] relative">
            <div className="flex justify-between items-center mb-6">
              <h3 className={CLASSES.CARD_HEADER}>採購週期建議</h3>
              <div className="flex items-center gap-3">
                <span className={CLASSES.LABEL}>週期 &le; {thresholdDays} 天</span>
                <input type="range" min="3" max="60" value={thresholdDays} onChange={(e) => setThresholdDays(parseInt(e.target.value))} className="w-24 accent-[#007AFF]" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {frequentGroups.map(group => (
                /* 🍎 內部卡片：極簡白板、去除多餘邊框與光澤 */
                <div key={group.id} className="relative bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-3xl p-5 flex items-center justify-between overflow-hidden group hover:bg-white transition-colors cursor-default">
                  {/* 左側藍色呼吸飾條 */}
                  <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#007AFF] opacity-0 group-hover:opacity-100 transition-opacity"></div>

                  <div className="flex-1 min-w-0 pr-4 pl-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <h4 className={`${CLASSES.ITEM_NAME} truncate`}>{group.name}</h4>
                      {/* 類別標籤：純色無邊框膠囊 */}
                      {group.type === 'subCategory' && <span className="text-[10px] bg-blue-50 text-[#007AFF] px-2.5 py-1 rounded-full font-black tracking-wide shrink-0">類別</span>}
                    </div>
                    <p className={CLASSES.SUBTEXT}>
                      目前庫存: <span className="font-black text-slate-700 ml-1">{group.totalQuantity}</span>
                    </p>
                  </div>

                  <div className="text-right pl-5 border-l border-slate-100 shrink-0 min-w-[80px]">
                    <div className="flex items-baseline justify-end gap-1">
                      <span className={CLASSES.METRIC_PRIMARY}>{group.avgCycle}</span>
                      <span className={CLASSES.LABEL}>天</span>
                    </div>
                    <p className={CLASSES.LABEL}>平均回購</p>
                  </div>
                </div>
              ))}
              {frequentGroups.length === 0 && (
                <div className="text-center py-8 text-sm text-slate-400 font-bold bg-white/40 rounded-3xl border border-dashed border-white shadow-[inset_0_2px_8px_rgba(0,0,0,0.02)]">
                  無資料 (需累積至少 2 次採購行程)
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {activeTab === 'fsn' && (
        <section className="space-y-4">
          <div className="grid gap-4">
            {/* 🍎 Fast Moving 卡片：單純白板 */}
            <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-[32px] p-6 relative">
              <div className="flex items-center gap-3.5 mb-5">
                {/* 標題 Icon 獨立化 */}
                <div className="p-2.5 bg-green-50 rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-white">
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#34C759]"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.1.243-2.143.7-3.1 1.1 1.1 2.8 2.3 2.8 3.6z" /></svg>
                </div>
                <div>
                  <h3 className={CLASSES.CARD_HEADER}>熱門消耗 (F)</h3>
                  <p className={CLASSES.SUBTEXT}>7天內有使用</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {/* 項目標籤：純粹扁平的白板膠囊 */}
                {fastMovingItems.slice(0, 15).map(item => (
                  <span key={item.id} className="text-[13px] font-black tracking-tight bg-white border border-slate-100 shadow-[0_2px_8px_rgba(0,0,0,0.02)] text-slate-700 px-4 py-2 rounded-full">
                    {item.name}
                  </span>
                ))}
                {fastMovingItems.length === 0 && <span className="text-sm font-bold text-slate-400 bg-white/40 px-4 py-2 rounded-full border border-dashed border-white">暫無資料</span>}
              </div>
            </div>

            {/* 🍎 Slow Moving 卡片：單純白板 */}
            <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-[32px] p-6 relative">
              <div className="flex items-center gap-3.5 mb-5">
                {/* 標題 Icon 獨立化 */}
                <div className="p-2.5 bg-blue-50 rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-white">
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#007AFF]"><path d="m7.5 4.27 9 5.15" /><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>
                </div>
                <div>
                  <h3 className={CLASSES.CARD_HEADER}>長備品 (S)</h3>
                  <p className={CLASSES.SUBTEXT}>30~90天內使用</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {/* 項目標籤：純粹扁平的白板膠囊 */}
                {slowMovingItems.slice(0, 15).map(item => (
                  <span key={item.id} className="text-[13px] font-black tracking-tight bg-white border border-slate-100 shadow-[0_2px_8px_rgba(0,0,0,0.02)] text-slate-700 px-4 py-2 rounded-full">
                    {item.name}
                  </span>
                ))}
                {slowMovingItems.length === 0 && <span className="text-sm font-bold text-slate-400 bg-white/40 px-4 py-2 rounded-full border border-dashed border-white">暫無資料</span>}
              </div>
            </div>

            {/* 🍎 Non Moving 卡片：單純白板 */}
            <div className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-[32px] p-6 relative">
              <div className="flex items-center gap-3.5 mb-5 opacity-90">
                {/* 標題 Icon 獨立化 */}
                <div className="p-2.5 bg-slate-100 rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-white">
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500"><rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></svg>
                </div>
                <div>
                  <h3 className={CLASSES.CARD_HEADER}>滯銷 / 斷捨離 (N)</h3>
                  <p className={CLASSES.SUBTEXT}>超過 90 天未動</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2.5 opacity-90">
                {/* 項目標籤：純粹扁平的白板膠囊 */}
                {nonMovingItems.slice(0, 15).map(item => (
                  <span key={item.id} className="text-[13px] font-black tracking-tight bg-white border border-slate-100 shadow-[0_2px_8px_rgba(0,0,0,0.02)] text-slate-500 px-4 py-2 rounded-full">
                    {item.name}
                  </span>
                ))}
                {nonMovingItems.length === 0 && <span className="text-sm font-bold text-[#34C759] bg-green-50 px-4 py-2 rounded-full border border-white shadow-[0_2px_10px_rgba(0,0,0,0.03)]">好棒！沒有滯銷品</span>}
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'waste' && (
        <section className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 border border-white/60 rounded-[32px] p-6 shadow-[0_2px_10px_rgba(0,0,0,0.03)] relative">
          <div className="flex items-center gap-3.5 mb-6">
            {/* 標題 Icon 獨立化 */}
            <div className="p-2.5 bg-red-50 rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-white text-[#FF3B30]">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></svg>
            </div>
            <h3 className={CLASSES.CARD_HEADER}>浪費檢討 (近6個月)</h3>
          </div>

          {wasteGroups.length === 0 ? (
            <div className="text-center py-10 bg-white/40 rounded-3xl border border-dashed border-white shadow-[inset_0_2px_8px_rgba(0,0,0,0.02)]">
              <div className="w-16 h-16 bg-green-50 text-[#34C759] border-2 border-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-full flex items-center justify-center mx-auto mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
              </div>
              <p className="text-sm font-bold text-slate-500">太棒了！近期沒有報廢紀錄</p>
            </div>
          ) : (
            <div className="space-y-4 pb-24">
              {wasteGroups.map((group, idx) => (
                /* 🍎 內部卡片：極簡白板 */
                <div key={idx} className="group bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-3xl p-5 hover:bg-white transition-all">
                  <div className="flex justify-between items-end mb-3">
                    <div>
                      <span className={`${CLASSES.ITEM_NAME} block mb-1.5`}>{group.name}</span>
                      <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
                        買入 {group.purchased} / 丟棄 {group.scrapped}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className={CLASSES.METRIC_DANGER}>{group.rate}<span className="text-lg align-top ml-0.5 font-bold">%</span></span>
                      <span className={`${CLASSES.LABEL} block mt-0.5`}>浪費率</span>
                    </div>
                  </div>
                  {/* 🍎 進度條：內凹槽感 + 扁平紅條 (去除發光) */}
                  <div className="h-2.5 w-full bg-slate-100/80 rounded-full overflow-hidden border border-black/5 shadow-[inset_0_1px_3px_rgba(0,0,0,0.06)] mt-2">
                    <div
                      className="h-full bg-[#FF3B30] rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${Math.min(group.rate, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default AnalysisView;