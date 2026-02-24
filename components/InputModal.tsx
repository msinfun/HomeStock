import React, { useState, useEffect, useRef } from 'react';

interface InputModalProps {
  isOpen: boolean;
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  inputType?: 'text' | 'number';
}

const InputModal: React.FC<InputModalProps> = ({
  isOpen, title, message, defaultValue = '', placeholder = '', onConfirm, onCancel, confirmText = '確定', cancelText = '取消', inputType = 'text'
}) => {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue);
      // Slight delay to ensure focus works after animation starts
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, defaultValue]);

  if (!isOpen) return null;

  return (
    <div 
      /* 背景遮罩：加深毛玻璃效果，點擊背景可取消 */
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-200" 
      onClick={onCancel}
    >
      <div 
        /* 彈窗本體：32px 大圓角、強烈毛玻璃、發亮白邊與進場彈出動畫 */
        className="bg-white/80 backdrop-blur-2xl rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-white/80 w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200" 
        onClick={e => e.stopPropagation()}
      >
        <div className="p-8 space-y-5">
          <div className="text-center space-y-2">
            {/* 標題與內文：字距收緊、字重加黑 */}
            <h3 className="text-xl font-black tracking-tighter text-slate-900">{title}</h3>
            {message && <p className="text-sm font-bold text-slate-500 leading-relaxed">{message}</p>}
          </div>
          
          {/* 輸入框：全圓角膠囊、細白亮框、聚焦時發出藍色微光 */}
          <input
            ref={inputRef}
            type={inputType}
            className="w-full px-5 py-4 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] outline-none text-[17px] text-center font-bold text-slate-800 placeholder:font-normal placeholder:text-slate-400 transition-all focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF]"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConfirm(value);
            }}
          />
        </div>
        
        {/* 按鈕區塊：並排膠囊按鈕 */}
        <div className="grid grid-cols-2 gap-3 p-6 pt-0">
           {/* 取消按鈕 */}
           <button
            onClick={onCancel}
            className="py-3.5 rounded-full bg-white text-slate-500 font-black border border-white shadow-sm hover:bg-slate-50 active:scale-[0.96] transition-all text-sm"
           >
             {cancelText}
           </button>

           {/* 確定按鈕：立體光暈與深色陰影 */}
           <button
            onClick={() => onConfirm(value)}
            className="py-3.5 rounded-full font-black text-white bg-[#007AFF] shadow-[0_8px_20px_rgba(0,122,255,0.3)] border-t border-l border-white/40 border-b border-r border-black/10 hover:bg-blue-600 active:scale-[0.96] transition-all text-sm"
           >
             {confirmText}
           </button>
        </div>
      </div>
    </div>
  );
};

export default InputModal;