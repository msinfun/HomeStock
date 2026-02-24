
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Recipe, RecipeTagStructure } from '../types';
import { recognizeRecipeFromImage, recognizeRecipeFromText, inferRecipeTagsFromTitle } from '../geminiService';
import ConfirmationModal from './ConfirmationModal';

interface AddRecipeViewProps {
  onSave: (recipe: Recipe) => void;
  onCancel: () => void;
  initialData?: Recipe;
  recipeTags: RecipeTagStructure;
}

const AddRecipeView: React.FC<AddRecipeViewProps> = ({ onSave, onCancel, initialData, recipeTags }) => {
  const [loading, setLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<'scan' | 'youtube' | null>(null);
  const [isTagLoading, setIsTagLoading] = useState(false);

  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlOrText, setUrlOrText] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Tag Selection State
  const [expandedTagCategory, setExpandedTagCategory] = useState<string | null>(null);
  const [customTagInput, setCustomTagInput] = useState('');

  // Modal State for Alerts
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    isAlert?: boolean;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const [form, setForm] = useState<Recipe>({
    id: '',
    name: '',
    ingredients: [''],
    steps: '',
    tags: [],
    createdDate: new Date().toISOString(),
    sourceLink: '',
    review: ''
  });

  // Flatten available child tags for AI prompting and validation
  const availableFlatTags = useMemo(() => {
    const tags: string[] = [];
    Object.values(recipeTags).forEach((children: string[]) => tags.push(...children));
    return tags;
  }, [recipeTags]);

  // Helper: Client-side White-list Enforcement
  const filterInvalidTags = (tags: string[]) => {
    if (!tags || !Array.isArray(tags)) return [];
    return tags.filter(t => availableFlatTags.includes(t));
  };

  useEffect(() => {
    if (initialData) setForm(initialData);
  }, [initialData]);

  const handleScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setLoadingMode('scan');
    
    setTimeout(() => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          // Pass available tags to AI
          const result = await recognizeRecipeFromImage(base64, availableFlatTags);
          if (result && result.name) {
            // Strict Filtering
            const validTags = filterInvalidTags(result.tags);
            
            setForm(prev => ({
              ...prev,
              name: result.name || prev.name,
              ingredients: result.ingredients || prev.ingredients,
              steps: result.steps || prev.steps,
              tags: validTags, // Enforce whitelist
              sourceLink: result.sourceLink || prev.sourceLink
            }));
          } else {
            setModalConfig({
              isOpen: true,
              title: '辨識失敗',
              message: 'AI 無法辨識圖片內容，請確認圖片清晰。',
              isAlert: true,
              onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
            });
          }
        } catch (innerError) {
          console.error(innerError);
        } finally {
          setLoading(false);
          setLoadingMode(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.readAsDataURL(file);
    }, 50);
  };

  const handleUrlAnalysis = async () => {
    if (!urlOrText.trim()) return;

    setLoading(true);
    setLoadingMode('youtube');

    try {
      // Pass available tags to AI
      const result = await recognizeRecipeFromText(urlOrText, availableFlatTags);
      if (result) {
        // Strict Filtering
        const validTags = filterInvalidTags(result.tags);

        setForm(prev => ({
          ...prev,
          name: result.name || (result.sourceLink ? '未命名食譜 (請編輯)' : prev.name),
          ingredients: (result.ingredients && result.ingredients.length > 0) ? result.ingredients : prev.ingredients,
          steps: result.steps || prev.steps,
          tags: validTags.length > 0 ? validTags : prev.tags, // Enforce whitelist
          sourceLink: result.sourceLink || prev.sourceLink
        }));
        
        setShowUrlInput(false);
        setUrlOrText('');
        
        if (result.sourceLink && (!result.ingredients || result.ingredients.length === 0)) {
           setModalConfig({
             isOpen: true,
             title: '連結提取成功',
             message: '已提取連結。因 AI 無法直接觀看影片，請手動輸入標題或貼上文字食譜以進行分析。',
             isAlert: true,
             onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
           });
        }
      } else {
        setModalConfig({
          isOpen: true,
          title: '分析失敗',
          message: 'AI 無法分析內容，請確認連結或文字是否正確。',
          isAlert: true,
          onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
        });
      }
    } catch (error) {
      console.error(error);
      setModalConfig({
        isOpen: true,
        title: '分析錯誤',
        message: '分析連結時發生錯誤，請稍後再試。',
        isAlert: true,
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
      });
    } finally {
      setLoading(false);
      setLoadingMode(null);
    }
  };

  const handleNameBlur = async () => {
    if (!form.name.trim() || form.tags.length > 0) return;
    setIsTagLoading(true);
    try {
      const result = await inferRecipeTagsFromTitle(form.name, availableFlatTags);
      if (result && result.tags && result.tags.length > 0) {
        // Strict Filtering
        const validTags = filterInvalidTags(result.tags);
        if (validTags.length > 0) {
           setForm(prev => ({ ...prev, tags: validTags }));
        }
      }
    } catch (error) {
      console.error("Tag inference failed", error);
    } finally {
      setIsTagLoading(false);
    }
  };

  const addIngredient = () => {
    setForm(prev => ({ ...prev, ingredients: [...prev.ingredients, ''] }));
  };

  const updateIngredient = (index: number, value: string) => {
    const next = [...form.ingredients];
    next[index] = value;
    setForm(prev => ({ ...prev, ingredients: next }));
  };

  const removeIngredient = (index: number) => {
    setForm(prev => ({ ...prev, ingredients: prev.ingredients.filter((_, i) => i !== index) }));
  };

  // Tag Logic
  const toggleTag = (tag: string) => {
    setForm(prev => {
      const newTags = prev.tags.includes(tag) 
        ? prev.tags.filter(t => t !== tag)
        : [...prev.tags, tag];
      return { ...prev, tags: newTags };
    });
  };

  const addCustomTag = () => {
    const val = customTagInput.trim();
    if (val && !form.tags.includes(val)) {
      setForm(prev => ({ ...prev, tags: [...prev.tags, val] }));
      setCustomTagInput('');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-black tracking-tighter text-slate-800">
          {initialData ? '編輯食譜' : '新增食譜'}
        </h2>
      </div>

      {!initialData && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <button 
              type="button"
              disabled={loading}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-[32px] p-5 text-white shadow-[0_8px_25px_rgba(0,122,255,0.2)] border-t border-white/40 relative overflow-hidden flex flex-col items-center gap-3 transition-all ${
                loading ? 'bg-blue-400 cursor-not-allowed' : 'bg-[#007AFF] hover:bg-blue-600 active:scale-[0.96]'
              }`}
            >
              {loading && loadingMode === 'scan' ? (
                 <>
                   <svg className="animate-spin h-7 w-7" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                   <span className="text-sm font-black tracking-wide animate-pulse">正在辨識食材...</span>
                 </>
              ) : (
                 <>
                   <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
                   <span className="text-sm font-black tracking-wide">拍照轉食譜</span>
                 </>
              )}
              <input type="file" ref={fileInputRef} onChange={handleScan} accept="image/*" className="hidden" />
              <div className="absolute top-0 right-0 w-20 h-20 bg-white rounded-full -mr-10 -mt-10 opacity-20 blur-xl" />
            </button>

            <button 
              type="button"
              disabled={loading}
              onClick={() => setShowUrlInput(true)}
              className={`rounded-[32px] p-5 text-white shadow-[0_8px_25px_rgba(0,122,255,0.2)] border-t border-white/40 relative overflow-hidden flex flex-col items-center gap-3 transition-all ${
                loading ? 'bg-blue-400 cursor-not-allowed' : 'bg-[#007AFF] hover:bg-blue-600 active:scale-[0.96]'
              }`}
            >
              {loading && loadingMode === 'youtube' ? (
                 <>
                   <svg className="animate-spin h-7 w-7" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                   <span className="text-sm font-black tracking-wide animate-pulse">正在提取內容...</span>
                 </>
              ) : (
                 <>
                   <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/></svg>
                   <span className="text-sm font-black tracking-wide">影片轉食譜</span>
                 </>
              )}
              <div className="absolute top-0 right-0 w-20 h-20 bg-white rounded-full -mr-10 -mt-10 opacity-20 blur-xl" />
            </button>
          </div>
          {loading && (
            <p className="text-center text-xs text-slate-500 font-bold animate-pulse mt-2">
              AI 分析中，這可能需要幾秒鐘...
            </p>
          )}
        </div>
      )}

      {showUrlInput && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md" onClick={() => !loading && setShowUrlInput(false)}>
          <div className="bg-white/90 backdrop-blur-2xl rounded-[32px] border border-white/80 shadow-[0_20px_50px_rgba(0,0,0,0.1)] w-full max-w-sm p-6 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <h3 className="font-black tracking-tighter text-xl text-slate-900 mb-2">貼上連結或內容</h3>
            <p className="text-sm text-slate-500 mb-4 font-bold">AI 會自動分析 YouTube 連結、網址或文字食譜。</p>
            {/* 彈窗內的多行文字框：方圓角 */}
            <textarea 
              autoFocus
              disabled={loading}
              className="w-full px-5 py-4 rounded-2xl bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] outline-none focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] mb-4 resize-none h-32 text-[17px] font-bold text-slate-800 disabled:bg-slate-50 disabled:text-slate-400"
              value={urlOrText}
              onChange={e => setUrlOrText(e.target.value)}
              placeholder="https://youtube.com/watch?v=... 或貼上文字內容"
            />
            <div className="flex gap-3">
              <button 
                onClick={() => setShowUrlInput(false)} 
                disabled={loading}
                className="flex-1 py-4 rounded-full font-black text-slate-500 bg-white border border-white shadow-sm hover:bg-slate-50 active:scale-[0.96] transition-all disabled:opacity-50"
              >
                取消
              </button>
              <button 
                onClick={handleUrlAnalysis} 
                disabled={loading || !urlOrText.trim()}
                className={`flex-1 py-4 rounded-full font-black text-white shadow-[0_8px_20px_rgba(0,122,255,0.3)] border-t border-l border-white/40 border-b border-r border-black/10 flex items-center justify-center gap-2 transition-all active:scale-[0.96] ${
                  loading ? 'bg-blue-400 cursor-wait' : 'bg-[#007AFF] hover:bg-blue-600'
                }`}
              >
                {loading ? (
                  <>
                     <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                     分析中...
                  </>
                ) : (
                  '開始分析'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 整個大表單區塊：玻璃透視感 + 32px 大圓角 */}
      <form onSubmit={handleSubmit} className="space-y-5 bg-white/70 backdrop-blur-xl p-6 rounded-[32px] shadow-[0_12px_40px_rgba(0,0,0,0.06)] border border-white/80">
        <div className="space-y-1">
          <label className="text-xs font-black tracking-wider text-slate-400 uppercase px-1">料理名稱</label>
          {/* 單行輸入框：膠囊狀 */}
          <input 
            required 
            type="text" 
            className="w-full px-5 py-4 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none transition-all text-[17px] font-bold text-slate-800" 
            value={form.name} 
            onChange={e => setForm({...form, name: e.target.value})} 
            onBlur={handleNameBlur}
            placeholder="例如：番茄炒蛋" 
          />
        </div>
        
        <div className="space-y-1">
          <label className="text-xs font-black tracking-wider text-slate-400 uppercase px-1">來源連結</label>
          {/* 單行輸入框：膠囊狀 */}
          <input 
            type="text" 
            className="w-full px-5 py-4 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none transition-all text-[17px] font-bold text-slate-500 placeholder:font-normal" 
            value={form.sourceLink || ''} 
            onChange={e => setForm({...form, sourceLink: e.target.value})} 
            placeholder="https://..." 
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <label className="text-xs font-black tracking-wider text-slate-400 uppercase">智慧標籤 (Tags)</label>
            {isTagLoading && (
               <span className="flex items-center gap-1 text-[10px] text-[#007AFF] font-black tracking-widest animate-pulse">
                 <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                 分析中...
               </span>
            )}
          </div>
          
          <div className="flex flex-wrap gap-2 mb-3">
            {form.tags.map(tag => (
              <span key={tag} className="inline-flex items-center gap-1.5 bg-blue-50/80 text-[#007AFF] px-3.5 py-1.5 rounded-full text-sm font-black border border-white shadow-[0_2px_4px_rgba(0,0,0,0.02)] animate-in zoom-in duration-200">
                {tag}
                <button type="button" onClick={() => toggleTag(tag)} className="hover:text-blue-900 active:scale-90 transition-transform">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </span>
            ))}
          </div>

          {/* 標籤選擇器大框：方圓角 */}
          <div className="border border-white/80 rounded-[28px] overflow-hidden bg-white/50 backdrop-blur-md shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
             {Object.entries(recipeTags).map(([parent, children]: [string, string[]]) => (
                <div key={parent} className="border-b border-white/60 last:border-none">
                   <button 
                     type="button"
                     onClick={() => setExpandedTagCategory(expandedTagCategory === parent ? null : parent)}
                     className="w-full px-5 py-3.5 flex justify-between items-center bg-white/60 hover:bg-white/80 text-left transition-colors"
                   >
                      <span className="text-xs font-black tracking-wider text-slate-700">{parent}</span>
                      <svg className={`text-slate-400 w-4 h-4 transition-transform ${expandedTagCategory === parent ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                   </button>
                   {expandedTagCategory === parent && (
                      <div className="p-4 flex flex-wrap gap-2.5 bg-white/30 animate-in slide-in-from-top-2">
                         {children.map((child: string) => (
                            <button
                              key={child}
                              type="button"
                              onClick={() => toggleTag(child)}
                              className={`text-xs px-3.5 py-1.5 rounded-full border transition-all active:scale-95 font-bold ${
                                 form.tags.includes(child)
                                 ? 'bg-[#007AFF] text-white border-[#007AFF] shadow-md'
                                 : 'bg-white text-slate-500 border-white shadow-sm hover:border-blue-200 hover:text-blue-500'
                              }`}
                            >
                               {child}
                            </button>
                         ))}
                         {children.length === 0 && <span className="text-xs text-slate-400 font-bold">無選項</span>}
                      </div>
                   )}
                </div>
             ))}
             {/* 手動輸入標籤：膠囊 */}
             <div className="p-3 bg-white/60 flex gap-2">
                <input 
                  type="text" 
                  className="flex-1 px-4 py-2 rounded-full bg-white border border-white/80 shadow-sm text-sm outline-none focus:ring-2 focus:ring-[#007AFF]/20 font-bold text-slate-700 placeholder:font-normal"
                  value={customTagInput}
                  onChange={e => setCustomTagInput(e.target.value)}
                  placeholder="手動輸入其他標籤..."
                  onKeyDown={e => { if(e.key === 'Enter') { e.preventDefault(); addCustomTag(); }}}
                />
                <button type="button" onClick={addCustomTag} className="bg-white border border-white shadow-sm text-slate-600 px-4 py-2 rounded-full font-black text-xs hover:bg-slate-50 active:scale-95 transition-all">新增</button>
             </div>
          </div>
        </div>

        <div className="space-y-3 border-t border-white/60 pt-5">
          <div className="flex justify-between items-center px-1">
            <label className="text-xs font-black tracking-wider text-slate-400 uppercase">食材準備區</label>
            <span className="text-[10px] font-bold text-slate-400">合併輸入名稱與份量</span>
          </div>
          {form.ingredients.map((ing, idx) => (
            <div key={idx} className="flex gap-2 relative">
              {/* 單行食材：膠囊狀 */}
              <input 
                required 
                type="text" 
                className="flex-1 px-5 py-4 rounded-full bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none transition-all text-[17px] font-bold text-slate-800" 
                value={ing} 
                onChange={e => updateIngredient(idx, e.target.value)} 
                placeholder="例如：雞蛋 2顆" 
              />
              <button type="button" onClick={() => removeIngredient(idx)} className="text-[#FF3B30] p-3 absolute right-2 top-1.5 hover:bg-red-50 rounded-full transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
          ))}
          {/* 新增食材按鈕：膠囊虛線框 */}
          <button type="button" onClick={addIngredient} className="w-full py-4 border-2 border-dashed border-slate-300 rounded-full bg-white/50 text-slate-400 text-sm font-black tracking-wider hover:border-[#007AFF] hover:text-[#007AFF] hover:bg-white transition-all active:scale-[0.98]">+ 新增食材</button>
        </div>

        <div className="space-y-1 border-t border-white/60 pt-5">
          <label className="text-xs font-black tracking-wider text-slate-400 uppercase px-1">料理做法區</label>
          {/* 多行步驟：方圓角 */}
          <textarea 
            required 
            className="w-full px-5 py-4 rounded-2xl bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none min-h-[200px] text-[17px] font-bold text-slate-800 leading-relaxed whitespace-pre-wrap placeholder:font-normal" 
            value={form.steps} 
            onChange={e => setForm({...form, steps: e.target.value})} 
            placeholder="AI 會自動分行。您也可以手動輸入：&#10;1. 準備食材...&#10;2. 起油鍋..." 
          />
        </div>

        {/* Review Section */}
        <div className="space-y-1 border-t border-white/60 pt-5">
          <label className="text-xs font-black tracking-wider text-[#007AFF] uppercase px-1">料理心得 / 評價</label>
          {/* 多行心得：方圓角 */}
          <textarea 
            className="w-full px-5 py-4 rounded-2xl bg-white border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] outline-none min-h-[100px] text-[17px] font-bold text-slate-800 leading-relaxed whitespace-pre-wrap placeholder:font-normal" 
            value={form.review || ''} 
            onChange={e => setForm({...form, review: e.target.value})} 
            placeholder="記錄料理成功的小撇步、口味調整或家人評價..." 
          />
        </div>

        <div className="grid grid-cols-2 gap-3 pt-6 border-t border-white/60">
          {/* 底部按鈕：膠囊狀 */}
          <button type="button" onClick={onCancel} className="w-full bg-white text-slate-500 font-black py-4 rounded-full border border-white shadow-sm hover:bg-slate-50 active:scale-[0.96] transition-all">取消</button>
          
          {/* 底部儲存按鈕：膠囊狀 + 立體亮邊 */}
          <button type="submit" className="w-full bg-[#007AFF] text-white font-black py-4 rounded-full shadow-[0_10px_25px_rgba(0,122,255,0.3)] border-t border-l border-white/40 border-b border-r border-black/10 active:scale-[0.96] transition-all hover:bg-blue-600">儲存食譜</button>
        </div>
      </form>

      <ConfirmationModal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        message={modalConfig.message}
        confirmText="確定"
        isAlert={modalConfig.isAlert}
        onConfirm={modalConfig.onConfirm}
      />
    </div>
  );
};

export default AddRecipeView;
