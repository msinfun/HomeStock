import React from 'react';
import { ViewState } from '../types';

interface NavbarProps {
  activeView: ViewState;
  setActiveView: (view: ViewState) => void;
  onAddClick: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ activeView, setActiveView, onAddClick }) => {
  return (
    <nav
      /* 🍎 導覽列底板：頂級毛玻璃 + 飽和度增豔 + 頂底雙重微反光 */
      className="fixed bottom-8 left-6 right-6 max-w-[416px] mx-auto bg-white/80 backdrop-blur-[40px] backdrop-saturate-150 rounded-full flex justify-around items-center h-[72px] z-50 transition-all duration-500 border border-white/60 shadow-[0_24px_48px_rgba(0,0,0,0.06),inset_0_2px_2px_rgba(255,255,255,1)] px-2"
    >

      {/* 1. Dashboard (總覽) */}
      <button
        onClick={() => setActiveView('dashboard')}
        className={`flex flex-col items-center justify-center gap-1 flex-1 h-full transition-all active:scale-[0.92] ${activeView === 'dashboard' ? 'text-[#007AFF]' : 'text-slate-400 hover:text-slate-500'
          }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={activeView === 'dashboard' ? 'drop-shadow-[0_2px_10px_rgba(0,0,0,0.03)]' : ''}><rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="9" x="14" y="12" rx="1" /><rect width="7" height="5" x="3" y="16" rx="1" /></svg>
        <span className={`text-[10px] font-black tracking-widest ${activeView === 'dashboard' ? 'text-[#007AFF]' : 'text-slate-400'}`}>總覽</span>
      </button>

      {/* 2. Inventory (庫存) */}
      <button
        onClick={() => setActiveView('inventory')}
        className={`flex flex-col items-center justify-center gap-1 flex-1 h-full transition-all active:scale-[0.92] ${activeView === 'inventory' ? 'text-[#007AFF]' : 'text-slate-400 hover:text-slate-500'
          }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={activeView === 'inventory' ? 'drop-shadow-[0_2px_10px_rgba(0,0,0,0.03)]' : ''}><path d="m7.5 4.27 9 5.15" /><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>
        <span className={`text-[10px] font-black tracking-widest ${activeView === 'inventory' ? 'text-[#007AFF]' : 'text-slate-400'}`}>庫存</span>
      </button>

      {/* 3. Central ADD Button (中央加號) */}
      <div className="flex flex-col items-center justify-center flex-1 h-full">
        {/* 🍎 加號按鈕：移除果凍框線，回歸純淨原廠藍與柔和光暈 */}
        <button
          onClick={onAddClick}
          className="bg-[#007AFF] text-white w-[52px] h-[52px] rounded-full flex items-center justify-center transition-all active:scale-[0.92] shadow-[0_4px_12px_rgba(0,122,255,0.2)] border-none hover:bg-blue-600"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
        </button>
      </div>

      {/* 4. Recipes (食譜) */}
      <button
        onClick={() => setActiveView('recipes')}
        className={`flex flex-col items-center justify-center gap-1 flex-1 h-full transition-all active:scale-[0.92] ${activeView === 'recipes' ? 'text-[#007AFF]' : 'text-slate-400 hover:text-slate-500'
          }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={activeView === 'recipes' ? 'drop-shadow-[0_2px_10px_rgba(0,0,0,0.03)]' : ''}><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /><path d="M8 7h6" /><path d="M8 11h8" /></svg>
        <span className={`text-[10px] font-black tracking-widest ${activeView === 'recipes' ? 'text-[#007AFF]' : 'text-slate-400'}`}>食譜</span>
      </button>

      {/* 5. Shopping (待買) */}
      <button
        onClick={() => setActiveView('shopping')}
        className={`flex flex-col items-center justify-center gap-1 flex-1 h-full transition-all active:scale-[0.92] ${activeView === 'shopping' ? 'text-[#007AFF]' : 'text-slate-400 hover:text-slate-500'
          }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={activeView === 'shopping' ? 'drop-shadow-[0_2px_10px_rgba(0,0,0,0.03)]' : ''}><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></svg>
        <span className={`text-[10px] font-black tracking-widest ${activeView === 'shopping' ? 'text-[#007AFF]' : 'text-slate-400'}`}>待買</span>
      </button>

    </nav>
  );
};

export default Navbar;