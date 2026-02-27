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
    onConfirm: () => { },
  });

  const [form, setForm] = useState<Recipe>({
    id: '',
    name: '',
    servings: (initialData?.servings as any) || '',
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
              servings: result.servings || prev.servings,
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
          servings: result.servings || prev.servings,
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="space-y-6 pb-10 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <h2 className="text-[20px] font-black tracking-tighter text-slate-800 drop-shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
          {initialData ? '編輯食譜' : '新增食譜'}
        </h2>
      </div>

      {!initialData && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            {/* 🍎 AI 按鈕升級：與 Dashboard 完全相同的 iOS 頂級玻璃浮雕卡片 */}
            <button
              type="button"
              disabled={loading}
              onClick={() => fileInputRef.current?.click()}
              className={`bg-gradient-to-br from-white/95 to-white/40 backdrop-blur-[40px] backdrop-saturate-150 p-6 rounded-[32px] border border-white/60 shadow-[0_24px_48px_rgba(0,0,0,0.06),inset_0_2px_2px_rgba(255,255,255,1)] flex flex-col items-center justify-center text-center cursor-pointer hover:from-white hover:to-white/60 active:scale-[0.96] transition-all group relative overflow-hidden ${loading ? 'opacity-70 cursor-not-allowed' : ''
                }`}
            >
              {loading && loadingMode === 'scan' ? (
                <>
                  <svg className="animate-spin h-7 w-7 text-[#007AFF]" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  <span className="text-[13px] font-black tracking-wide text-[#007AFF] mt-3 animate-pulse">辨識食材...</span>
                </>
              ) : (
                <>
                  <div className="p-3 bg-white rounded-[20px] shadow-[0_4px_12px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_1px_rgba(255,255,255,1)] border border-slate-50/50 text-[#007AFF]">
                    <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg>
                  </div>
                  <span className="text-[14px] font-black tracking-wide text-slate-700 mt-3 group-hover:text-[#007AFF] transition-colors drop-shadow-[0_2px_10px_rgba(0,0,0,0.03)]">拍照轉食譜</span>
                </>
              )}
              <input type="file" ref={fileInputRef} onChange={handleScan} accept="image/*" className="hidden" />
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => setShowUrlInput(true)}
              className={`bg-gradient-to-br from-white/95 to-white/40 backdrop-blur-[40px] backdrop-saturate-150 p-6 rounded-[32px] border border-white/60 shadow-[0_24px_48px_rgba(0,0,0,0.06),inset_0_2px_2px_rgba(255,255,255,1)] flex flex-col items-center justify-center text-center cursor-pointer hover:from-white hover:to-white/60 active:scale-[0.96] transition-all group relative overflow-hidden ${loading ? 'opacity-70 cursor-not-allowed' : ''
                }`}
            >
              {loading && loadingMode === 'youtube' ? (
                <>
                  <svg className="animate-spin h-7 w-7 text-[#FF3B30]" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  <span className="text-[13px] font-black tracking-wide text-[#FF3B30] mt-3 animate-pulse">提取內容...</span>
                </>
              ) : (
                <>
                  <div className="p-3 bg-white rounded-[20px] shadow-[0_4px_12px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_1px_rgba(255,255,255,1)] border border-slate-50/50 text-[#FF3B30]">
                    <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" /><path d="m10 15 5-3-5-3z" /></svg>
                  </div>
                  <span className="text-[14px] font-black tracking-wide text-slate-700 mt-3 group-hover:text-[#FF3B30] transition-colors drop-shadow-[0_2px_10px_rgba(0,0,0,0.03)]">影片轉食譜</span>
                </>
              )}
            </button>
          </div>
          {loading && (
            <p className="text-center text-[11px] text-slate-400 font-bold animate-pulse mt-2 tracking-widest uppercase">
              AI 分析中，這可能需要幾秒鐘...
            </p>
          )}
        </div>
      )}

      {/* URL Input Modal：升級為毛玻璃圓角 */}
      {showUrlInput && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[40px] backdrop-saturate-150 animate-in fade-in duration-200" onClick={() => !loading && setShowUrlInput(false)}>
          <div className="bg-white/80 backdrop-blur-[40px] backdrop-saturate-150 rounded-[32px] border border-white/60 shadow-[0_24px_48px_rgba(0,0,0,0.06),inset_0_2px_2px_rgba(255,255,255,1)] w-full max-w-sm p-8 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <h3 className="font-black tracking-tighter text-xl text-slate-900 mb-2 text-center">貼上連結或內容</h3>
            <p className="text-sm text-slate-500 mb-6 font-bold text-center">AI 會自動分析 YouTube 連結、網址或文字食譜。</p>
            <textarea
              autoFocus
              disabled={loading}
              className="w-full px-5 py-4 rounded-[24px] bg-white border border-white/60 shadow-[0_2px_8px_rgba(0,0,0,0.03)] -[#007AFF]/10 mb-6 resize-none h-32 text-[17px] font-bold text-slate-800 disabled:bg-slate-50 disabled:text-slate-400 transition-all placeholder:font-normal placeholder:text-slate-300 focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
              value={urlOrText}
              onChange={e => setUrlOrText(e.target.value)}
              placeholder="https://youtube.com/watch?v=... 或貼上文字內容"
            />
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowUrlInput(false)}
                disabled={loading}
                className="py-3.5 rounded-full font-black text-slate-500 bg-white border border-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] hover:bg-slate-50 active:scale-[0.96] transition-all disabled:opacity-50 text-sm"
              >
                取消
              </button>
              <button
                onClick={handleUrlAnalysis}
                disabled={loading || !urlOrText.trim()}
                className={`py-3.5 rounded-full font-black text-white shadow-[0_4px_12px_rgba(0,122,255,0.2)] flex items-center justify-center gap-2 transition-all active:scale-[0.96] text-sm ${loading ? 'bg-blue-400 cursor-wait' : 'bg-[#007AFF] hover:bg-blue-600'
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

      {/* 🍎 整個大表單區塊：玻璃透視感 + 32px 大圓角 */}
      <form onSubmit={handleSubmit} className="space-y-5 bg-gradient-to-br from-white/80 to-white/40 backdrop-blur-[40px] backdrop-saturate-150 p-6 rounded-[32px] shadow-[0_24px_48px_rgba(0,0,0,0.06),inset_0_2px_2px_rgba(255,255,255,1)] border border-white/60">
        <div className="space-y-1.5">
          <label className="text-[11px] font-black tracking-widest text-slate-400 uppercase px-1">料理名稱</label>
          <input
            required
            type="text"
            className="w-full px-5 py-4 rounded-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] -[#007AFF]/15 transition-all text-[17px] font-bold text-slate-800 placeholder:text-slate-300 placeholder:font-normal focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            onBlur={handleNameBlur}
            placeholder="例如：番茄炒蛋"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-black tracking-widest text-slate-400 uppercase px-1">份量 (人份)</label>
          <input
            type="number"
            min="1"
            className="w-full px-5 py-4 rounded-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] -[#007AFF]/15 transition-all text-[17px] font-bold text-slate-800 placeholder:text-slate-300 placeholder:font-normal focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
            value={form.servings || ''}
            onChange={e => setForm({ ...form, servings: e.target.value ? parseInt(e.target.value) : undefined })}
            onWheel={e => e.currentTarget.blur()}
            placeholder="例如：2 (人份)"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-black tracking-widest text-slate-400 uppercase px-1">來源連結</label>
          <input
            type="text"
            className="w-full px-5 py-4 rounded-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] -[#007AFF]/15 transition-all text-[17px] font-bold text-slate-800 placeholder:font-normal placeholder:text-slate-300 focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
            value={form.sourceLink || ''}
            onChange={e => setForm({ ...form, sourceLink: e.target.value })}
            placeholder="https://..."
          />
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center gap-2 px-1">
            <label className="text-[11px] font-black tracking-widest text-slate-400 uppercase">智慧標籤 (Tags)</label>
            {isTagLoading && (
              <span className="flex items-center gap-1 text-[10px] text-[#007AFF] font-black tracking-widest animate-pulse">
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                分析中...
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            {form.tags.map(tag => (
              /* 已選標籤：膠囊化、去除多餘邊框 */
              <span key={tag} className="inline-flex items-center gap-1.5 bg-blue-50/80 text-[#007AFF] px-3.5 py-1.5 rounded-full text-sm font-black border border-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] animate-in zoom-in duration-200 tracking-widest">
                {tag}
                <button type="button" onClick={() => toggleTag(tag)} className="hover:text-blue-900 active:scale-90 transition-transform">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                </button>
              </span>
            ))}
          </div>

          {/* 標籤選擇器大框：玻璃透視感 */}
          <div className="border border-white/60 rounded-[28px] overflow-hidden bg-white/80 backdrop-blur-[40px] backdrop-saturate-150 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            {Object.entries(recipeTags).map(([parent, children]: [string, string[]]) => (
              <div key={parent} className="border-b border-white/60 last:border-none">
                <button
                  type="button"
                  onClick={() => setExpandedTagCategory(expandedTagCategory === parent ? null : parent)}
                  className="w-full px-5 py-3.5 flex justify-between items-center bg-white/90 hover:bg-white/80 text-left transition-colors"
                >
                  <span className="text-xs font-black tracking-wider text-slate-700">{parent}</span>
                  <svg className={`text-slate-400 w-4 h-4 transition-transform ${expandedTagCategory === parent ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {expandedTagCategory === parent && (
                  <div className="p-4 flex flex-wrap gap-2.5 bg-white/80 animate-in slide-in-from-top-2">
                    {children.map((child: string) => (
                      <button
                        key={child}
                        type="button"
                        onClick={() => toggleTag(child)}
                        className={`text-xs px-3.5 py-1.5 rounded-full border transition-all active:scale-95 font-bold tracking-wider ${form.tags.includes(child)
                          ? 'bg-[#007AFF] text-white border-[#007AFF] shadow-[0_4px_12px_rgba(0,122,255,0.2)]'
                          : 'bg-white text-slate-500 border-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] hover:border-blue-200 hover:text-[#007AFF]'
                          }`}
                      >
                        {child}
                      </button>
                    ))}
                    {children.length === 0 && <span className="text-[11px] text-slate-400 font-bold">無選項</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 border-t border-white/60 pt-5">
          <div className="flex justify-between items-center px-1">
            <label className="text-[11px] font-black tracking-widest text-slate-400 uppercase">食材準備區</label>
            <span className="text-[10px] font-bold text-slate-400">合併輸入名稱與份量</span>
          </div>
          {form.ingredients.map((ing, idx) => (
            <div key={idx} className="flex gap-2 relative">
              <input
                required
                type="text"
                className="flex-1 px-5 py-4 rounded-full bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] -[#007AFF]/15 transition-all text-[17px] font-bold text-slate-800 placeholder:text-slate-300 placeholder:font-normal focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
                value={ing}
                onChange={e => updateIngredient(idx, e.target.value)}
                placeholder="例如：雞蛋 2顆"
              />
              <button type="button" onClick={() => removeIngredient(idx)} className="text-[#FF3B30] p-3 absolute right-2 top-1.5 hover:bg-red-50 rounded-full transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </div>
          ))}
          {/* 新增食材按鈕：虛線膠囊 */}
          <button type="button" onClick={addIngredient} className="w-full py-4 border-2 border-dashed border-white/60 rounded-full bg-white/80 text-slate-400 text-[15px] font-black tracking-wider hover:border-[#007AFF] hover:text-[#007AFF] hover:bg-white/80 transition-all active:scale-[0.98]">+ 新增食材</button>
        </div>

        <div className="space-y-1.5 border-t border-white/60 pt-5">
          <label className="text-[11px] font-black tracking-widest text-slate-400 uppercase px-1">料理做法區</label>
          <textarea
            required
            className="w-full px-5 py-4 rounded-[24px] bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] -[#007AFF]/15 min-h-[200px] text-[17px] font-bold text-slate-800 leading-relaxed whitespace-pre-wrap placeholder:font-normal placeholder:text-slate-300 focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
            value={form.steps}
            onChange={e => setForm({ ...form, steps: e.target.value })}
            placeholder="AI 會自動分行。您也可以手動輸入：&#10;1. 準備食材...&#10;2. 起油鍋..."
          />
        </div>

        <div className="space-y-1.5 border-t border-white/60 pt-5">
          <label className="text-[11px] font-black tracking-widest text-[#007AFF] uppercase px-1">料理心得 / 評價</label>
          <textarea
            className="w-full px-5 py-4 rounded-[24px] bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] -[#007AFF]/15 min-h-[100px] text-[17px] font-bold text-slate-800 leading-relaxed whitespace-pre-wrap placeholder:font-normal placeholder:text-slate-300 focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none"
            value={form.review || ''}
            onChange={e => setForm({ ...form, review: e.target.value })}
            placeholder="記錄料理成功的小撇步、口味調整或家人評價..."
          />
        </div>

        <div className="grid grid-cols-2 gap-3 pt-6 border-t border-white/60">
          <button type="button" onClick={onCancel} className="w-full bg-white/80 backdrop-blur-[40px] backdrop-saturate-150 text-slate-500 font-black py-4 rounded-full border border-white/60 shadow-[0_2px_8px_rgba(0,0,0,0.03)] active:scale-[0.96] transition-all text-[15px] hover:bg-white tracking-widest">
            取消
          </button>

          {/* 🍎 底部儲存按鈕：移除果凍感，回歸原廠扁平藍與柔光暈 */}
          <button type="submit" className="w-full bg-[#007AFF] text-white font-black py-4 rounded-full shadow-[0_4px_12px_rgba(0,122,255,0.2)] active:scale-[0.96] transition-all text-[15px] tracking-widest border-none hover:bg-blue-600 flex items-center justify-center gap-2">
            儲存食譜
          </button>
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