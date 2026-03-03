import React from 'react';
import ReactDOM from 'react-dom';

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

  const modalContent = (
    <div
      /* 背景遮罩：深色毛玻璃，確保蓋住全站所有元素 */
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-[40px] backdrop-saturate-150 transition-opacity p-4 animate-in fade-in duration-200"
      onClick={isAlert && onConfirm ? onConfirm : undefined}
    >
      <div
        /* 🍎 彈窗本體：頂級毛玻璃 + 32px 大圓角 */
        className="bg-white/90 backdrop-blur-md rounded-[32px] shadow-[0_2px_10px_rgba(0,0,0,0.03)] w-full max-w-sm overflow-hidden border border-white/60 animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-8 text-center space-y-3">
          <h3 className="text-xl font-black tracking-tighter text-slate-900">{title}</h3>
          <p className="text-sm font-bold text-slate-500 leading-relaxed whitespace-pre-line">{message}</p>
        </div>

        <div className={`grid ${isAlert ? 'grid-cols-1' : (onOther ? 'grid-cols-3' : 'grid-cols-2')} gap-3 px-6 pb-6`}>
          {!isAlert && onCancel && (
            /* 次要按鈕：純淨白板 */
            <button
              onClick={onCancel}
              className="py-3.5 rounded-full bg-white text-slate-500 font-black border border-white shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:bg-slate-50 active:scale-[0.96] transition-all text-[15px] tracking-widest"
            >
              {cancelText}
            </button>
          )}

          {onOther && !isAlert && (
            /* 第三選項按鈕：純淨白板 */
            <button
              onClick={onOther}
              className="py-3.5 rounded-full bg-white text-slate-500 font-black border border-white shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:bg-slate-50 active:scale-[0.96] transition-all text-[15px] tracking-widest"
            >
              {otherText}
            </button>
          )}

          {/* 🍎 確認按鈕：拔除果凍感，回歸扁平 iOS 原廠藍與柔光暈 */}
          <button
            onClick={onConfirm}
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

export default ConfirmationModal;