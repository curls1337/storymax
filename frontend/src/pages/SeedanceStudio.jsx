import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { Film, Sparkles, Upload, Loader, CheckCircle2, Play, RefreshCw, AlertCircle, Image as ImageIcon, Ratio, Clock, Monitor, ShieldCheck, Wallet, Download } from 'lucide-react';

export default function SeedanceStudio() {
  const [cookies, setCookies] = useState([]);
  const [selectedCookieId, setSelectedCookieId] = useState('auto');
  
  // Form parameters
  const [prompt, setPrompt] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [duration, setDuration] = useState(10);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [resolution, setResolution] = useState('720p');
  const [watermark, setWatermark] = useState(0);

  // States
  const [uploadingImage, setUploadingImage] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Live Video List & Credit Info from Freebeat Server API
  const [liveVideos, setLiveVideos] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedCreditInfo, setSelectedCreditInfo] = useState(null);
  const [loadingCredit, setLoadingCredit] = useState(false);

  // Storyboard Panels Import Dropdown
  const [storyboardPanels, setStoryboardPanels] = useState([]);
  const [selectedPanelId, setSelectedPanelId] = useState('');
  const [filterMode, setFilterMode] = useState('all'); // Default to 'all' so storyboards are immediately visible!
  const [isUsingFallback, setIsUsingFallback] = useState(false);

  const cleanImageUrl = (urlStr) => {
    if (!urlStr) return '';
    let str = String(urlStr).trim();
    // Try unescaping JSON quotes
    try {
      if (str.startsWith('"') && str.endsWith('"')) {
        str = JSON.parse(str);
      }
    } catch (e) {}
    // Strip brackets, escaped quotes, and backslashes
    str = String(str).replace(/^["'\[\\]+|["'\]\\]+$/g, '').trim();
    str = str.replace(/^["'\\]+|["'\\]+$/g, '').trim();
    return str;
  };

  const getFullFileUrl = (filePath) => {
    const cleaned = cleanImageUrl(filePath);
    if (!cleaned) return '';
    if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) return cleaned;
    const base = import.meta.env.VITE_API_URL || '/api';
    const cleanBase = base.replace(/\/api\/?$/, '');
    return `${cleanBase}${cleaned.startsWith('/') ? cleaned : '/' + cleaned}`;
  };

  // Fetch user storyboards based on filterMode ('seedance25' or 'all')
  const fetchUserStoryboards = async (mode = filterMode) => {
    try {
      const res = await api.get('/storyboards');
      const allSb = res.data || [];
      
      let filteredSb = allSb;
      let fallback = false;

      if (mode === 'seedance25') {
        const onlySeedance = allSb.filter(sb => {
          const params = sb.generation_params || '';
          return params.includes('seedance25') || params.includes('seedance-2.5');
        });
        if (onlySeedance.length > 0) {
          filteredSb = onlySeedance;
        } else {
          filteredSb = allSb; // Smart fallback to all so list is never empty!
          fallback = true;
        }
      }
      setIsUsingFallback(fallback);

      const panels = [];
      filteredSb.forEach((sb) => {
        let imgUrls = [];
        let rawStr = sb.original_cdn_urls || sb.image_path || '';
        
        // Try parsing JSON array
        if (typeof rawStr === 'string') {
          const trimmedRaw = rawStr.trim();
          if (trimmedRaw.startsWith('[') || trimmedRaw.startsWith('"[')) {
            try {
              const unescaped = trimmedRaw.startsWith('"') ? JSON.parse(trimmedRaw) : trimmedRaw;
              const parsed = typeof unescaped === 'string' ? JSON.parse(unescaped) : unescaped;
              if (Array.isArray(parsed)) {
                imgUrls = parsed.map(x => cleanImageUrl(x)).filter(Boolean);
              }
            } catch (e) {}
          }
        }

        // Fallback: split by comma if not parsed as JSON array
        if (imgUrls.length === 0 && rawStr) {
          imgUrls = String(rawStr)
            .split(',')
            .map(x => cleanImageUrl(x))
            .filter(Boolean);
        }

        // Extract AI Video Prompts (Image-to-Video / Text-to-Video prompts)
        let videoPromptList = [];
        if (sb.video_prompts) {
          try {
            const parsedVp = typeof sb.video_prompts === 'string' ? JSON.parse(sb.video_prompts) : sb.video_prompts;
            if (parsedVp) {
              if (Array.isArray(parsedVp.scenes)) {
                videoPromptList = parsedVp.scenes;
              } else if (Array.isArray(parsedVp)) {
                videoPromptList = parsedVp;
              }
            }
          } catch (e) {}
        }

        imgUrls.forEach((url, idx) => {
          const cleanedUrl = cleanImageUrl(url);
          const fullUrl = getFullFileUrl(cleanedUrl);

          // Get dedicated AI Video Prompt for this panel/scene
          let videoPromptText = '';
          const vpItem = videoPromptList[idx];
          if (vpItem) {
            if (typeof vpItem === 'string') {
              videoPromptText = vpItem;
            } else if (typeof vpItem === 'object') {
              videoPromptText = vpItem.imageToVideoPrompt || vpItem.textToVideoPrompt || vpItem.prompt || vpItem.visualPrompt || vpItem.description || '';
            }
          }

          // Fallback to sb.prompt or sb.title if no specific video prompt found
          if (!videoPromptText || !videoPromptText.trim()) {
            videoPromptText = sb.prompt || sb.title || '';
          }

          // Clean any VO: or Voiceover: cues from the video prompt
          videoPromptText = String(videoPromptText)
            .replace(/\b(VO|Voiceover|Voice\s*Over|Naskah\s*Voice\s*Over|Narasi|Narration)\s*:\s*"[^"]*"/gi, '')
            .replace(/\b(VO|Voiceover|Voice\s*Over|Naskah\s*Voice\s*Over|Narasi|Narration)\s*:[^\n.]*([.\n]|$)/gi, '')
            .trim();

          panels.push({
            id: `${sb.id}_${idx}`,
            storyboardId: sb.id,
            title: sb.title || `Storyboard #${sb.id}`,
            pageNum: idx + 1,
            prompt: videoPromptText,
            imageUrl: fullUrl
          });
        });
      });

      setStoryboardPanels(panels);
    } catch (err) {
      console.error('Gagal mengambil daftar storyboard:', err);
    }
  };

  const handleSelectStoryboardPanel = (panelId) => {
    setSelectedPanelId(panelId);
    if (!panelId) return;
    const found = storyboardPanels.find(p => String(p.id) === String(panelId));
    if (found) {
      if (found.prompt) {
        let cleanP = String(found.prompt)
          .replace(/\b(VO|Voiceover|Voice\s*Over|Naskah\s*Voice\s*Over|Narasi|Narration)\s*:\s*"[^"]*"/gi, '')
          .replace(/\b(VO|Voiceover|Voice\s*Over|Naskah\s*Voice\s*Over|Narasi|Narration)\s*:[^\n.]*([.\n]|$)/gi, '')
          .trim();
        setPrompt(cleanP || found.prompt);
      }
      if (found.imageUrl) setImageUrl(cleanImageUrl(found.imageUrl));
    }
  };

  // State for AI Prompt Rewriter
  const [rewritingPrompt, setRewritingPrompt] = useState(false);

  const handleRewritePrompt = async () => {
    if (!prompt || !prompt.trim()) return;
    setRewritingPrompt(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await api.post('/seedance/rewrite-prompt', { prompt: prompt.trim() });
      if (res.data && res.data.prompt) {
        setPrompt(res.data.prompt);
        setSuccessMsg('Prompt berhasil ditulis ulang & disempurnakan oleh AI!');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menulis ulang prompt.');
    } finally {
      setRewritingPrompt(false);
    }
  };

  // Fetch active cookies for dropdown
  const fetchCookies = async () => {
    try {
      const res = await api.get('/seedance/cookies');
      setCookies(res.data || []);
    } catch (err) {
      console.error('Gagal mengambil daftar cookie SeedDance:', err);
    }
  };

  // Fetch Live Video List directly from Freebeat Server for selected cookie
  const fetchLiveVideoList = async (cookieId = selectedCookieId) => {
    setLoadingList(true);
    try {
      const res = await api.post('/seedance/list', { cookie_id: cookieId, limit: 500, anchor: 1 });
      if (res.data && res.data.list) {
        setLiveVideos(res.data.list);
      }
    } catch (err) {
      console.error('Gagal mengambil daftar video dari server Freebeat:', err);
    } finally {
      setLoadingList(false);
    }
  };

  // Fetch Live Credit Info whenever selected cookie changes
  const fetchCookieCredit = async (cookieId = selectedCookieId) => {
    setLoadingCredit(true);
    try {
      const res = await api.post('/seedance/credit-info', { cookie_id: cookieId });
      if (res.data) {
        setSelectedCreditInfo(res.data);
      }
    } catch (err) {
      console.error('Gagal mengambil saldo kredit cookie:', err);
    } finally {
      setLoadingCredit(false);
    }
  };

  useEffect(() => {
    fetchCookies();
    fetchUserStoryboards();
  }, []);

  // Fetch live video list & credit info whenever selected cookie changes
  useEffect(() => {
    fetchLiveVideoList(selectedCookieId);
    fetchCookieCredit(selectedCookieId);
  }, [selectedCookieId]);

  // Auto poll list every 3 seconds if any item is processing (status !== 100 && status !== 101)
  const isAnyTaskProcessing = liveVideos.some(item => item.status !== 100 && item.status !== 101);

  useEffect(() => {
    let interval = null;
    if (isAnyTaskProcessing) {
      interval = setInterval(() => {
        fetchLiveVideoList(selectedCookieId);
        fetchCookieCredit(selectedCookieId);
      }, 3000); // Check every 3 seconds!
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isAnyTaskProcessing, selectedCookieId]);

  // Image Upload Handler
  const handleImageUpload = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    setUploadingImage(true);
    setError('');
    const formData = new FormData();
    formData.append('image', file);

    try {
      const res = await api.post('/ai/upload-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (res.data && res.data.imageUrl) {
        setImageUrl(res.data.imageUrl);
      }
    } catch (err) {
      setError('Gagal mengunggah gambar. Gunakan URL gambar langsung.');
    } finally {
      setUploadingImage(false);
    }
  };

  // Submit Generation Request
  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setError('Prompt deskripsi video wajib diisi.');
      return;
    }

    setGenerating(true);
    setError('');
    setSuccessMsg('');

    try {
      const payload = {
        cookie_id: selectedCookieId,
        prompt: prompt.trim(),
        images: imageUrl ? [imageUrl] : [],
        duration: Number(duration),
        aspectRatio,
        resolution,
        watermark: Number(watermark)
      };

      const res = await api.post('/seedance/create', payload);
      setSuccessMsg(res.data.message || 'Tugas video SeedDance 2.5 berhasil dikirim!');
      setPrompt('');
      
      // Immediately refresh live video list & credit info
      setTimeout(() => {
        fetchLiveVideoList(selectedCookieId);
        fetchCookieCredit(selectedCookieId);
      }, 600);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Gagal membuat video SeedDance 2.5.');
    } finally {
      setGenerating(false);
    }
  };

  const activeSelectedCookie = cookies.find(c => String(c.id) === String(selectedCookieId));

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-24 lg:pb-12 animate-fadeIn px-1 sm:px-0">
      {/* Header Banner */}
      <div className="bg-[#1a1918]/80 border border-[#2a2725] rounded-3xl p-5 sm:p-6 md:p-8 relative overflow-hidden backdrop-blur-md shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#06b6d4]/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#06b6d4]/10 border border-[#06b6d4]/30 text-[#67e8f9] text-[9px] font-bold uppercase tracking-widest mb-3">
              <Film className="w-3.5 h-3.5" /> Model ID: 134 · SeedDance 2.5 Pro
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-editorial italic text-white tracking-wide">
              Studio Video <span className="text-[#06b6d4] font-normal">SeedDance 2.5</span>
            </h1>
            <p className="text-slate-400 text-xs mt-2 max-w-xl leading-relaxed">
              Buat video sinematik definisi tinggi menggunakan teknologi terbaru SeedDance 2.5 dengan pemantauan status proses real-time per akun API.
            </p>
          </div>

          <div className="bg-black/40 border border-[#06b6d4]/30 rounded-2xl p-4 min-w-[260px] sm:min-w-[280px] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-[#06b6d4]" /> Cookie Pool Active
              </span>
              <span className="text-[10px] font-bold text-[#67e8f9] bg-[#06b6d4]/15 px-2 py-0.5 rounded-md border border-[#06b6d4]/30">
                {cookies.length} Akun Aktif
              </span>
            </div>
            <p className="text-[10px] font-semibold text-slate-200 truncate">
              {activeSelectedCookie ? activeSelectedCookie.label : 'Auto (Sistem akan memilih cookie aktif terbaik)'}
            </p>
            <div className="pt-1.5 border-t border-[#2a2725]">
              {loadingCredit ? (
                <span className="text-[9px] text-slate-400 flex items-center gap-1">
                  <Loader className="w-3 h-3 animate-spin text-[#06b6d4]" /> Mengambil saldo kredit real-time...
                </span>
              ) : selectedCreditInfo ? (
                <p className="text-[10px] font-bold text-[#67e8f9] flex items-center gap-1 font-mono">
                  ⚡ Saldo: {selectedCreditInfo.totalCredits != null ? selectedCreditInfo.totalCredits.toLocaleString() : '?'} Kredit · Plan: {selectedCreditInfo.planName || 'Pro'}
                </p>
              ) : activeSelectedCookie && activeSelectedCookie.last_status ? (
                <p className="text-[8.5px] text-[#67e8f9] font-mono truncate" title={activeSelectedCookie.last_status}>
                  📋 {activeSelectedCookie.last_status}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Main Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Form Controls */}
        <div className="lg:col-span-6 bg-[#1a1918]/60 border border-[#2a2725] rounded-3xl p-5 sm:p-6 relative backdrop-blur-md space-y-5 shadow-xl">
          <h2 className="text-sm font-bold text-white uppercase tracking-widest border-b border-[#2a2725] pb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#06b6d4]" /> Parameter Generator Video
          </h2>

          {error && (
            <div className="bg-red-950/40 border border-red-500/40 text-red-300 p-3.5 rounded-xl text-xs flex items-center gap-2.5 animate-fadeIn">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="bg-cyan-950/40 border border-cyan-500/40 text-cyan-200 p-3.5 rounded-xl text-xs flex items-center gap-2.5 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 text-[#06b6d4] shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Import Storyboard Dropdown Section & Filter Switcher */}
          <div className="space-y-2.5 bg-[#06b6d4]/10 border border-[#06b6d4]/30 rounded-2xl p-3.5 sm:p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="block text-[10px] sm:text-xs font-bold text-[#67e8f9] uppercase tracking-widest flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-[#06b6d4]" /> Import Gambar dari Storyboard:
              </label>

              {/* Filter Mode Selector Buttons */}
              <div className="flex items-center gap-1 bg-black/60 border border-[#06b6d4]/30 p-1 rounded-xl shrink-0">
                <button
                  type="button"
                  onClick={() => setFilterMode('seedance25')}
                  className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    filterMode === 'seedance25'
                      ? 'bg-[#06b6d4] text-white shadow-md'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Hanya SeedDance 2.5
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode('all')}
                  className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    filterMode === 'all'
                      ? 'bg-[#06b6d4] text-white shadow-md'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Semua Storyboard
                </button>
              </div>
            </div>

            <select
              value={selectedPanelId}
              onChange={(e) => handleSelectStoryboardPanel(e.target.value)}
              className="w-full bg-black/80 border border-[#06b6d4]/40 focus:border-[#06b6d4] rounded-xl px-3.5 py-3 text-white text-xs focus:outline-none transition-all cursor-pointer font-medium"
            >
              <option value="">
                -- {filterMode === 'seedance25' ? 'Pilih Panel (Hanya Storyboard SeedDance 2.5)' : 'Pilih Panel (Semua Storyboard)'} --
              </option>
              {storyboardPanels.map((panel) => (
                <option key={panel.id} value={panel.id}>
                  📷 [{panel.title}] Panel {panel.pageNum} — {panel.prompt ? panel.prompt.substring(0, 45) + '...' : 'Gambar Storyboard'}
                </option>
              ))}
            </select>
            {isUsingFallback && filterMode === 'seedance25' && (
              <p className="text-[9.5px] text-[#67e8f9] italic mt-1 font-medium">
                💡 Belum ada storyboard khusus SeedDance 2.5 Pro. Menampilkan semua storyboard yang ada agar dapat langsung digunakan.
              </p>
            )}
            {storyboardPanels.length === 0 && (
              <p className="text-[9px] text-slate-400 italic mt-1">
                Belum ada storyboard yang tersedia. Silakan buat storyboard baru terlebih dahulu di menu AI Generator.
              </p>
            )}
          </div>

          <form onSubmit={handleGenerate} className="space-y-5">
            {/* Account Cookie Selector Dropdown */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-300 uppercase tracking-widest flex items-center justify-between">
                <span>Pilih Akun / Cookie Pool:</span>
                <span className="text-[#06b6d4] normal-case text-[10px]">Pilih akun spesifik atau Otomatis</span>
              </label>
              <select
                value={selectedCookieId}
                onChange={(e) => setSelectedCookieId(e.target.value)}
                className="w-full bg-black/60 border border-[#2a2725] focus:border-[#06b6d4] rounded-xl px-4 py-3 text-white text-xs focus:outline-none transition-all cursor-pointer font-medium"
              >
                <option value="auto">⚡ Auto (Pilih Cookie Aktif Secara Otomatis)</option>
                {cookies.map(c => (
                  <option key={c.id} value={c.id}>
                    🔑 {c.label} {c.last_status ? `(${c.last_status})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Prompt Input & AI Rewrite Button */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-[10px] font-bold text-slate-300 uppercase tracking-widest">
                  Prompt Deskripsi Video (Wajib):
                </label>
                <button
                  type="button"
                  onClick={handleRewritePrompt}
                  disabled={rewritingPrompt || !prompt.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#06b6d4]/15 hover:bg-[#06b6d4] text-[#67e8f9] hover:text-white border border-[#06b6d4]/30 text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-40"
                  title="Tulis ulang & sempurnakan prompt ini menjadi prompt video sinematik khas SeedDance 2.5"
                >
                  {rewritingPrompt ? (
                    <>
                      <Loader className="w-3 h-3 animate-spin text-[#06b6d4]" />
                      <span>Menulis Ulang AI...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3 text-[#06b6d4]" />
                      <span>Tulis Ulang & Sempurnakan dengan AI</span>
                    </>
                  )}
                </button>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder="Contoh: timelaps membuat gedung sate... (atau klik Tulis Ulang AI untuk menyempurnakan)"
                className="w-full bg-black/60 border border-[#2a2725] focus:border-[#06b6d4] rounded-xl p-3.5 text-white text-xs placeholder:text-slate-600 focus:outline-none transition-all leading-relaxed"
                required
              />
            </div>

            {/* Image Input (First Frame Reference) */}
            <div className="space-y-2">
              <label className="block text-[10px] font-bold text-slate-300 uppercase tracking-widest flex items-center justify-between">
                <span>Gambar Acuan / Frame Awal (Kosongkan jika Text-to-Video):</span>
                {imageUrl && (
                  <button type="button" onClick={() => setImageUrl('')} className="text-red-400 hover:underline text-[9px]">
                    Hapus Gambar
                  </button>
                )}
              </label>
              
              <div className="flex gap-2">
                <input
                  type="text"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://static.freebeatfit.com/dance/aivideo/... atau upload"
                  className="flex-1 bg-black/60 border border-[#2a2725] focus:border-[#06b6d4] rounded-xl px-3.5 py-2.5 text-white text-xs placeholder:text-slate-600 focus:outline-none"
                />
                <label className="bg-[#2a2725] hover:bg-[#06b6d4] hover:text-white text-slate-300 font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer shrink-0">
                  {uploadingImage ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  <span>Upload</span>
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </label>
              </div>

              {imageUrl && (
                <div className="mt-2 relative w-32 h-20 rounded-xl overflow-hidden border border-[#06b6d4]/40 bg-black">
                  <img src={imageUrl} alt="Reference Preview" className="w-full h-full object-cover" />
                </div>
              )}
            </div>

            {/* Parameter Controls Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              {/* Duration */}
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                  <Clock className="w-3 h-3 text-[#06b6d4]" /> Durasi
                </label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full bg-black/60 border border-[#2a2725] focus:border-[#06b6d4] rounded-lg px-2.5 py-2 text-white text-xs focus:outline-none cursor-pointer"
                >
                  <option value={10}>10 Detik</option>
                  <option value={30}>30 Detik</option>
                  <option value={15}>15 Detik</option>
                  <option value={5}>5 Detik</option>
                </select>
              </div>

              {/* Aspect Ratio */}
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                  <Ratio className="w-3 h-3 text-[#06b6d4]" /> Aspect Ratio
                </label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="w-full bg-black/60 border border-[#2a2725] focus:border-[#06b6d4] rounded-lg px-2.5 py-2 text-white text-xs focus:outline-none cursor-pointer"
                >
                  <option value="16:9">16:9 (Landscape)</option>
                  <option value="9:16">9:16 (Portrait/TikTok)</option>
                  <option value="1:1">1:1 (Square)</option>
                </select>
              </div>

              {/* Resolution */}
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                  <Monitor className="w-3 h-3 text-[#06b6d4]" /> Resolusi
                </label>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className="w-full bg-black/60 border border-[#2a2725] focus:border-[#06b6d4] rounded-lg px-2.5 py-2 text-white text-xs focus:outline-none cursor-pointer"
                >
                  <option value="720p">720p HD</option>
                  <option value="1080p">1080p Full HD</option>
                </select>
              </div>

              {/* Watermark */}
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-[#06b6d4]" /> Watermark
                </label>
                <select
                  value={watermark}
                  onChange={(e) => setWatermark(Number(e.target.value))}
                  className="w-full bg-black/60 border border-[#2a2725] focus:border-[#06b6d4] rounded-lg px-2.5 py-2 text-white text-xs focus:outline-none cursor-pointer"
                >
                  <option value={0}>Tanpa Watermark</option>
                  <option value={1}>Dengan Watermark</option>
                </select>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={generating}
              className="w-full bg-gradient-to-r from-[#06b6d4] to-[#0891b2] hover:from-[#0891b2] hover:to-[#0284c7] text-white font-bold py-3.5 px-6 rounded-xl transition-all shadow-lg hover:shadow-[#06b6d4]/25 flex items-center justify-center gap-2 text-xs uppercase tracking-widest cursor-pointer disabled:opacity-50 min-h-[44px]"
            >
              {generating ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  <span>Mengirimkan ke Server SeedDance 2.5...</span>
                </>
              ) : (
                <>
                  <Film className="w-4 h-4" />
                  <span>Generate Video SeedDance 2.5</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Right Column: Live Server Video List & Status Monitoring */}
        <div className="lg:col-span-6 bg-[#1a1918]/60 border border-[#2a2725] rounded-3xl p-5 sm:p-6 relative backdrop-blur-md space-y-4 shadow-xl flex flex-col">
          <div className="flex items-center justify-between border-b border-[#2a2725] pb-3">
            <div>
              <h2 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <Film className="w-4 h-4 text-[#06b6d4]" /> Daftar Video & Status Server Live
              </h2>
              <p className="text-[9.5px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                {isAnyTaskProcessing ? (
                  <span className="text-[#67e8f9] font-bold flex items-center gap-1 animate-pulse">
                    <Loader className="w-3 h-3 animate-spin text-[#06b6d4]" /> 🔄 Auto-polling aktif (Mengecek status setiap 3 detik)
                  </span>
                ) : (
                  <span>Menampilkan antrean & hasil video sesuai akun API yang dipilih</span>
                )}
              </p>
            </div>
            <button
              onClick={() => {
                fetchLiveVideoList(selectedCookieId);
                fetchCookieCredit(selectedCookieId);
              }}
              disabled={loadingList}
              className="px-3 py-1.5 rounded-lg bg-[#2a2725] hover:bg-[#06b6d4] text-slate-300 hover:text-white transition-all text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Refresh List Video"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingList ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[600px] space-y-3 pr-1">
            {loadingList && liveVideos.length === 0 ? (
              <div className="text-center py-16 text-slate-500 space-y-2">
                <Loader className="w-8 h-8 animate-spin mx-auto text-[#06b6d4]" />
                <p className="text-xs">Mengambil daftar video dari server Freebeat...</p>
              </div>
            ) : liveVideos.length === 0 ? (
              <div className="text-center py-16 text-slate-500 space-y-2">
                <Film className="w-8 h-8 mx-auto text-slate-600" />
                <p className="text-xs">Belum ada daftar video untuk akun yang dipilih ini.</p>
              </div>
            ) : (
              liveVideos.map((item) => {
                const isCompleted = item.status === 100;
                const isFailed = item.status === 101;
                const isProcessing = !isCompleted && !isFailed; // Treats status 0, 1, etc as Processing!

                // Extract reference image URL (Freebeat static CDN URL) if present
                let refImgUrl = null;
                if (Array.isArray(item.images) && item.images.length > 0 && item.images[0] && item.images[0] !== '') {
                  refImgUrl = item.images[0];
                } else if (typeof item.images === 'string' && item.images.trim()) {
                  try {
                    const parsed = JSON.parse(item.images);
                    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] && parsed[0] !== '') {
                      refImgUrl = parsed[0];
                    }
                  } catch (e) {
                    if (item.images.startsWith('http')) refImgUrl = item.images.trim();
                  }
                }

                return (
                  <div key={item.id || item.serialNo} className={`border rounded-2xl p-4 space-y-3 transition-all ${
                    isCompleted ? 'bg-black/50 border-green-500/30' :
                    isFailed ? 'bg-red-950/20 border-red-500/30' :
                    'bg-cyan-950/25 border-[#06b6d4]/50 shadow-lg shadow-[#06b6d4]/10 animate-pulse'
                  }`}>
                    {/* Header Item */}
                    <div className="flex items-start justify-between gap-2 border-b border-[#2a2725] pb-2">
                      <div>
                        <p className="text-[11px] font-mono text-[#67e8f9] font-bold">Serial #{item.serialNo}</p>
                        <p className="text-[9px] text-slate-400">{item.createTime}</p>
                      </div>
                      
                      {/* Status Badges */}
                      <span className={`text-[9px] font-bold px-2.5 py-1 rounded-full border flex items-center gap-1.5 uppercase tracking-wider ${
                        isCompleted ? 'bg-green-950/60 text-green-300 border-green-500/40' :
                        isFailed ? 'bg-red-950/60 text-red-300 border-red-500/40' :
                        'bg-cyan-950/80 text-[#67e8f9] border-[#06b6d4]/60'
                      }`}>
                        {isProcessing && <Loader className="w-3.5 h-3.5 animate-spin text-[#06b6d4]" />}
                        {isCompleted && <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />}
                        {isFailed && <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
                        {isProcessing ? `⏳ Sedang Memproses...` : isCompleted ? '✅ Selesai' : isFailed ? '❌ Gagal (101)' : `Status ${item.status}`}
                      </span>
                    </div>

                    {/* Processing Progress Bar Indicator */}
                    {isProcessing && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-[9px] text-[#67e8f9] font-bold uppercase tracking-wider">
                          <span>Sedang merender video di server Freebeat...</span>
                          <span>(Mengecek tiap 3d)</span>
                        </div>
                        <div className="w-full h-1.5 bg-black/60 rounded-full overflow-hidden border border-[#06b6d4]/30">
                          <div className="h-full bg-gradient-to-r from-[#06b6d4] to-[#67e8f9] rounded-full animate-pulse w-3/4"></div>
                        </div>
                      </div>
                    )}

                    {/* Prompt Text */}
                    <p className="text-xs text-white leading-relaxed font-medium">
                      "{item.prompt}"
                    </p>

                    {/* Reference Image Badge & Freebeat CDN Link */}
                    {refImgUrl && (
                      <div className="bg-[#131211] border border-[#06b6d4]/40 rounded-xl p-2.5 flex items-center gap-3 my-2">
                        <img 
                          src={refImgUrl} 
                          alt="Referensi Gambar Freebeat CDN" 
                          className="w-12 h-12 object-cover rounded-lg border border-[#06b6d4]/50 shadow-md bg-black flex-shrink-0"
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-1.5 text-[9px] font-bold text-[#67e8f9] uppercase tracking-wider">
                            <ImageIcon className="w-3.5 h-3.5 text-[#06b6d4]" />
                            <span>Gambar Referensi (Freebeat CDN Uploaded):</span>
                          </div>
                          <a
                            href={refImgUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[9.5px] font-mono text-cyan-300 hover:text-white underline truncate block"
                            title={refImgUrl}
                          >
                            {refImgUrl}
                          </a>
                        </div>
                      </div>
                    )}

                    {/* Metadata Specs */}
                    <div className="flex items-center justify-between text-[9px] text-slate-400 pt-1">
                      <span>{item.duration}s · {item.aspectRatio} · {item.resolution} {item.useCredits ? `· ${item.useCredits} Kredit` : ''}</span>
                      {item.model && <span className="text-[#06b6d4] font-mono font-semibold">{item.model}</span>}
                    </div>

                    {/* Video Player & Download Link when status === 100 */}
                    {isCompleted && item.videoUrl && (
                      <div className="pt-2 space-y-2">
                        <video 
                          src={item.videoUrl} 
                          poster={item.coverUrl}
                          controls 
                          preload="metadata"
                          className="w-full rounded-xl border border-[#06b6d4]/40 bg-black max-h-64 object-contain shadow-md" 
                        />
                        <a
                          href={item.videoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          download
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#06b6d4]/15 hover:bg-[#06b6d4] text-[#67e8f9] hover:text-white font-bold text-[9px] uppercase tracking-wider transition-all border border-[#06b6d4]/30"
                        >
                          <Download className="w-3 h-3" /> Unduh Video MP4
                        </a>
                      </div>
                    )}

                    {/* Failed Message when status === 101 */}
                    {isFailed && (
                      <div className="bg-red-950/40 border border-red-500/30 text-red-300 p-2.5 rounded-xl text-[10px]">
                        ❌ Gagal membuat video (Status 101). Kredit akun tidak berkurang atau server sibuk. Silakan coba lagi.
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
