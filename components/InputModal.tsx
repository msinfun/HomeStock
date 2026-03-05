import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

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
      document.body.style.overflow = 'hidden';
      // Slight delay to ensure focus works after animation starts
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, defaultValue]);

  if (!isOpen) return null;

  const modalContent = (
    <div
      /* 背景遮罩：深色毛玻璃，確保蓋住全站所有元素 */
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[40px] backdrop-saturate-150 animate-in fade-in duration-200"
      onClick={onCancel}
    >
      <div
        /* 🍎 彈窗本體：頂級毛玻璃 + 32px 大圓角 + 頂部高光 */
        className="bg-white/90 backdrop-blur-[40px] backdrop-saturate-150 rounded-[32px] shadow-[0_24px_48px_rgba(0,0,0,0.06),inset_0_2px_2px_rgba(255,255,255,1)] w-full max-w-sm overflow-hidden border border-white/60 animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-8 space-y-5">
          <div className="text-center space-y-2">
            {/* 標題與內文：字距收緊、字重加黑 */}
            <h3 className="text-xl font-black tracking-tighter text-slate-900">{title}</h3>
            {message && <p className="text-sm font-bold text-slate-500 leading-relaxed">{message}</p>}
          </div>

          {/* 🍎 輸入框：與全站統一的膠囊狀白底輸入框 */}
          <input
            ref={inputRef}
            type={inputType}
            className="w-full px-5 py-4 rounded-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] text-[17px] text-center font-bold text-slate-800 placeholder:font-normal placeholder:text-slate-400 transition-all -[#007AFF]/15 focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
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
          {/* 🍎 次要按鈕：純淨白板 */}
          <button
            onClick={onCancel}
            className="py-3.5 rounded-full bg-white text-slate-500 font-black border border-white shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:bg-slate-50 active:scale-[0.96] transition-all text-[15px] tracking-widest"
          >
            {cancelText}
          </button>

          {/* 🍎 確定按鈕：拔除果凍感，回歸扁平 iOS 原廠藍與柔光暈 */}
          <button
            onClick={() => onConfirm(value)}
            className="py-3.5 rounded-full font-black text-white bg-[#007AFF] shadow-[0_4px_12px_rgba(0,122,255,0.2)] border-none hover:bg-blue-600 active:scale-[0.96] transition-all text-[15px] tracking-widest"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? ReactDOM.createPortal(modalContent, document.body) : modalContent;
};

export default InputModal;