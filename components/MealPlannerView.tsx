import React, { useState, useEffect, useMemo } from 'react';
import { Recipe, InventoryItem, DailyMeals, MealPlan } from '../types';
import { recommendRecipes, generateMealPlan } from '../geminiService';
import ConfirmationModal from './ConfirmationModal';

interface MealPlannerViewProps {
    recipes: Recipe[];
    inventoryItems: InventoryItem[];
    handleJumpToRecipe: (id: string) => void;
}

type MealType = 'breakfast' | 'lunch' | 'dinner';

const getLocalDateString = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const getWeekDates = (baseDateStr: string) => {
    const baseDate = new Date(baseDateStr);
    const dayOfWeek = baseDate.getDay(); // 0 is Sunday, 1 is Monday
    const diffToMonday = baseDate.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const monday = new Date(baseDate.setDate(diffToMonday));

    const week: { dateStr: string, dayName: string, shortName: string }[] = [];
    const dayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const weekDayNames = ['日', '一', '二', '三', '四', '五', '六'];

    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        week.push({
            dateStr: getLocalDateString(d),
            dayName: dayNames[d.getDay()],
            shortName: weekDayNames[d.getDay()]
        });
    }
    return week;
};

const parseDayName = (dayStr: string): number => {
    if (dayStr.includes('一') || dayStr.includes('1')) return 1;
    if (dayStr.includes('二') || dayStr.includes('2')) return 2;
    if (dayStr.includes('三') || dayStr.includes('3')) return 3;
    if (dayStr.includes('四') || dayStr.includes('4')) return 4;
    if (dayStr.includes('五') || dayStr.includes('5')) return 5;
    if (dayStr.includes('六') || dayStr.includes('6')) return 6;
    if (dayStr.includes('日') || dayStr.includes('天') || dayStr.includes('0') || dayStr.includes('7')) return 0;

    // 如果全部沒對上，才回退到 1
    return 1;
}

const MealItemCard: React.FC<{
    recipeName: string;
    onDelete: () => void;
    onClick: () => void;
}> = ({ recipeName, onDelete, onClick }) => {
    const [offsetX, setOffsetX] = useState(0);
    const [swipedOpen, setSwipedOpen] = useState(false);
    const startX = React.useRef<number | null>(null);
    const threshold = 70;

    const handleTouchStart = (e: React.TouchEvent) => {
        startX.current = e.touches[0].clientX;
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (startX.current === null) return;
        const currentX = e.touches[0].clientX;
        const diff = currentX - startX.current;

        if (!swipedOpen && diff < 0) {
            setOffsetX(Math.max(diff, -threshold));
        } else if (swipedOpen && diff > 0) {
            setOffsetX(Math.min(-threshold + diff, 0));
        }
    };

    const handleTouchEnd = () => {
        if (offsetX < -threshold / 2) {
            setOffsetX(-threshold);
            setSwipedOpen(true);
        } else {
            setOffsetX(0);
            setSwipedOpen(false);
        }
        startX.current = null;
    };

    return (
        <div className="relative overflow-hidden w-full group rounded-3xl bg-white transition-all hover:bg-slate-50">
            {/* Delete button background layer */}
            <div className={`absolute inset-0 bg-transparent flex justify-end items-center px-6 z-0 rounded-3xl ${offsetX === 0 ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}>
                <button
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    className="transition-transform active:scale-95 flex flex-col items-center h-full px-2 justify-center gap-1"
                >
                    <svg className="text-[#FF3B30]" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    <span className="text-slate-800 text-[10px] font-black mt-1 uppercase tracking-widest">刪除</span>
                </button>
            </div>

            {/* Main content layer */}
            <div
                className="transition-transform duration-300 relative z-10 w-full bg-white rounded-2xl px-5 py-3.5 cursor-pointer flex items-center touch-pan-y"
                style={{ transform: `translateX(${offsetX}px)` }}
                onClick={onClick}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                <span className="font-bold text-[16px] text-slate-800 truncate group-hover:text-[#007AFF] transition-colors">{recipeName}</span>
            </div>
        </div>
    );
};

const MealPlannerView: React.FC<MealPlannerViewProps> = ({ recipes, inventoryItems, handleJumpToRecipe }) => {
    const [selectedDate, setSelectedDate] = useState<string>(() => getLocalDateString(new Date()));
    const [mealData, setMealData] = useState<MealPlan>(() => {
        try {
            const saved = localStorage.getItem('homestock_meal_calendar');
            return saved ? JSON.parse(saved) : {};
        } catch { return {}; }
    });

    const [isManualAddOpen, setIsManualAddOpen] = useState(false);
    const [isAIPlanOpen, setIsAIPlanOpen] = useState(false);
    const [modalConfig, setModalConfig] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void; isAlert?: boolean }>({ isOpen: false, title: '', message: '', onConfirm: () => { } });

    // Manual Add State
    const [manualAddDate, setManualAddDate] = useState(selectedDate);
    const [manualAddMeal, setManualAddMeal] = useState<MealType>('breakfast');
    const [manualAddRecipeId, setManualAddRecipeId] = useState<string>('');
    const [recipeSearch, setRecipeSearch] = useState('');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    // Recommend State inside Manual Modals
    const [isRecommending, setIsRecommending] = useState(false);
    const [recommendations, setRecommendations] = useState<{ recipeId: string, reason: string }[] | null>(null);

    // AI Plan State
    const [isPlanning, setIsPlanning] = useState(false);
    const [mealPlanPrompt, setMealPlanPrompt] = useState('');

    // Save to LocalStorage whenever mealData changes
    useEffect(() => {
        localStorage.setItem('homestock_meal_calendar', JSON.stringify(mealData));
    }, [mealData]);

    // Sync manual add date with selected date when opening modal
    useEffect(() => {
        if (isManualAddOpen) setManualAddDate(selectedDate);
    }, [isManualAddOpen, selectedDate]);

    const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
    const currentDayMeals = mealData[selectedDate] || { breakfast: [], lunch: [], dinner: [] };

    const handleRecommend = async () => {
        setIsRecommending(true);
        const res = await recommendRecipes(inventoryItems || [], recipes);
        setRecommendations(res);
        setIsRecommending(false);
    };

    const handleManualAdd = () => {
        if (!manualAddRecipeId) {
            setModalConfig({
                isOpen: true, title: '提示', message: '請選擇一個食譜', isAlert: true, onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
            });
            return;
        }

        setMealData(prev => {
            const next = { ...prev };
            if (!next[manualAddDate]) {
                next[manualAddDate] = { breakfast: [], lunch: [], dinner: [] };
            }
            next[manualAddDate] = {
                ...next[manualAddDate],
                [manualAddMeal]: [...next[manualAddDate][manualAddMeal], manualAddRecipeId]
            };
            return next;
        });

        setIsManualAddOpen(false);
        setManualAddRecipeId('');
        setRecipeSearch('');
        setRecommendations(null); // Clear recommendations after adding
    };

    const handleAIPlan = async () => {
        setIsPlanning(true);
        try {
            const prompt = mealPlanPrompt.trim() || '請幫我安排均衡的一週餐點。';
            // 獲取當週的 7 個日期字串
            const targetDates = weekDates.map(w => w.dateStr);
            const res = await generateMealPlan(prompt, recipes, targetDates);
            setIsPlanning(false);

            if (res && res.plan) {
                // mapping logic
                setMealData(prev => {
                    const next = { ...prev };

                    res.plan.forEach((dayPlan: any) => {
                        const targetDate = dayPlan.day; // 剛好是 YYYY-MM-DD

                        // 確保目標日期在目前正在顯示的這週（或者如果 AI 有安排，直接更新也可以）
                        next[targetDate] = {
                            breakfast: dayPlan.breakfast || [],
                            lunch: dayPlan.lunch || [],
                            dinner: dayPlan.dinner || []
                        };
                    });

                    return next;
                });

                if (res.warning) {
                    setTimeout(() => {
                        setModalConfig({ isOpen: true, title: '貼心提醒', message: res.warning!, isAlert: true, onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })) });
                    }, 100);
                }

                setIsAIPlanOpen(false);
                setMealPlanPrompt('');
            }
        } catch (e) {
            setIsPlanning(false);
        }
    };

    const handleRemoveMeal = (mealType: MealType, index: number) => {
        setMealData(prev => {
            const next = { ...prev };
            if (next[selectedDate]) {
                const updatedMeals = [...next[selectedDate][mealType]];
                updatedMeals.splice(index, 1);
                next[selectedDate] = { ...next[selectedDate], [mealType]: updatedMeals };
            }
            return next;
        });
    };

    return (
        <div className="w-full flex flex-col -mt-6 pb-24 relative bg-transparent">
            <div className="relative z-10 w-full flex flex-col">
                {/* Combined Header & Calendar Strip Card */}
                <div className="shrink-0 mt-4 bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 border border-white/60 rounded-[32px] shadow-[0_2px_10px_rgba(0,0,0,0.03)] overflow-hidden">
                    {/* Header */}
                    <header className="w-full px-5 py-4 flex justify-between items-center border-b border-slate-100/50">
                        <div className="flex flex-col">
                            <h1 className="text-2xl font-black tracking-tighter text-slate-800">餐食計畫</h1>
                            <p className="text-xs font-bold text-[#007AFF] tracking-widest">{selectedDate.replace(/-/g, ' / ')}</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <button onClick={() => setIsAIPlanOpen(true)} className="w-10 h-10 rounded-full flex items-center justify-center bg-transparent border-2 border-[#007AFF]/20 text-[#007AFF] hover:bg-blue-50 active:scale-95 transition-all shadow-sm">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></svg>
                            </button>
                            <button onClick={() => setIsManualAddOpen(true)} className="w-10 h-10 rounded-full flex items-center justify-center bg-[#007AFF] text-white hover:bg-blue-600 active:scale-95 transition-all shadow-[0_4px_12px_rgba(0,122,255,0.3)]">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                            </button>
                        </div>
                    </header>

                    {/* Calendar Strip */}
                    <div>
                        <div className="flex justify-between items-center px-4 py-3 pb-2 overflow-x-auto custom-scrollbar">
                            {weekDates.map((day) => {
                                const isSelected = selectedDate === day.dateStr;
                                const hasMeals = mealData[day.dateStr] && (
                                    mealData[day.dateStr].breakfast.length > 0 ||
                                    mealData[day.dateStr].lunch.length > 0 ||
                                    mealData[day.dateStr].dinner.length > 0
                                );
                                const isToday = day.dateStr === getLocalDateString(new Date());

                                return (
                                    <div
                                        key={day.dateStr}
                                        onClick={() => setSelectedDate(day.dateStr)}
                                        className="flex flex-col items-center gap-1 cursor-pointer shrink-0 min-w-[44px]"
                                    >
                                        <span className={`text-[12px] font-bold ${isSelected ? 'text-[#007AFF]' : (isToday ? 'text-[#007AFF]' : 'text-slate-400')}`}>
                                            {day.shortName}
                                        </span>
                                        <div className={`w-9 h-9 flex items-center justify-center rounded-full text-lg font-black transition-all duration-300 ${isSelected ? 'bg-[#007AFF] text-white shadow-[0_4px_12px_rgba(0,122,255,0.3)]' : (isToday ? 'text-[#007AFF] bg-blue-50' : 'text-slate-800 hover:bg-slate-100')}`}>
                                            {parseInt(day.dateStr.split('-')[2], 10)}
                                        </div>
                                        {/* Dot Indicator */}
                                        <div className={`w-1.5 h-1.5 rounded-full mt-0.5 transition-opacity ${hasMeals ? (isSelected ? 'bg-[#007AFF]' : 'bg-slate-300') : 'opacity-0'}`} />
                                    </div>
                                )
                            })}
                        </div>
                        {/* Navigation for Prev/Next week could be added here, currently just shows the week of selected date */}
                        <div className="px-5 pb-3 flex justify-between text-[11px] font-bold text-slate-400">
                            <button onClick={() => {
                                const d = new Date(selectedDate);
                                d.setDate(d.getDate() - 7);
                                setSelectedDate(getLocalDateString(d));
                            }} className="flex items-center hover:text-slate-600 transition-colors uppercase tracking-widest bg-white/50 px-3 py-1 rounded-full border border-slate-200/50">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><path d="m15 18-6-6 6-6" /></svg> 上一週
                            </button>
                            <button onClick={() => {
                                setSelectedDate(getLocalDateString(new Date()));
                            }} className={`uppercase tracking-widest px-3 py-1 rounded-full text-[#007AFF] border border-[#007AFF]/20 bg-[#007AFF]/10 ${selectedDate === getLocalDateString(new Date()) ? 'opacity-50 pointer-events-none' : ''}`}>
                                {selectedDate === getLocalDateString(new Date()) ? '今天' : '返回今天'}
                            </button>
                            <button onClick={() => {
                                const d = new Date(selectedDate);
                                d.setDate(d.getDate() + 7);
                                setSelectedDate(getLocalDateString(d));
                            }} className="flex items-center hover:text-slate-600 transition-colors uppercase tracking-widest bg-white/50 px-3 py-1 rounded-full border border-slate-200/50">
                                下一週<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="ml-1"><path d="m9 18 6-6-6-6" /></svg>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Daily Agenda List */}
                <div className="w-full mt-4">
                    <div className="w-full max-w-2xl mx-auto space-y-4 pb-24">
                        {['breakfast', 'lunch', 'dinner'].map((mealStr) => {
                            const meal = mealStr as MealType;
                            const mealName = meal === 'breakfast' ? '早餐' : meal === 'lunch' ? '午餐' : '晚餐';
                            const mealIcon = meal === 'breakfast' ? '☀️' : meal === 'lunch' ? '🍔' : '🌙';
                            const targetIds = currentDayMeals[meal];
                            const hasRecipes = targetIds && targetIds.length > 0;
                            const theme = meal === 'breakfast' ? { color: '#FF9F0A', bg: 'bg-[#FF9F0A]/10', border: 'border-[#FF9F0A]/20' } : meal === 'lunch' ? { color: '#34C759', bg: 'bg-[#34C759]/10', border: 'border-[#34C759]/20' } : { color: '#5856D6', bg: 'bg-[#5856D6]/10', border: 'border-[#5856D6]/20' };

                            return (
                                <div key={meal} className="w-full bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-3xl overflow-hidden p-4 animate-in slide-in-from-bottom-[8px] duration-500 fade-in fill-mode-both" style={{ animationDelay: `${meal === 'breakfast' ? 0 : meal === 'lunch' ? 100 : 200}ms` }}>
                                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-[14px] font-black tracking-widest uppercase" style={{ color: theme.color }}>{mealName}</span>
                                            {!hasRecipes && <span className="text-[12px] font-bold text-slate-400 bg-white px-2.5 py-1 rounded-full border border-slate-200 shadow-[0_2px_4px_rgba(0,0,0,0.02)]">沒有食譜</span>}
                                        </div>

                                        {hasRecipes && (
                                            <div className="space-y-2 mt-1">
                                                {targetIds.map((id, index) => {
                                                    const r = recipes.find(x => x.id === id);
                                                    if (!r) return null;
                                                    return (
                                                        <MealItemCard
                                                            key={id + index}
                                                            recipeName={r.name}
                                                            onClick={() => handleJumpToRecipe(r.id)}
                                                            onDelete={() => handleRemoveMeal(meal, index)}
                                                        />
                                                    )
                                                })}
                                            </div>
                                        )}

                                        <button onClick={() => { setManualAddDate(selectedDate); setManualAddMeal(meal); setIsManualAddOpen(true); }} className="mt-2 w-full flex items-center justify-center border border-dashed border-slate-300/50 text-slate-400 hover:text-[#007AFF] hover:border-[#007AFF]/30 hover:bg-blue-50/50 rounded-3xl transition-all cursor-pointer group font-bold text-[13px] gap-1.5 active:scale-95 bg-transparent py-3.5 outline-none focus:outline-none focus:ring-0">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="group-hover:scale-110 transition-transform"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                                            新增{mealName}餐點
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Manual Add Modal */}
            {isManualAddOpen && (
                <div className="fixed inset-0 z-[100] flex items-end justify-center px-4 bg-slate-900/40 backdrop-blur-[40px] backdrop-saturate-150 animate-in fade-in duration-200" style={{ paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' }} onClick={() => setIsManualAddOpen(false)}>
                    <div className="bg-white/95 backdrop-blur-[40px] backdrop-saturate-150 border border-white/60 rounded-[32px] overflow-hidden flex flex-col w-full max-w-sm max-h-[80dvh] shadow-[0_-8px_40px_rgba(0,0,0,0.12)] animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center p-5 border-b border-slate-100 shrink-0">
                            <h3 className="text-xl font-black tracking-tighter text-slate-900">新增一次餐食</h3>
                            <button onClick={() => setIsManualAddOpen(false)} className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-full transition-colors active:scale-95">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar flex-1 pb-40">
                            <div className="flex-1 min-w-0 overflow-hidden">
                                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 pl-1">日期</label>
                                <input type="date" value={manualAddDate} onChange={e => setManualAddDate(e.target.value)} className="w-full min-w-0 box-border appearance-none shrink-0 bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-full px-5 py-3.5 text-[15px] font-bold text-slate-800 outline-none focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] transition-all" />
                            </div>

                            <div>
                                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 pl-1">餐別</label>
                                <div className="flex bg-slate-100/80 p-1.5 rounded-full border border-slate-200/50">
                                    <button onClick={() => setManualAddMeal('breakfast')} className={`flex-1 py-2 text-[13px] tracking-widest font-black rounded-full transition-all duration-300 ${manualAddMeal === 'breakfast' ? 'bg-white text-[#007AFF] shadow-[0_2px_8px_rgba(0,0,0,0.05)]' : 'text-slate-500 bg-transparent'}`}>早餐</button>
                                    <button onClick={() => setManualAddMeal('lunch')} className={`flex-1 py-2 text-[13px] tracking-widest font-black rounded-full transition-all duration-300 ${manualAddMeal === 'lunch' ? 'bg-white text-[#007AFF] shadow-[0_2px_8px_rgba(0,0,0,0.05)]' : 'text-slate-500 bg-transparent'}`}>午餐</button>
                                    <button onClick={() => setManualAddMeal('dinner')} className={`flex-1 py-2 text-[13px] tracking-widest font-black rounded-full transition-all duration-300 ${manualAddMeal === 'dinner' ? 'bg-white text-[#007AFF] shadow-[0_2px_8px_rgba(0,0,0,0.05)]' : 'text-slate-500 bg-transparent'}`}>晚餐</button>
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-3 pl-1 pr-1">
                                    <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest">選擇食譜</label>
                                    <button onClick={handleRecommend} disabled={isRecommending} className="text-[11px] font-black text-[#007AFF] hover:bg-blue-50 px-2 py-1 rounded-full transition-colors flex items-center gap-1 active:scale-95 disabled:opacity-50">
                                        {isRecommending ? '推薦中..' : <>幫助清庫存推薦</>}
                                    </button>
                                </div>

                                {recommendations && (
                                    <div className="mb-4 bg-blue-50/50 border border-blue-100 rounded-3xl p-4 space-y-2 animate-in slide-in-from-top-2 duration-300 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                                        <p className="text-[11px] font-black text-[#007AFF] text-center uppercase tracking-widest">AI 智慧推薦 (點擊套用)</p>
                                        <div className="space-y-2">
                                            {recommendations.length === 0 ? (
                                                <p className="text-center text-slate-500 font-bold text-sm py-2">目前沒有合適的庫存推薦</p>
                                            ) : (
                                                recommendations.map(rec => {
                                                    const r = recipes.find(x => x.id === rec.recipeId);
                                                    if (!r) return null;
                                                    return (
                                                        <div key={rec.recipeId} onClick={() => { setManualAddRecipeId(rec.recipeId); setRecipeSearch(r.name); }} className={`bg-white p-3 rounded-2xl cursor-pointer transition-all border ${manualAddRecipeId === rec.recipeId ? 'border-[#007AFF] ring-2 ring-[#007AFF]/20 shadow-[0_2px_10px_rgba(0,122,255,0.15)]' : 'border-blue-100/50 hover:border-blue-300 shadow-sm'}`}>
                                                            <h4 className="font-black text-slate-800 text-sm">{r.name}</h4>
                                                            <p className="text-[10px] font-bold text-[#007AFF] leading-relaxed mt-1">因為 {rec.reason}</p>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="relative">
                                    <input
                                        type="text"
                                        value={recipeSearch}
                                        onChange={e => { setRecipeSearch(e.target.value); setIsDropdownOpen(true); }}
                                        onFocus={() => setIsDropdownOpen(true)}
                                        placeholder="-- 搜尋或選擇食譜 --"
                                        className="w-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-full px-5 py-3.5 text-[15px] font-bold text-slate-800 placeholder:font-bold outline-none focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] transition-all"
                                    />
                                    {isDropdownOpen && (
                                        <div className="absolute z-50 w-full mt-2 bg-white/95 backdrop-blur-xl border border-white/60 rounded-3xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] max-h-48 overflow-y-auto custom-scrollbar">
                                            {recipes.filter(r => r.name.toLowerCase().includes(recipeSearch.toLowerCase())).length > 0 ? (
                                                recipes.filter(r => r.name.toLowerCase().includes(recipeSearch.toLowerCase())).map(r => (
                                                    <div key={r.id} onClick={() => { setManualAddRecipeId(r.id); setRecipeSearch(r.name); setIsDropdownOpen(false); }} className="px-5 py-3 hover:bg-slate-50 cursor-pointer transition-colors border-b border-slate-50 last:border-0">
                                                        <span className="font-bold text-slate-800 text-[14px]">{r.name}</span>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="px-5 py-4 text-center text-slate-400 text-[13px] font-bold">沒有相關食譜</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="px-6 py-5 shrink-0 border-t border-transparent">
                            <button onClick={handleManualAdd} className="w-full py-4 rounded-full font-black text-white bg-[#007AFF] shadow-[0_4px_12px_rgba(0,122,255,0.2)] hover:bg-blue-600 active:scale-[0.96] transition-all text-[15px] tracking-widest">
                                確認新增
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* AI Plan Modal */}
            {isAIPlanOpen && (
                <div className="fixed inset-0 z-[100] flex items-end justify-center px-4 bg-slate-900/40 backdrop-blur-[40px] backdrop-saturate-150 animate-in fade-in duration-200" style={{ paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' }} onClick={() => setIsAIPlanOpen(false)}>
                    <div className="bg-white/95 backdrop-blur-[40px] backdrop-saturate-150 border border-white/60 rounded-[32px] overflow-hidden flex flex-col w-full max-w-sm max-h-[80dvh] shadow-[0_-8px_40px_rgba(0,0,0,0.12)] animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center p-5 border-b border-slate-100 shrink-0">
                            <h3 className="text-xl font-black tracking-tighter text-slate-900 flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></svg>
                                AI 一鍵排程
                            </h3>
                            <button onClick={() => setIsAIPlanOpen(false)} className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-full transition-colors active:scale-95">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar flex-1 pb-40">
                            <div>
                                <p className="text-[13px] font-bold text-slate-500 mb-4 leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center">
                                    AI 將根據 <strong className="text-slate-800 tracking-widest">{selectedDate} 的餐食計畫</strong>，為您自動推薦適合的食譜餐點
                                </p>
                                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 pl-1">客製化需求 (選填)</label>
                                <textarea
                                    className="w-full px-5 py-4 rounded-3xl bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] text-[15px] font-bold text-slate-800 placeholder:font-bold placeholder:text-slate-400 focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none resize-none h-32 transition-all"
                                    placeholder="有什麼特殊要求嗎？\n(例如：早餐盡量不要澱粉、午餐想要便當、這週想吃清淡一點...)"
                                    value={mealPlanPrompt}
                                    onChange={e => setMealPlanPrompt(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="px-6 py-5 shrink-0 border-t border-transparent">
                            <button onClick={handleAIPlan} disabled={isPlanning} className="w-full py-4 rounded-full font-black text-white bg-[#007AFF] shadow-[0_4px_12px_rgba(0,122,255,0.3)] hover:bg-blue-600 active:scale-[0.96] transition-all text-[15px] tracking-widest disabled:opacity-70 disabled:active:scale-100 flex items-center justify-center gap-2">
                                {isPlanning ? (
                                    <><svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> AI 規劃中..</>
                                ) : (
                                    'AI 一鍵排程'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmationModal isOpen={modalConfig.isOpen} title={modalConfig.title} message={modalConfig.message} onConfirm={modalConfig.onConfirm} onCancel={() => setModalConfig(prev => ({ ...prev, isOpen: false }))} isAlert={modalConfig.isAlert} />
        </div>
    );
};

export default MealPlannerView;
