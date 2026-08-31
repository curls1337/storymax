import React, { useState, useEffect, useRef } from 'react';
import api from '../utils/api';
import {
  Film, Sparkles, Upload, Loader, CheckCircle2, Play, RefreshCw,
  AlertCircle, Image as ImageIcon, Ratio, Clock, Monitor, ShieldCheck,
  Wallet, Download, Trash2, X, Plus, ExternalLink, Video, Terminal
} from 'lucide-react';
import { toast } from '../utils/toast';

export default function ManualPromptStudio() {
  const [keys, setKeys] = useState([]);
  const [selectedKeyId, setSelectedKeyId] = useState('auto');
  const [videoModels, setVideoModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState('model_google-omni-flash');

  // Form states
  const [generationMethod, setGenerationMethod] = useState('reference'); // 'reference' | 'image' | 'text'
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [duration, setDuration] = useState('5');
  const [resolution, setResolution] = useState('720p');
  const [generateAudio, setGenerateAudio] = useState(true);
  const [referenceImages, setReferenceImages] = useState([]); // array of { file, dataUri, name }

  // Generation & Status states
  const [generating, setGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [successResult, setSuccessResult] = useState(null);
  const [logs, setLogs] = useState([]);

  // History list
  const [jobs, setJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const fileInputRef = useRef(null);
  const logContainerRef = useRef(null);

  const appendLog = (msg) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString('id-ID')}] ${msg}`]);
  };

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, generating]);

  // Fetch catalog & models
  const fetchModels = async (keyId = selectedKeyId) => {
    try {
      const res = await api.get(`/manual-video/models?keyId=${keyId || 'auto'}`);
      if (res.data) {
        setKeys(res.data.keys || []);
        const vms = res.data.videoModels || [];
        setVideoModels(vms);
        if (vms.length > 0 && !vms.some(m => m.id === selectedModelId)) {
          const firstSupported = vms.find(m => m.isSupported) || vms[0];
          setSelectedModelId(firstSupported.id);
        }
      }
    } catch (err) {
      console.error('Error fetching manual video models:', err);
    }
  };

  // Fetch job history
  const fetchJobs = async () => {
    setLoadingJobs(true);
    try {
      const res = await api.get('/manual-video/jobs');
      setJobs(res.data || []);
    } catch (err) {
      console.error('Error fetching manual video jobs:', err);
    } finally {
      setLoadingJobs(false);
    }
  };

  useEffect(() => {
    fetchModels('auto');
    fetchJobs();
  }, []);

  // Update available options when model changes
  const activeModel = videoModels.find(m => m.id === selectedModelId) || null;
  const maxRefImages = generationMethod === 'image' ? 1 : 7;

  useEffect(() => {
    if (activeModel) {
      if (activeModel.durations && activeModel.durations.length > 0) {
        if (!activeModel.durations.map(String).includes(String(duration))) {
          setDuration(String(activeModel.defaultDuration !== undefined ? activeModel.defaultDuration : activeModel.durations[0]));
        }
      }
      if (activeModel.resolutions && activeModel.resolutions.length > 0) {
        if (!activeModel.resolutions.includes(resolution)) {
          setResolution(activeModel.defaultResolution || activeModel.resolutions[0]);
        }
      }
      if (activeModel.aspectRatios && activeModel.aspectRatios.includes(aspectRatio)) {
        if (!activeModel.aspectRatios.includes(aspectRatio)) {
          setAspectRatio(activeModel.defaultAspectRatio || activeModel.aspectRatios[0]);
        }
      }
      if (activeModel.hasAudio !== undefined) {
        setGenerateAudio(activeModel.hasAudio);
      }
    }
  }, [selectedModelId]);

  // Handle reference image selection
  const handleFilesSelected = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const remainingSlots = Math.max(0, maxRefImages - referenceImages.length);
    const validFiles = files.slice(0, remainingSlots);

    validFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (uploadEvt) => {
        setReferenceImages(prev => [
          ...prev,
          {
            file,
            dataUri: uploadEvt.target.result,
            name: file.name
          }
        ].slice(0, maxRefImages));
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeReferenceImage = (idx) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== idx));
  };

  // Submit job
  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!prompt.trim() && (generationMethod === 'text' || referenceImages.length === 0)) {
      toast.error(generationMethod === 'text' ? 'Masukkan prompt teks visual.' : 'Masukkan prompt teks atau upload gambar.');
      return;
    }

    setGenerating(true);
    setError('');
    setSuccessResult(null);
    setLogs([]);
    setStatusMessage('Mengunggah parameter & menghubungi Scenario Cloud...');

    appendLog('Memulai proses render video manual...');
    appendLog(`Metode: ${generationMethod === 'reference' ? 'Reference-to-Video (Multi-Ref)' : generationMethod === 'image' ? 'Image-to-Video (First Frame)' : 'Text-to-Video (Murni Teks)'}`);
    appendLog(`Model AI: ${activeModel?.name || selectedModelId}`);
    appendLog(`Konfigurasi: Durasi ${duration}s, Rasio ${aspectRatio}, Resolusi ${resolution}`);
    if (generationMethod !== 'text' && referenceImages.length > 0) {
      appendLog(`Menyiapkan ${referenceImages.length} gambar referensi untuk diunggah...`);
    }
    appendLog('Mengirim request render ke Scenario Cloud API...');

    try {
      const payload = {
        prompt: prompt.trim(),
        modelId: selectedModelId,
        aspectRatio,
        duration: duration === 'auto' ? undefined : Number(duration),
        resolution,
        generateAudio,
        generationMethod,
        referenceImageUrls: generationMethod === 'text' ? [] : referenceImages.map(img => img.dataUri),
        keyId: selectedKeyId
      };

      const res = await api.post('/manual-video/generate', payload);
      setSuccessResult(res.data);
      appendLog(`[Scenario ✅] Video berhasil dirender! (Job ID: ${res.data.jobId || 'N/A'})`);
      appendLog(`URL Video: ${res.data.url}`);
      if (res.data.cost != null) {
        appendLog(`[Billing ⚡] Konsumsi kuota: ${res.data.cost} CU`);
      }
      appendLog('[Selesai 🎉] Video siap diputar dan diunduh.');
      toast.success('Video manual berhasil dibuat!');
      fetchJobs();
      fetchModels(selectedKeyId);
    } catch (err) {
      console.error('Error generating manual video:', err);
      const msg = err.response?.data?.message || err.message || 'Gagal membuat video manual.';
      setError(msg);
      appendLog(`[ERROR ❌] ${msg}`);
      toast.error(msg);
    } finally {
      setGenerating(false);
      setStatusMessage('');
    }
  };

  // Delete history item
  const handleDeleteJob = async (id) => {
    if (!window.confirm('Hapus video ini dari riwayat?')) return;
    setDeletingId(id);
    try {
      await api.delete(`/manual-video/jobs/${id}`);
      setJobs(prev => prev.filter(j => j.id !== id));
      if (successResult && successResult.id === id) {
        setSuccessResult(null);
      }
      toast.success('Riwayat video dihapus.');
    } catch (err) {
      toast.error('Gagal menghapus video.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 animate-fadeIn pb-12">
      {/* Header Banner */}
      <div className="bg-[#1a1918]/80 border border-[#2a2725] rounded-2xl p-5 md:p-6 backdrop-blur-md relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-[#cfae80]/5 rounded-full blur-3xl pointer-events-none"></div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2.5 py-0.5 rounded-full bg-[#cfae80]/15 text-[#cfae80] text-[9px] font-bold tracking-widest uppercase border border-[#cfae80]/30 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" /> Manual Prompt Mode
              </span>
              <span className="px-2 py-0.5 rounded-full bg-[#38bdf8]/10 text-[#38bdf8] text-[9px] font-semibold border border-[#38bdf8]/20">
                Scenario Cloud API
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-editorial italic text-white">
              Studio Video <span className="text-[#cfae80] font-normal">Prompt Bebas</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              Render video langsung dengan prompt teks murni dan multi-referensi gambar tanpa melalui pipeline AI Split.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => { fetchModels(); fetchJobs(); }}
              className="bg-[#131211] hover:bg-[#1f1d1b] text-slate-300 border border-[#2a2725] px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
              title="Segarkan data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingJobs ? 'animate-spin' : ''}`} />
              <span>Segarkan</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Creation Form Column */}
        <div className="lg:col-span-7 space-y-5">
          <form onSubmit={handleGenerate} className="bg-[#1a1918]/80 border border-[#2a2725] rounded-2xl p-5 md:p-6 space-y-4 backdrop-blur-md">
            {/* Scenario API Key Selector */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[9px] font-bold uppercase tracking-widest text-[#38bdf8] flex items-center gap-1.5">
                  <ShieldCheck className="w-3 h-3 text-[#38bdf8]" /> API Key Scenario
                </label>
                <span className="text-[9px] text-slate-400 font-mono">
                  {keys.length} Key Aktif di Pool
                </span>
              </div>
              <select
                value={selectedKeyId}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedKeyId(val);
                  fetchModels(val);
                }}
                disabled={generating}
                className="w-full bg-black/50 border border-[#2a2725] rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-[#38bdf8] transition-all font-medium"
              >
                <option value="auto">Pilih Otomatis (Auto-detect &amp; Failover)</option>
                {keys.length > 0 ? (
                  keys.map(k => (
                    <option key={k.id} value={k.id}>
                      {k.label} (Key: {String(k.key_value || '').substring(0, 8)}•••• | ⚡ {k.total_usage || 0}x Digunakan{k.consumption_cu != null ? ` · 🌐 ${k.consumption_cu} CU` : ''})
                    </option>
                  ))
                ) : (
                  <option value="" disabled>Belum ada API Key Scenario aktif</option>
                )}
              </select>
            </div>

            {/* Metode Pembuatan Selector */}
            <div>
              <label className="text-[9px] font-bold uppercase tracking-widest text-[#cfae80] block mb-1.5">
                Metode Pembuatan
              </label>
              <select
                value={generationMethod}
                onChange={(e) => {
                  const newMethod = e.target.value;
                  setGenerationMethod(newMethod);
                  if (newMethod === 'image') {
                    const i2v = videoModels.find(m => m.id.includes('i2v') || m.id.includes('seedance') || m.id.includes('grok-imagine'));
                    if (i2v && (!selectedModelId.includes('i2v') && !selectedModelId.includes('grok-imagine') && !selectedModelId.includes('seedance'))) {
                      setSelectedModelId(i2v.id);
                    }
                  }
                }}
                disabled={generating}
                className="w-full bg-black/50 border border-[#2a2725] rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-[#cfae80] transition-all font-medium"
              >
                <option value="reference">Reference-to-Video (Referensi Karakter / Multi-Foto)</option>
                <option value="image">Image-to-Video (I2V - Animasikan Foto Utama / First Frame)</option>
                <option value="text">Text-to-Video (T2V - Teks Murni Tanpa Foto)</option>
              </select>
            </div>

            {/* Model Selector */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[9px] font-bold uppercase tracking-widest text-[#cfae80]">
                  Pilih Model Video AI
                </label>
                {activeModel?.badge && (
                  <span className="text-[8px] font-bold px-2 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300">
                    {activeModel.badge}
                  </span>
                )}
              </div>
              <select
                value={selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
                disabled={generating}
                className="w-full bg-black/50 border border-[#2a2725] rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-[#cfae80] transition-all font-medium"
              >
                {videoModels.length > 0 ? (
                  videoModels.map(m => {
                    const isI2v = m.id.includes('i2v') || m.id.includes('grok-imagine') || m.id.includes('seedance') || m.id.includes('minimax') || m.id.includes('pixverse');
                    const typeTag = isI2v ? '🎬 [I2V - Animasikan Foto]' : '✨ [Multi-Ref / T2V]';
                    return (
                      <option key={m.id} value={m.id}>
                        {m.name} {m.plan ? `(${m.plan})` : ''} — {typeTag}
                      </option>
                    );
                  })
                ) : (
                  <option value="model_google-omni-flash">Gemini Omni (Google) (Semua Plan)</option>
                )}
              </select>
            </div>

            {/* Prompt Textarea */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[9px] font-bold uppercase tracking-widest text-slate-350">
                  Prompt Visual Video (Manual)
                </label>
                <span className="text-[9px] text-slate-500 font-mono">
                  {prompt.length} karakter
                </span>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={generating}
                placeholder="Tulis prompt instruksi kamera, gerakan objek, pencahayaan, atau suasana adegan secara detail dalam Bahasa Inggris atau Indonesia..."
                rows={4}
                className="w-full bg-black/50 border border-[#2a2725] rounded-xl p-3 text-white text-xs focus:outline-none focus:border-[#cfae80] transition-all placeholder:text-slate-600 resize-none font-normal leading-relaxed"
              />
            </div>

            {/* Reference Images Upload */}
            {generationMethod === 'text' ? (
              <div className="bg-[#131211] border border-[#2a2725] rounded-xl p-3.5 flex items-center gap-2.5 text-slate-400 text-xs">
                <Sparkles className="w-4 h-4 text-[#cfae80] shrink-0" />
                <span>Mode <strong>Text-to-Video (T2V)</strong> aktif. Video akan dirender murni dari prompt teks visual tanpa menggunakan gambar referensi.</span>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[9px] font-bold uppercase tracking-widest text-slate-350 flex items-center gap-1.5">
                    <ImageIcon className="w-3 h-3 text-[#cfae80]" />
                    <span>{generationMethod === 'image' ? 'Gambar Utama (First Frame)' : 'Gambar Referensi'}</span>
                    <span className="text-slate-500 normal-case font-normal">
                      (Maksimal {maxRefImages} gambar)
                    </span>
                  </label>
                  <span className="text-[9px] text-slate-400 font-mono">
                    {referenceImages.length}/{maxRefImages}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {referenceImages.slice(0, maxRefImages).map((img, idx) => (
                    <div key={idx} className="relative group bg-black/60 border border-[#2a2725] rounded-xl overflow-hidden aspect-video flex items-center justify-center">
                      <img src={img.dataUri} alt={img.name} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => removeReferenceImage(idx)}
                          disabled={generating}
                          className="bg-red-500/80 hover:bg-red-600 text-white p-1 rounded-lg transition-all cursor-pointer"
                          title="Hapus gambar"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <span className="absolute bottom-1 left-1 bg-black/80 px-1 py-0.5 rounded text-[8px] text-slate-300 font-mono">
                        {idx === 0 ? 'Utama / Frame 1' : `#${idx + 1}`}
                      </span>
                    </div>
                  ))}

                  {referenceImages.length < maxRefImages && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={generating}
                      className="border border-dashed border-[#2a2725] hover:border-[#cfae80]/50 rounded-xl aspect-video flex flex-col items-center justify-center gap-1 text-slate-400 hover:text-white transition-all bg-black/20 hover:bg-black/40 cursor-pointer"
                    >
                      <Plus className="w-4 h-4 text-[#cfae80]" />
                      <span className="text-[9px] font-bold tracking-wider uppercase">Tambah Foto</span>
                    </button>
                  )}
                </div>

                <p className="text-[8.5px] text-slate-500 mt-1.5 leading-relaxed">
                  💡 {generationMethod === 'image' ? (
                    <>Foto di atas menjadi <strong className="text-slate-300">titik awal animasi (First Frame)</strong> yang digerakkan sesuai instruksi prompt.</>
                  ) : (
                    <>Foto #1 dijadikan frame awal utama, foto tambahan digunakan sebagai referensi visual sudut pandang/karakter.</>
                  )}
                </p>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple={generationMethod !== 'image'}
                  onChange={handleFilesSelected}
                  className="hidden"
                />
              </div>
            )}

            {/* Video Parameters Grid */}
            <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-[#2a2725]/60">
              {/* Duration */}
              <div>
                <label className="text-[8px] font-bold uppercase tracking-widest text-slate-400 block mb-1">
                  Durasi
                </label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  disabled={generating}
                  className="w-full bg-black/50 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[11px] font-semibold focus:outline-none focus:border-[#cfae80]"
                >
                  {activeModel?.durations?.length > 0 ? (
                    activeModel.durations.map(d => (
                      <option key={d} value={d}>
                        {d === -1 ? 'Auto (Adaptif)' : `${d} Detik`}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="5">5 Detik</option>
                      <option value="10">10 Detik</option>
                    </>
                  )}
                </select>
              </div>

              {/* Aspect Ratio */}
              <div>
                <label className="text-[8px] font-bold uppercase tracking-widest text-slate-400 block mb-1">
                  Rasio Layar
                </label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  disabled={generating}
                  className="w-full bg-black/50 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[11px] font-semibold focus:outline-none focus:border-[#cfae80]"
                >
                  {activeModel?.aspectRatios?.length > 0 ? (
                    activeModel.aspectRatios.map(r => (
                      <option key={r} value={r}>
                        {r === '16:9' ? '16:9 (Landscape)' : r === '9:16' ? '9:16 (Portrait)' : r === '1:1' ? '1:1 (Kotak)' : r}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="16:9">16:9 (Landscape)</option>
                      <option value="9:16">9:16 (Portrait)</option>
                      <option value="1:1">1:1 (Square)</option>
                    </>
                  )}
                </select>
              </div>

              {/* Resolution */}
              <div>
                <label className="text-[8px] font-bold uppercase tracking-widest text-slate-400 block mb-1">
                  Resolusi
                </label>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  disabled={generating}
                  className="w-full bg-black/50 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[11px] font-semibold focus:outline-none focus:border-[#cfae80]"
                >
                  {activeModel?.resolutions?.length > 0 ? (
                    activeModel.resolutions.map(res => (
                      <option key={res} value={res}>{res}</option>
                    ))
                  ) : (
                    <>
                      <option value="720p">720p HD</option>
                      <option value="1080p">1080p FHD</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            {/* Audio Switch */}
            <div className="pt-2 border-t border-[#2a2725]/60 flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={generateAudio}
                  onChange={(e) => setGenerateAudio(e.target.checked)}
                  disabled={generating}
                  className="rounded border-[#2a2725] bg-black text-[#cfae80] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                />
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
                  Audio Native <span className="text-slate-500 font-normal normal-case">(Hasilkan efek suara &amp; musik bawaan AI)</span>
                </span>
              </label>
            </div>

            {/* Error Message Display */}
            {error && (
              <div className="bg-red-950/20 border border-red-500/30 rounded-xl p-3 flex items-start gap-2.5 text-red-300 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
                <div className="leading-relaxed whitespace-pre-wrap">{error}</div>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={generating}
              className="w-full bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-3 px-4 rounded-xl text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-[#cfae80]/15 disabled:opacity-50 cursor-pointer"
            >
              {generating ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  <span>{statusMessage || 'Sedang Merender Video Manual...'}</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-black" />
                  <span>Buat Video Sekarang</span>
                </>
              )}
            </button>
          </form>

          {/* Live Process Logs Console */}
          {(generating || logs.length > 0) && (
            <div className="bg-[#131211] border border-[#2a2725] rounded-2xl p-4 space-y-2 backdrop-blur-md animate-fadeIn">
              <div className="flex items-center justify-between border-b border-[#2a2725]/60 pb-2">
                <div className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-[#cfae80]" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">
                    Live Process Logs
                  </span>
                  {generating && (
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setLogs([])}
                  className="text-[9px] text-slate-500 hover:text-slate-300 font-mono transition-colors cursor-pointer"
                >
                  Clear Logs
                </button>
              </div>
              <div
                ref={logContainerRef}
                className="bg-black/80 border border-[#2a2725]/60 rounded-xl p-3.5 h-44 overflow-y-auto font-mono text-[10px] text-emerald-400/90 leading-relaxed scrollbar-thin space-y-1"
              >
                {logs.map((logLine, idx) => (
                  <div
                    key={idx}
                    className={
                      logLine.includes('[ERROR')
                        ? 'text-red-400 font-bold'
                        : logLine.includes('[Scenario ✅') || logLine.includes('[Selesai')
                        ? 'text-[#cfae80] font-bold'
                        : logLine.includes('[Billing')
                        ? 'text-sky-300'
                        : ''
                    }
                  >
                    {logLine}
                  </div>
                ))}
                {generating && (
                  <div className="flex items-center gap-2 text-slate-400 pt-1">
                    <Loader className="w-3 h-3 animate-spin text-[#cfae80]" />
                    <span className="animate-pulse">Sedang memproses di Scenario Cloud API (mohon tunggu)...</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Results & History Column */}
        <div className="lg:col-span-5 space-y-5">
          {/* Active Generation Result Card */}
          {successResult && (
            <div className="bg-[#1a1918]/80 border border-[#cfae80]/30 rounded-2xl p-5 space-y-3 backdrop-blur-md animate-fadeIn">
              <div className="flex items-center justify-between border-b border-[#2a2725] pb-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#cfae80] flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Hasil Video Terbaru
                </span>
                {successResult.cost != null && (
                  <span className="text-[9px] font-bold text-slate-400">
                    ⚡ Biaya: {successResult.cost} CU
                  </span>
                )}
              </div>

              <video
                src={successResult.url}
                controls
                autoPlay
                loop
                playsInline
                className="w-full rounded-xl border border-[#2a2725] bg-black aspect-video max-h-64 object-contain"
              />

              <div className="flex gap-2">
                <a
                  href={successResult.url}
                  download={`manual-video-${successResult.jobId || Date.now()}.mp4`}
                  className="flex-1 bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-2 px-3 rounded-lg text-[9px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all text-center"
                >
                  <Download className="w-3.5 h-3.5" /> Unduh Video
                </a>
                <a
                  href={successResult.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-[#131211] hover:bg-[#1a1918] text-slate-300 border border-[#2a2725] font-bold py-2 px-3 rounded-lg text-[9px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-[#cfae80]" /> Tab Baru
                </a>
              </div>
            </div>
          )}

          {/* History List Card */}
          <div className="bg-[#1a1918]/80 border border-[#2a2725] rounded-2xl p-5 space-y-3 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-[#2a2725] pb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-350 flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5 text-[#cfae80]" /> Riwayat Video Manual ({jobs.length})
              </span>
              <button
                onClick={fetchJobs}
                className="text-[9px] text-[#cfae80] hover:underline font-bold uppercase cursor-pointer"
              >
                Segarkan
              </button>
            </div>

            {loadingJobs ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-500">
                <Loader className="w-5 h-5 animate-spin text-[#cfae80]" />
                <span className="text-xs">Memuat riwayat...</span>
              </div>
            ) : jobs.length === 0 ? (
              <div className="py-12 text-center text-slate-500 space-y-1">
                <Film className="w-8 h-8 mx-auto opacity-30" />
                <p className="text-xs">Belum ada video manual yang dibuat.</p>
                <p className="text-[10px] text-slate-600">Video yang Anda buat akan tersimpan di sini.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[550px] overflow-y-auto pr-1 scrollbar-thin">
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className="bg-black/40 border border-[#2a2725] hover:border-[#cfae80]/20 rounded-xl p-3 space-y-2.5 transition-all"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#cfae80]/10 text-[#cfae80] border border-[#cfae80]/20 uppercase">
                          {job.model_id?.replace(/^model_/, '') || 'Scenario Video'}
                        </span>
                        <p className="text-[10px] text-slate-300 font-medium mt-1 line-clamp-2 leading-relaxed">
                          {job.prompt || '(Tanpa prompt teks)'}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteJob(job.id)}
                        disabled={deletingId === job.id}
                        className="text-slate-500 hover:text-red-400 p-1 transition-colors cursor-pointer shrink-0"
                        title="Hapus riwayat"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {job.video_url && (
                      <video
                        src={job.video_url}
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full rounded-lg border border-[#2a2725] bg-black max-h-40"
                      />
                    )}

                    <div className="flex items-center justify-between pt-1 border-t border-[#2a2725]/40 text-[8.5px] text-slate-500 font-mono">
                      <span>{new Date(job.created_at || Date.now()).toLocaleString('id-ID')}</span>
                      <div className="flex items-center gap-2">
                        {job.cost > 0 && <span>⚡ {job.cost} CU</span>}
                        {job.video_url && (
                          <a
                            href={job.video_url}
                            download={`manual-video-${job.id}.mp4`}
                            className="text-[#cfae80] hover:underline font-bold"
                          >
                            Unduh
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
