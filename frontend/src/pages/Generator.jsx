import React, { useState, useEffect, useRef } from 'react';
import api from '../utils/api';
import { Sparkles, Loader, Download, ExternalLink, AlertTriangle, Terminal, X, ChevronRight, Upload, Image as ImageIcon, Zap, Sliders } from 'lucide-react';

const LAYOUT_STYLES = [
  { value: 'cooking_grid', label: 'Cinematic Dark Storyboard Grid', desc: 'Gelap/Premium' },
  { value: 'video_table', label: 'Clean Product Video Presentation Sheet', desc: 'Cream/Editorial' },
  { value: 'product_identity', label: 'Luxury Product Specs Infographic', desc: 'Minimalis/Bersih' },
  { value: 'ugc_guide', label: 'Social UGC Action Storyboard', desc: 'Vlog/Vibrant' },
  { value: 'yellow_badge_storyboard', label: 'Yellow Badge Commercial Storyboard', desc: 'Bersih/Kuning (Tas Sekolah)' },
  { value: 'female_editorial_table', label: 'Burgundy Editorial Script Table', desc: 'Elegan/Burgundy (Kemeja Wanita)' },
  { value: 'creative_diy_kids', label: 'Creative Kids Playful Storyboard', desc: 'Ceria/Warna-warni (Art Paint)' },
  { value: 'blue_pastel_asmr', label: 'Blue Pastel UGC ASMR Review', desc: 'Estetik/Biru (Aimilo)' },
  { value: 'minimalist_unboxing_grid', label: 'Minimalist Unboxing Rounded Grid', desc: 'Bersih/Minimalis (Blender)' },
  { value: 'cinematic_overlay', label: 'Full Bleed Cinematic Storyboard', desc: 'Gelap/Cinematic Overlay (RC Train)' },
  { value: 'baking_timeline', label: 'Classic Cooking/Baking Timeline', desc: 'Cream Timeline (Bread Homemade)' },
  { value: 'frame_strip', label: '3-Column Multi-Angle Progression Strip', desc: 'Strip Grid (Tamagoyaki)' },
  { value: 'pencil_sketch', label: 'Vintage Crew Charcoal Pencil Sketch', desc: 'Hitam Putih Sketsa (Horror House)' },
  { value: 'animation_bible', label: '3D Animation Bible & Pitch Sheet', desc: 'Gelap/Biru Pixar (The Last Shot)' },
  { value: 'lego_diy', label: 'DIY Lego/Brick Assembly Storyboard', desc: 'Ceria/Lego Builder (RM Padang)' },
  { value: 'mecha_review', label: 'Tech Mecha Action Figure Review Columns', desc: 'Gelap/Tech Blue (Gundam ASMR)' },
  { value: 'anime_lego_storyboard', label: '2D Anime Lego Assembly Storyboard', desc: 'Anime/Makoto Shinkai (Lego Beat)' },
  { value: 'toy_commercial', label: 'Toy Commercial Storyboard with Text Overlays', desc: 'Biru/Mobil Mainan (Die-Cast)' },
  { value: 'cartoon_script_grid', label: 'Cute Cartoon Storyboard with Script Table', desc: 'Bersih/3D Kartun (Ibu Rumah Tangga)' }
];

export default function Generator() {
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('cooking_grid');
  const [apiKeyId, setApiKeyId] = useState('');
  const [apiKeys, setApiKeys] = useState([]);
  const [gridCount, setGridCount] = useState(6);
  const [model, setModel] = useState('80');
  const [duration, setDuration] = useState(15);
  const [showFace, setShowFace] = useState(false);
  const [currentCarouselIdx, setCurrentCarouselIdx] = useState(0);
  
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hoveredStyle, setHoveredStyle] = useState(null);
  const dropdownRef = useRef(null);
  
  const [refImageBase64, setRefImageBase64] = useState('');
  const [refImageUrl, setRefImageUrl] = useState('');
  const [refImagePreview, setRefImagePreview] = useState('');
  
  const [tokopediaUrl, setTokopediaUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scrapedImages, setScrapedImages] = useState([]);

  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  const [generating, setGenerating] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState(null);
  const [taskLogs, setTaskLogs] = useState('');
  const [showLogModal, setShowLogModal] = useState(true);
  
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loadingKeys, setLoadingKeys] = useState(true);
  
  const pollIntervalRef = useRef(null);
  const logEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const fetchKeys = async () => {
    try {
      const res = await api.get('/storyboards/keys');
      setApiKeys(res.data);
      if (res.data.length > 0) setApiKeyId(res.data[0].id);
    } catch (err) {
      console.error('Gagal mengambil kunci API:', err);
    } finally {
      setLoadingKeys(false);
    }
  };

  const startPolling = (taskId) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await api.get(`/storyboards/tasks/${taskId}`);
        const { status, logs, result: taskResult, error: taskError } = res.data;
        setTaskLogs(logs || '');
        if (status === 'success') {
          setResult(taskResult);
          setGenerating(false);
          localStorage.removeItem('activeTaskId');
          clearInterval(pollIntervalRef.current);
        } else if (status === 'failed') {
          setError(taskError || 'Gagal men-generate gambar.');
          setGenerating(false);
          localStorage.removeItem('activeTaskId');
          clearInterval(pollIntervalRef.current);
        }
      } catch (err) {
        if (err.response?.status === 404) {
          setError('Koneksi tugas terputus. Silakan periksa tab Dashboard atau coba generate ulang.');
          setGenerating(false);
          localStorage.removeItem('activeTaskId');
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        }
      }
    }, 2000);
  };

  useEffect(() => {
    fetchKeys();
    const savedTaskId = localStorage.getItem('activeTaskId');
    if (savedTaskId) {
      setCurrentTaskId(savedTaskId);
      setGenerating(true);
      setTaskLogs('Menyambungkan kembali ke proses latar belakang...\n');
      startPolling(savedTaskId);
    }
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
  }, []);

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [taskLogs, showLogModal]);

  useEffect(() => {
    if (result) setCurrentCarouselIdx(0);
  }, [result]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
        setHoveredStyle(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setRefImagePreview(reader.result);
      setRefImageBase64(reader.result);
      setRefImageUrl('');
    };
    reader.readAsDataURL(file);
  };

  const clearRefImage = () => {
    setRefImageBase64('');
    setRefImageUrl('');
    setRefImagePreview('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleScrape = async (e) => {
    e.preventDefault();
    if (!tokopediaUrl) return;
    setScraping(true);
    setError('');
    setScrapedImages([]);
    try {
      const res = await api.post('/storyboards/scrape', { url: tokopediaUrl });
      const { title: scrapedTitle, description: scrapedDesc, images } = res.data;
      setTitle(scrapedTitle || '');
      setPrompt(scrapedDesc ? scrapedDesc.substring(0, 500) + '...' : '');
      setScrapedImages(images || []);
      if (images && images.length > 0) {
        setRefImageUrl(images[0]);
        setRefImagePreview(images[0]);
        setRefImageBase64('');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal mengambil data dari Tokopedia.');
    } finally {
      setScraping(false);
    }
  };

  const handleGenerateAiPrompt = async () => {
    if (!aiInput.trim()) return;
    setAiLoading(true);
    setAiError('');
    try {
      const res = await api.post('/ai/write-prompt', { concept: aiInput });
      const { title: aiTitle, description: aiDesc, layout: aiLayout } = res.data;
      setTitle(aiTitle || '');
      setPrompt(aiDesc || '');
      if (aiLayout) {
        setStyle(aiLayout);
      }
      setAiInput('');
    } catch (err) {
      setAiError(err.response?.data?.message || 'Gagal generate prompt dengan AI.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!apiKeyId) { setError('Admin belum mengonfigurasi API Key.'); return; }
    setError('');
    setResult(null);
    setTaskLogs('');
    setGenerating(true);
    try {
      const res = await api.post('/storyboards/generate', { 
        title, 
        prompt, 
        style, 
        apiKeyId, 
        refImageBase64, 
        refImageUrl, 
        gridCount, 
        model, 
        duration,
        showFace 
      });
      const { taskId } = res.data;
      setCurrentTaskId(taskId);
      localStorage.setItem('activeTaskId', taskId);
      setTaskLogs('Menugaskan pekerjaan ke server latar belakang...\n');
      startPolling(taskId);
    } catch (err) {
      setError(err.response?.data?.message || 'Proses generate gagal.');
      setGenerating(false);
    }
  };

  const getFullImageUrl = (path) => {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    const API_BASE = window.location.port === '5033' ? 'http://localhost:5022' : '';
    return `${API_BASE}${path}`;
  };

  const getPreviewUrl = (styleName) => {
    if (!styleName) return '';
    const API_BASE = window.location.port === '5033' ? 'http://localhost:5022' : '';
    return `${API_BASE}/uploads/previews/${styleName}.png`;
  };

  return (
    <div className="p-8 space-y-8 animate-fadeIn relative">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#1a1918]/60 border border-[#2a2725] p-6 rounded-3xl backdrop-blur-md">
        <div>
          <h1 className="text-4xl font-editorial italic text-white tracking-tight flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-[#cfae80] fill-[#cfae80]/10" />
            Generator Storyboard AI
          </h1>
          <p className="text-slate-400 text-xs mt-1.5 font-medium tracking-wide">Ciptakan visualisasi alur storyboard video promosi berkualitas tinggi secara instan.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <form onSubmit={handleGenerate} className="lg:col-span-5 bg-[#1a1918]/60 border border-[#2a2725] rounded-3xl p-6 space-y-6 backdrop-blur-md relative">
          <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/25 to-transparent"></div>
          <div className="flex items-center gap-2 border-b border-[#2a2725] pb-3.5">
            <Sliders className="w-4 h-4 text-[#cfae80]" />
            <h3 className="text-[10px] font-bold text-white uppercase tracking-widest">Parameter Kreatif</h3>
          </div>

          <div className="bg-[#131211]/50 border border-[#2a2725] rounded-2xl p-4 space-y-3">
            <label className="block text-slate-350 text-[10px] font-bold uppercase tracking-widest">Auto-Fill via Link Tokopedia (Opsional)</label>
            <div className="flex gap-2">
              <input type="text" value={tokopediaUrl} onChange={(e) => setTokopediaUrl(e.target.value)} className="flex-grow bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-700 focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all" placeholder="Masukkan URL produk Tokopedia..." disabled={scraping || generating} />
              <button type="button" onClick={handleScrape} disabled={scraping || generating || !tokopediaUrl} className="bg-[#cfae80]/10 border border-[#cfae80]/20 hover:bg-[#cfae80] hover:text-black text-[#cfae80] font-bold text-xs px-4 py-2 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center shrink-0">{scraping ? <Loader className="animate-spin w-4 h-4" /> : 'Isi Form'}</button>
            </div>
            {scrapedImages.length > 0 && (
              <div className="space-y-2 pt-2.5 border-t border-[#2a2725]">
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Pilih Gambar Produk:</span>
                <div className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-thin">
                  {scrapedImages.map((imgUrl, idx) => (
                    <button key={idx} type="button" onClick={() => { setRefImageUrl(imgUrl); setRefImagePreview(imgUrl); setRefImageBase64(''); }} className={`relative shrink-0 w-12 h-12 rounded-lg overflow-hidden border transition-all ${refImageUrl === imgUrl ? 'border-[#cfae80] ring-1 ring-[#cfae80]/30' : 'border-[#2a2725] hover:border-slate-650'}`}>
                      <img src={imgUrl} alt={`Scraped ${idx}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* AI PROMPT WRITER SECTION */}
          <div className="bg-[#131211]/50 border border-[#2a2725]/60 hover:border-[#cfae80]/20 rounded-2xl p-4.5 space-y-3 transition-colors relative">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[#cfae80]" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#cfae80]">AI Prompt Assistant</span>
            </div>
            
            <div className="flex gap-2">
              <input
                type="text"
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                placeholder="Tulis ide kasar (misal: iklan parfum mewah)"
                className="flex-grow bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-700 focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all"
                disabled={aiLoading || generating}
              />
              <button
                type="button"
                onClick={handleGenerateAiPrompt}
                className="bg-[#cfae80] hover:bg-[#c5a880] text-black font-extrabold px-4 py-2.5 rounded-xl transition-all text-[10px] uppercase tracking-widest shrink-0 flex items-center justify-center min-w-[90px]"
                disabled={aiLoading || generating || !aiInput.trim()}
              >
                {aiLoading ? <Loader className="animate-spin w-3.5 h-3.5" /> : 'Tulis AI'}
              </button>
            </div>
            
            {aiError && (
              <p className="text-[9px] text-red-400 mt-1 font-medium">{aiError}</p>
            )}
          </div>

          <div>
            <label className="block text-slate-350 text-[10px] font-bold uppercase tracking-widest mb-2">Judul Proyek</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full bg-black/40 border border-[#2a2725] rounded-2xl px-4 py-3 text-white placeholder-slate-700 focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-sm" placeholder="Contoh: Iklan Mainan Anak Lego" required disabled={generating} />
          </div>

          <div>
            <label className="block text-slate-350 text-[10px] font-bold uppercase tracking-widest mb-2">Deskripsi Video / Ide Utama</label>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} className="w-full bg-black/40 border border-[#2a2725] rounded-2xl px-4 py-3 text-white placeholder-slate-700 focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-sm resize-none" placeholder="Jelaskan alur, aksi produk, atau ide utama cerita..." required disabled={generating} />
          </div>

          <div className="relative" ref={dropdownRef}>
            <label className="block text-slate-350 text-[10px] font-bold uppercase tracking-widest mb-2">Gaya Layout Storyboard</label>
            <button type="button" onClick={() => setDropdownOpen(!dropdownOpen)} className="w-full bg-black/40 border border-[#2a2725] rounded-2xl px-4 py-3.5 text-white focus:outline-none focus:border-[#cfae80] transition-all text-sm text-left flex justify-between items-center" disabled={generating}>
              <span className="truncate">{LAYOUT_STYLES.find(opt => opt.value === style)?.label || 'Pilih Gaya Layout'}</span>
              <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${dropdownOpen ? 'rotate-90' : ''}`} />
            </button>
            {dropdownOpen && (
              <div className="absolute left-0 mt-2 w-full bg-[#1a1918] border border-[#2a2725] rounded-2xl shadow-2xl z-50 flex max-h-96">
                <div className="flex-grow overflow-y-auto py-2 divide-y divide-[#2a2725] scrollbar-thin">
                  {LAYOUT_STYLES.map((opt) => (
                    <button key={opt.value} type="button" onClick={() => { setStyle(opt.value); setDropdownOpen(false); setHoveredStyle(null); }} onMouseEnter={() => setHoveredStyle(opt.value)} onMouseLeave={() => setHoveredStyle(null)} className={`w-full text-left px-4 py-3 hover:bg-[#cfae80]/10 text-xs transition-colors flex flex-col gap-1 ${style === opt.value ? 'bg-[#cfae80]/20 text-white font-bold' : 'text-slate-300'}`}>
                      <span className="truncate">{opt.label}</span>
                      <span className="text-[10px] text-slate-500 font-normal">{opt.desc}</span>
                    </button>
                  ))}
                </div>
                {hoveredStyle && (
                  <div className="absolute left-full top-0 ml-3 bg-[#1a1918] border border-[#2a2725] p-2.5 rounded-2xl shadow-2xl w-60 h-80 flex flex-col justify-between z-50 animate-fadeIn pointer-events-none">
                    <div className="flex-grow overflow-hidden rounded-xl border border-[#2a2725] bg-black/40"><img src={getPreviewUrl(hoveredStyle)} alt={`Preview ${hoveredStyle}`} className="w-full h-full object-cover object-top" /></div>
                    <div className="mt-2 text-center"><span className="text-[9px] font-extrabold text-[#cfae80] uppercase tracking-wider block truncate">{LAYOUT_STYLES.find(opt => opt.value === hoveredStyle)?.label}</span></div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-350 text-[10px] font-bold uppercase tracking-widest mb-2">Jumlah Panel</label>
              <select value={gridCount} onChange={(e) => setGridCount(Number(e.target.value))} className="w-full bg-black/40 border border-[#2a2725] rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs" disabled={generating}>
                <option value={4}>4 Panel</option>
                <option value={6}>6 Panel</option>
                <option value={8}>8 Panel</option>
                <option value={9}>9 Panel</option>
                <option value={12}>12 Panel</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-355 text-[10px] font-bold uppercase tracking-widest mb-2">Durasi Video</label>
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-full bg-black/40 border border-[#2a2725] rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs" disabled={generating}>
                <option value={15}>15 Detik</option>
                <option value={30}>30 Detik</option>
                <option value={45}>45 Detik</option>
                <option value={60}>60 Detik</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-350 text-[10px] font-bold uppercase tracking-widest mb-2">Model Generator AI</label>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full bg-black/40 border border-[#2a2725] rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs" disabled={generating}>
              <option value="80">Nano Banana 2 (Model 80)</option>
              <option value="64">Nano Banana Pro (Model 64)</option>
              <option value="108">GPT-Image 2 (Model 108)</option>
              <option value="100">Wan V2.7 Pro (Model 100)</option>
              <option value="99">Wan V2.7 (Model 99)</option>
            </select>
          </div>

          {apiKeys.length > 0 && (
            <div>
              <label className="block text-slate-350 text-[10px] font-bold uppercase tracking-widest mb-2">Pilih API Key Freebeat</label>
              <select 
                value={apiKeyId} 
                onChange={(e) => setApiKeyId(e.target.value)} 
                className="w-full bg-black/40 border border-[#2a2725] rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs"
                disabled={generating}
              >
                {apiKeys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-3 bg-black/20 border border-[#2a2725] rounded-2xl p-4 transition-all hover:border-[#cfae80]/30">
            <input 
              type="checkbox" 
              id="showFace" 
              checked={showFace} 
              onChange={(e) => setShowFace(e.target.checked)} 
              className="w-4.5 h-4.5 rounded border-[#2a2725] bg-black text-[#cfae80] focus:ring-0 focus:ring-offset-0 cursor-pointer accent-[#cfae80]"
              disabled={generating}
            />
            <label htmlFor="showFace" className="text-xs font-bold text-slate-350 cursor-pointer select-none">
              Tampilkan Wajah Manusia
              <span className="block text-[9px] text-slate-500 font-normal mt-0.5">Aktifkan jika ingin menyertakan wajah manusia (Aksi wajah rentan ditolak filter AI).</span>
            </label>
          </div>

          <button type="submit" disabled={generating || apiKeys.length === 0} className="w-full bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-3.5 px-4 rounded-2xl transition-all shadow-lg hover:shadow-[#cfae80]/10 disabled:opacity-50 flex items-center justify-center gap-2 text-xs uppercase tracking-widest">
            {generating ? <><Loader className="animate-spin w-4 h-4" /> Memproses...</> : <><Sparkles className="w-4 h-4" /> Generate Storyboard AI</>}
          </button>
        </form>

        <div className="lg:col-span-7 bg-[#1a1918]/60 border border-[#2a2725] rounded-3xl p-6 min-h-[500px] flex flex-col justify-between relative overflow-hidden backdrop-blur-md">
          <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/25 to-transparent"></div>
          <div className="flex justify-between items-center mb-5 border-b border-[#2a2725] pb-3.5">
            <h3 className="text-[10px] font-bold text-white uppercase tracking-widest flex items-center gap-2"><ImageIcon className="w-4 h-4 text-[#cfae80]" /> Hasil Visualisasi</h3>
          </div>

          {generating ? (
            <div className="flex-grow flex flex-col items-center justify-center py-16 space-y-6">
              <div className="relative flex items-center justify-center"><Loader className="animate-spin text-[#cfae80] w-12 h-12" /><Zap className="absolute text-[#cfae80] w-4 h-4 fill-[#cfae80]/10 animate-pulse" /></div>
              <div className="text-center max-w-sm"><p className="text-white font-editorial italic text-lg">Membuat Storyboard AI...</p><p className="text-slate-450 text-xs mt-1.5 leading-relaxed">Sistem sedang merender visual menggunakan GPU server. Proses ini memakan waktu beberapa menit.</p></div>
            </div>
          ) : result ? (
            <div className="flex-grow flex flex-col justify-between space-y-6 animate-fadeIn">
              {(() => {
                const getResultImages = () => { if (!result || !result.image_path) return []; try { if (result.image_path.startsWith('[')) return JSON.parse(result.image_path); } catch(e) {} return [result.image_path]; };
                const images = getResultImages();
                const activeImg = images[currentCarouselIdx] || '';
                return (
                  <div className="flex-grow flex flex-col items-center justify-center space-y-5 w-full">
                    <div className="relative w-full border border-[#2a2725] rounded-3xl overflow-hidden bg-black/80 flex justify-center items-center max-h-[500px] min-h-[350px] group">
                      <img src={getFullImageUrl(activeImg)} alt="Result" className="max-w-full max-h-[500px] object-contain" />
                      {images.length > 1 && (
                        <>
                          <button type="button" onClick={() => setCurrentCarouselIdx(prev => (prev > 0 ? prev - 1 : images.length - 1))} className="absolute left-4 p-2.5 bg-black/80 hover:bg-[#cfae80] hover:text-black text-white rounded-full transition-all opacity-0 group-hover:opacity-100 flex items-center"><ChevronRight className="rotate-180" /></button>
                          <button type="button" onClick={() => setCurrentCarouselIdx(prev => (prev < images.length - 1 ? prev + 1 : 0))} className="absolute right-4 p-2.5 bg-black/80 hover:bg-[#cfae80] hover:text-black text-white rounded-full transition-all opacity-0 group-hover:opacity-100 flex items-center"><ChevronRight /></button>
                        </>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-4 justify-end border-t border-[#2a2725] pt-5 w-full">
                      <a href={getFullImageUrl(activeImg)} target="_blank" rel="noopener noreferrer" className="bg-[#131211] hover:bg-[#1a1918] text-slate-200 font-bold py-3.5 px-5 rounded-2xl flex items-center gap-1.5 border border-[#2a2725] text-xs uppercase tracking-wider"><ExternalLink className="w-4 h-4 text-[#cfae80]" /> Resolusi Penuh</a>
                      <a href={getFullImageUrl(activeImg)} download className="bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-3.5 px-6 rounded-2xl flex items-center gap-1.5 shadow-lg text-xs uppercase tracking-wider"><Download className="w-4 h-4" /> Unduh</a>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="flex-grow flex flex-col items-center justify-center text-slate-500 py-16"><ImageIcon className="w-8 h-8 mb-4 text-[#cfae80]/60" /><p className="text-[10px] font-bold uppercase tracking-wider text-slate-450">Isi parameter lalu jalankan generator.</p></div>
          )}
        </div>
      </div>

      {/* Floating log bubble - always visible, fixed bottom-right */}
      {showLogModal && (
        <div className="fixed bottom-8 right-8 z-50 bg-[#1a1918]/95 border border-[#2a2725] w-96 h-80 rounded-3xl p-4 shadow-2xl flex flex-col backdrop-blur-md">
          <div className="flex justify-between items-center mb-3 border-b border-[#2a2725]/80 pb-2.5">
            <h3 className="text-[10px] font-bold text-white flex items-center gap-1.5 uppercase tracking-widest">
              <Terminal className="w-4 h-4 text-[#cfae80]" />
              Live Console Output
              {generating && <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />}
            </h3>
            <button onClick={() => setShowLogModal(false)} className="text-slate-400 hover:text-white p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-grow bg-black/60 border border-[#2a2725] rounded-2xl p-4 overflow-y-auto font-mono text-[10px] text-emerald-400 leading-relaxed scrollbar-thin">
            {taskLogs ? (
              taskLogs.split('\n').filter(l => l.trim()).map((line, idx) => (
                <div key={idx} className="mb-0.5 opacity-90">{line}</div>
              ))
            ) : (
              <div className="text-slate-600">Menunggu proses...</div>
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* Re-open button when bubble is closed */}
      {!showLogModal && (
        <button
          type="button"
          onClick={() => setShowLogModal(true)}
          className="fixed bottom-8 right-8 z-50 bg-[#1a1918]/95 border border-[#cfae80]/40 text-[#cfae80] text-[9px] font-bold tracking-widest uppercase py-3 px-4 rounded-2xl flex items-center gap-2 shadow-2xl backdrop-blur-md hover:bg-[#cfae80] hover:text-black transition-all"
        >
          <Terminal className="w-3.5 h-3.5" />
          Live Logs
          {generating && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
        </button>
      )}

    </div>
  );
}

