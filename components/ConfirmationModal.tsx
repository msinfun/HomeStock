import React from 'react';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
  onOther?: () => void;
  otherText?: string;
  isAlert?: boolean;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen, title, message, onConfirm, onCancel, confirmText = '確定', cancelText = '取消', onOther, otherText, isAlert = false
}) => {
  if (!isOpen) return null;

  return (
    <div 
      /* 背景遮罩：加深毛玻璃效果，並將 z-index 拉高確保蓋住所有東西 */
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-md transition-opacity p-4" 
      onClick={isAlert && onConfirm ? onConfirm : undefined}
    >
      <div 
        /* 彈窗本體：32px 大圓角、強烈毛玻璃、發亮白邊與進場彈出動畫 */
        className="bg-white/80 backdrop-blur-2xl rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.1)] w-full max-w-sm overflow-hidden border border-white/80 animate-in zoom-in-95 duration-200" 
        onClick={e => e.stopPropagation()}
      >
        <div className="p-8 text-center space-y-3">
          {/* 標題與內文：字距收緊、字重加黑 */}
          <h3 className="text-xl font-black tracking-tighter text-slate-900">{title}</h3>
          <p className="text-sm font-bold text-slate-500 leading-relaxed whitespace-pre-line">{message}</p>
        </div>
        
        {/* 按鈕區塊：移除原本醜醜的灰底，改用留白與膠囊按鈕 */}
        <div className={`grid ${isAlert ? 'grid-cols-1' : (onOther ? 'grid-cols-3' : 'grid-cols-2')} gap-3 p-6 pt-0`}>
           {!isAlert && onCancel && (
             <button
              onClick={onCancel}
              className="py-3.5 rounded-full bg-white text-slate-500 font-black border border-white shadow-sm hover:bg-slate-50 active:scale-[0.96] transition-all text-sm"
             >
               {cancelText}
             </button>
           )}
           
           {onOther && !isAlert && (
             <button
              onClick={onOther}
              className="py-3.5 rounded-full bg-white text-slate-500 font-black border border-white shadow-sm hover:bg-slate-50 active:scale-[0.96] transition-all text-sm"
             >
               {otherText}
             </button>
           )}
           
           {/* 確認按鈕：保留立體光暈與深色陰影 */}
           <button
            onClick={onConfirm}
            className="py-3.5 rounded-full font-black text-white bg-[#007AFF] shadow-[0_8px_20px_rgba(0,122,255,0.3)] border-t border-l border-white/40 border-b border-r border-black/10 hover:bg-blue-600 active:scale-[0.96] transition-all text-sm"
           >
             {confirmText}
           </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;