import React, { useState, useEffect, useRef } from 'react';
import api from '../utils/api';
import { Box, Loader, Upload, X, Download, ExternalLink, Sparkles, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from '../utils/toast';

// 3D generation tab powered by Magica's Meshy V6 (text-to-3D + image-to-3D).
// Results are .glb models previewed with <model-viewer> (orbit + play animations).
export default function ThreeD() {
  const [keys, setKeys] = useState([]);        // active Magica keys (id, label, balance)
  const [keyId, setKeyId] = useState('auto');  // chosen key or 'auto'
  const [mode, setMode] = useState('text'); // 'text' | 'image'
  const [prompt, setPrompt] = useState('');
  const [imageBase64, setImageBase64] = useState('');

  // Meshy settings (mirror the Magica Meshy V6 parameters).
  const [meshMode, setMeshMode] = useState('preview'); // 'preview' | 'full' (text mode)
  const [targetPolycount, setTargetPolycount] = useState(30000);
  const [topology, setTopology] = useState('triangle');
  const [symmetryMode, setSymmetryMode] = useState('auto');
  const [shouldRemesh, setShouldRemesh] = useState(true);
  const [shouldTexture, setShouldTexture] = useState(true);
  const [enablePbr, setEnablePbr] = useState(false);
  const [isAtPose, setIsAtPose] = useState(false);
  const [riggingHeightMeters, setRiggingHeightMeters] = useState(1.7);
  const [animationActionId, setAnimationActionId] = useState(1001);
  const [texturePrompt, setTexturePrompt] = useState('');

  const [estimate, setEstimate] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [items, setItems] = useState([]);
  const pollRef = useRef(null);

  useEffect(() => {
    fetchKeys();
    fetchList();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const fetchKeys = async () => {
    try { const r = await api.get('/magica/keys'); setKeys(r.data || []); } catch (e) {}
  };
  const fetchList = async () => {
    try { const r = await api.get('/magica/3d/list'); setItems(r.data || []); } catch (e) {}
  };

  // Debounced cost estimate whenever the inputs that affect price change.
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const body = { kind: '3d', mode: meshMode, targetPolycount };
        if (mode === 'text') { if (!prompt) { setEstimate(null); return; } body.prompt = prompt; }
        else { if (!imageBase64) { setEstimate(null); return; } body.imageUrls = ['https://example.com/x.png']; }
        const r = await api.post('/magica/estimate', body);
        setEstimate(r.data);
      } catch (e) { setEstimate(null); }
    }, 600);
    return () => clearTimeout(t);
  }, [mode, prompt, imageBase64, meshMode, targetPolycount]);

  const onPickImage = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setImageBase64(String(reader.result));
    reader.readAsDataURL(f);
  };

  const pollTask = (id) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await api.get(`/magica/3d/task/${id}`);
        if (r.data.status === 'success' || r.data.status === 'failed') {
          clearInterval(pollRef.current); pollRef.current = null;
          setGenerating(false);
          if (r.data.status === 'failed') toast.error(r.data.error_message || 'Gagal membuat 3D.');
          else toast.success('Model 3D selesai!');
          fetchList();
        }
      } catch (e) { /* keep polling */ }
    }, 4000);
  };

  const handleGenerate = async () => {
    if (mode === 'text' && !prompt.trim()) { toast.error('Isi prompt teks dulu.'); return; }
    if (mode === 'image' && !imageBase64) { toast.error('Pilih gambar dulu.'); return; }
    setGenerating(true);
    try {
      const body = {
        mode, meshMode, prompt, imageBase64: mode === 'image' ? imageBase64 : undefined,
        magicaKeyId: keyId,
        targetPolycount, topology, symmetryMode, shouldRemesh, shouldTexture, enablePbr,
        isAtPose, riggingHeightMeters, animationActionId, texturePrompt: texturePrompt || undefined,
      };
      const r = await api.post('/magica/3d/generate', body);
      toast.success('Sedang membuat model 3D... (~1-2 menit)');
      fetchList();
      pollTask(r.data.id);
    } catch (err) {
      setGenerating(false);
      toast.error(err.response?.data?.message || 'Gagal memulai 3D.');
    }
  };

  const inputCls = 'w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-[#a855f7] transition-colors';
  const labelCls = 'block text-slate-350 text-[9px] font-bold uppercase tracking-widest mb-1';

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-editorial italic text-white flex items-center gap-2.5">
          <Box className="w-6 h-6 text-[#a855f7]" /> Studio 3D <span className="text-[#a855f7] text-sm not-italic font-bold">Meshy V6</span>
        </h1>
        <p className="text-slate-400 text-[10px] uppercase tracking-widest font-semibold mt-1">Text-to-3D &amp; Image-to-3D — preview bisa diputar &amp; dianimasikan</p>
      </div>

      {keys.length === 0 && (
        <div className="mb-5 flex items-center gap-2 bg-amber-950/20 border border-amber-500/30 rounded-xl px-4 py-3 text-amber-300 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0" /> Belum ada API Key Magica aktif. Minta admin menambahkannya di Admin → API Magica.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ---- Left: form ---- */}
        <div className="bg-[#1a1918]/60 border border-[#2a2725] rounded-2xl p-4 md:p-5 space-y-4">
          <div className="flex gap-2">
            <button onClick={() => setMode('text')} className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all ${mode === 'text' ? 'bg-[#a855f7]/10 border-[#a855f7]/40 text-white' : 'border-[#2a2725] text-slate-400'}`}>Text → 3D</button>
            <button onClick={() => setMode('image')} className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all ${mode === 'image' ? 'bg-[#a855f7]/10 border-[#a855f7]/40 text-white' : 'border-[#2a2725] text-slate-400'}`}>Image → 3D</button>
          </div>

          <div>
            <label className={labelCls}>API Key Magica</label>
            <select value={keyId} onChange={(e) => setKeyId(e.target.value)} disabled={generating} className={inputCls}>
              <option value="auto">Pilih Otomatis (saldo tertinggi)</option>
              {keys.map((k) => (<option key={k.id} value={k.id}>{k.label}{k.formatted != null ? ` (⚡ ${k.formatted} kredit)` : ''}</option>))}
            </select>
          </div>

          {mode === 'text' ? (
            <div>
              <label className={labelCls}>Prompt (maks 600 karakter)</label>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value.slice(0, 600))} disabled={generating} placeholder="mis. a cute low-poly robot toy, pastel colors" className={inputCls + ' h-24 resize-none'} />
            </div>
          ) : (
            <div>
              <label className={labelCls}>Gambar Referensi (1 gambar)</label>
              {imageBase64 ? (
                <div className="relative inline-block">
                  <img src={imageBase64} alt="ref" className="h-32 rounded-xl border border-[#2a2725] object-cover" />
                  <button onClick={() => setImageBase64('')} className="absolute -top-2 -right-2 bg-black/80 border border-[#2a2725] rounded-full p-1 text-slate-300 hover:text-white"><X className="w-3 h-3" /></button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center gap-2 h-32 border border-dashed border-[#2a2725] rounded-xl cursor-pointer text-slate-500 hover:border-[#a855f7]/40 hover:text-slate-300 transition-colors">
                  <Upload className="w-5 h-5" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider">Pilih gambar</span>
                  <input type="file" accept="image/*" onChange={onPickImage} className="hidden" />
                </label>
              )}
              <p className="text-[8px] text-slate-500 mt-1">Butuh PUBLIC_URL aktif di server agar Magica bisa mengambil gambarnya.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {mode === 'text' && (
              <div>
                <label className={labelCls}>Kualitas</label>
                <select value={meshMode} onChange={(e) => setMeshMode(e.target.value)} disabled={generating} className={inputCls}>
                  <option value="preview">Preview (cepat &amp; murah)</option>
                  <option value="full">Full (detail penuh)</option>
                </select>
              </div>
            )}
            <div>
              <label className={labelCls}>Target Polycount</label>
              <input type="number" min={100} max={300000} value={targetPolycount} onChange={(e) => setTargetPolycount(Number(e.target.value))} disabled={generating} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Topologi</label>
              <select value={topology} onChange={(e) => setTopology(e.target.value)} disabled={generating} className={inputCls}>
                <option value="triangle">Triangle</option>
                <option value="quad">Quad</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Simetri</label>
              <select value={symmetryMode} onChange={(e) => setSymmetryMode(e.target.value)} disabled={generating} className={inputCls}>
                <option value="auto">Auto</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Texture Prompt (opsional)</label>
            <input type="text" value={texturePrompt} onChange={(e) => setTexturePrompt(e.target.value)} disabled={generating} placeholder="mis. shiny metallic finish" className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-1">
            <label className="flex items-center gap-2 text-[10px] text-slate-300 cursor-pointer"><input type="checkbox" checked={shouldRemesh} onChange={(e) => setShouldRemesh(e.target.checked)} className="accent-[#a855f7]" /> Remesh (topologi bersih)</label>
            <label className="flex items-center gap-2 text-[10px] text-slate-300 cursor-pointer"><input type="checkbox" checked={shouldTexture} onChange={(e) => setShouldTexture(e.target.checked)} className="accent-[#a855f7]" /> Tekstur</label>
            <label className="flex items-center gap-2 text-[10px] text-slate-300 cursor-pointer"><input type="checkbox" checked={enablePbr} onChange={(e) => setEnablePbr(e.target.checked)} className="accent-[#a855f7]" /> PBR (metallic/roughness)</label>
            <label className="flex items-center gap-2 text-[10px] text-slate-300 cursor-pointer"><input type="checkbox" checked={isAtPose} onChange={(e) => setIsAtPose(e.target.checked)} className="accent-[#a855f7]" /> A/T-pose (untuk rigging)</label>
          </div>

          {mode === 'image' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Tinggi Rigging (m)</label>
                <input type="number" step="0.1" min={0.1} max={10} value={riggingHeightMeters} onChange={(e) => setRiggingHeightMeters(Number(e.target.value))} disabled={generating} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Animation Action ID</label>
                <input type="number" value={animationActionId} onChange={(e) => setAnimationActionId(Number(e.target.value))} disabled={generating} className={inputCls} />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-[#2a2725] pt-3">
            <span className="text-[10px] text-slate-400 font-semibold">
              {estimate ? <>Estimasi biaya: <span className="text-[#a855f7] font-bold">≈ {estimate.credits.toFixed(3)} kredit</span></> : 'Estimasi biaya: —'}
            </span>
            <button onClick={handleGenerate} disabled={generating || keys.length === 0} className="bg-[#a855f7] hover:bg-[#9333ea] text-white font-bold py-2 px-5 rounded-xl transition-all text-[10px] uppercase tracking-wider flex items-center gap-2 disabled:opacity-50">
              {generating ? <><Loader className="animate-spin w-3.5 h-3.5" /> Membuat...</> : <><Sparkles className="w-3.5 h-3.5" /> Buat 3D</>}
            </button>
          </div>
        </div>

        {/* ---- Right: gallery ---- */}
        <div className="bg-[#1a1918]/60 border border-[#2a2725] rounded-2xl p-4 md:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-editorial italic text-white">Hasil 3D</h2>
            <button onClick={fetchList} className="text-slate-400 hover:text-white transition-colors"><RefreshCw className="w-3.5 h-3.5" /></button>
          </div>
          {items.length === 0 ? (
            <p className="text-slate-500 text-xs py-8 text-center">Belum ada model 3D. Buat yang pertama!</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[70vh] overflow-y-auto pr-1">
              {items.map((it) => (
                <div key={it.id} className="bg-black/30 border border-[#2a2725] rounded-xl overflow-hidden">
                  {it.status === 'success' && it.model_url ? (
                    <model-viewer
                      src={it.model_url}
                      camera-controls
                      auto-rotate
                      autoplay
                      shadow-intensity="1"
                      style={{ width: '100%', height: '220px', backgroundColor: '#0d0c0b' }}
                    ></model-viewer>
                  ) : it.status === 'failed' ? (
                    <div className="h-[220px] flex flex-col items-center justify-center gap-2 text-red-400/80 text-[10px] px-3 text-center"><AlertTriangle className="w-5 h-5" /> {it.error_message || 'Gagal'}</div>
                  ) : (
                    <div className="h-[220px] flex flex-col items-center justify-center gap-2 text-slate-500 text-[10px]"><Loader className="animate-spin w-5 h-5 text-[#a855f7]" /> Memproses...</div>
                  )}
                  <div className="p-2.5">
                    <p className="text-[10px] text-slate-300 font-semibold truncate">{it.prompt || (it.mode === 'image' ? 'Image → 3D' : '3D')}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[8.5px] text-slate-500">⚡ {(Number(it.credit_used || 0) / 1e6).toFixed(3)} kredit</span>
                      {it.status === 'success' && it.model_url && (
                        <a href={it.model_url} target="_blank" rel="noopener noreferrer" className="text-[8.5px] text-[#a855f7] font-bold uppercase tracking-wider flex items-center gap-1 hover:underline"><Download className="w-3 h-3" /> .glb</a>
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
  );
}
