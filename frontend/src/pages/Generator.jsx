import React, { useState, useEffect, useRef } from 'react';
import api from '../utils/api';
import { Sparkles, Loader, Download, ExternalLink, AlertTriangle, Terminal, X, ChevronRight, Upload, Image as ImageIcon, Zap, Sliders, Eye, UserCheck } from 'lucide-react';
import LAYOUT_STYLES from '../constants/layoutStyles';
import { toast } from '../utils/toast';
import { confirm } from '../utils/confirm';



const ENGINE_DURATIONS = {
  seedance25: [
    { value: 30, pages: 1, label: '30 Detik (1 Halaman)' },
    { value: 60, pages: 2, label: '60 Detik (2 Halaman)' },
    { value: 90, pages: 3, label: '90 Detik (3 Halaman)' },
    { value: 120, pages: 4, label: '120 Detik (4 Halaman)' }
  ],
  seedance: [
    { value: 15, pages: 1, label: '15 Detik (1 Halaman)' },
    { value: 30, pages: 2, label: '30 Detik (2 Halaman)' },
    { value: 45, pages: 3, label: '45 Detik (3 Halaman)' },
    { value: 60, pages: 4, label: '60 Detik (4 Halaman)' }
  ],
  omni: [
    { value: 10, pages: 1, label: '10 Detik (1 Halaman)' },
    { value: 20, pages: 2, label: '20 Detik (2 Halaman)' },
    { value: 30, pages: 3, label: '30 Detik (3 Halaman)' },
    { value: 40, pages: 4, label: '40 Detik (4 Halaman)' },
    { value: 50, pages: 5, label: '50 Detik (5 Halaman)' },
    { value: 60, pages: 6, label: '60 Detik (6 Halaman)' }
  ],
  veo: [
    { value: 8, pages: 1, label: '8 Detik (1 Halaman)' },
    { value: 16, pages: 2, label: '16 Detik (2 Halaman)' },
    { value: 24, pages: 3, label: '24 Detik (3 Halaman)' },
    { value: 32, pages: 4, label: '32 Detik (4 Halaman)' },
    { value: 40, pages: 5, label: '40 Detik (5 Halaman)' },
    { value: 48, pages: 6, label: '48 Detik (6 Halaman)' },
    { value: 56, pages: 7, label: '56 Detik (7 Halaman)' },
    { value: 64, pages: 8, label: '64 Detik (8 Halaman)' }
  ]
};

// How many storyboard pages (= separate image renders) the current duration maps to.
function pagesForDuration(engine, durationValue) {
  const list = ENGINE_DURATIONS[engine] || ENGINE_DURATIONS.seedance;
  const hit = list.find((o) => o.value === durationValue);
  return (hit && hit.pages) || 1;
}

export default function Generator({ setTab, selectedCharacter }) {
  const [mode, setMode] = useState('tokopedia');
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('premium_vertical_row');
  const [apiKeyId, setApiKeyId] = useState('auto');
  const [apiKeys, setApiKeys] = useState([]);
  const [gridCount, setGridCount] = useState(6);
  const [model, setModel] = useState('108');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [videoEngine, setVideoEngine] = useState('seedance');
  const [containerShape, setContainerShape] = useState('auto');
  const [duration, setDuration] = useState(30);
  const [showFace, setShowFace] = useState(false);
  const [faceMode, setFaceMode] = useState('faceless');
  const [currentCarouselIdx, setCurrentCarouselIdx] = useState(0);
  const [showLightbox, setShowLightbox] = useState(null);
  
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hoveredStyle, setHoveredStyle] = useState(null);
  const [styleSearch, setStyleSearch] = useState(''); // filter for the layout-style dropdown
  const dropdownRef = useRef(null);
  
  const [selectedRefImages, setSelectedRefImages] = useState([]);
  const getEffectivePromptMax = () => {
    if (userProvider !== 'magica') return 10000;
    const model = (magicaCatalog?.imageModels || []).find(m => m.nodeType === magicaImageModel);
    const method = (model?.methods || [])[0];
    return method?.promptMax || 10000;
  };
  const effectiveMax = getEffectivePromptMax();
  const [refGenPrompt, setRefGenPrompt] = useState('');
  const [refGenLoading, setRefGenLoading] = useState(false);
  const refGenPollRef = useRef(null);

  const [tokopediaUrl, setTokopediaUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scrapedImages, setScrapedImages] = useState([]);

  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiMatchedLayout, setAiMatchedLayout] = useState(null);
  const [aiReferenceSummary, setAiReferenceSummary] = useState('');
  const [aiReferenceStatus, setAiReferenceStatus] = useState('not_requested');
  const [aiIdeaSeed, setAiIdeaSeed] = useState('');

  const [generating, setGenerating] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState(null);
  const [taskLogs, setTaskLogs] = useState('');
  const [showLogModal, setShowLogModal] = useState(true);
  const [voMode, setVoMode] = useState('off'); // 'off' | 'script' | 'image'
  const [voMaxWords, setVoMaxWords] = useState(10);
  const [voLanguage, setVoLanguage] = useState('Bahasa Indonesia');
  const [voTone, setVoTone] = useState('casual');
  const [textOnScreen, setTextOnScreen] = useState(false); // burn stylized on-screen captions into each storyboard panel
  
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [userProvider, setUserProvider] = useState('freebeat');
  const [magicaCatalog, setMagicaCatalog] = useState(null);
  const [magicaImageModel, setMagicaImageModel] = useState('');
  const [magicaKeyId, setMagicaKeyId] = useState('auto');
  const [imgEstimate, setImgEstimate] = useState(null);
  
  const [regeneratingPages, setRegeneratingPages] = useState({});
  const [regenLogs, setRegenLogs] = useState({});
  
  const [userCharacters, setUserCharacters] = useState([]);
  const [chosenCharacter, setChosenCharacter] = useState(selectedCharacter || null);

  useEffect(() => {
    api.get('/characters').then(res => {
      setUserCharacters(res.data || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedCharacter) {
      setChosenCharacter(selectedCharacter);
    }
  }, [selectedCharacter]);

  // Automatically inject chosen character's sheet image into selectedRefImages
  useEffect(() => {
    if (chosenCharacter) {
      const charImg = chosenCharacter.sheet_image_url || (chosenCharacter.reference_images && chosenCharacter.reference_images[0]);
      if (charImg) {
        const fullPreview = getFullImageUrl(charImg);
        setSelectedRefImages(prev => {
          const exists = prev.some(img => img.url === charImg || img.value === charImg);
          if (!exists) {
            return [{ type: 'url', url: charImg, value: charImg, preview: fullPreview, label: `Karakter: ${chosenCharacter.name}`, isCharacter: true }, ...prev];
          }
          return prev;
        });
        toast.info(`Karakter "${chosenCharacter.name}" aktif! Gambar referensi otomatis ditambahkan.`);
      }
    }
  }, [chosenCharacter]);

  const pollIntervalRef = useRef(null);
  const logContainerRef = useRef(null);
  const fileInputRef = useRef(null);

  const handleDownloadClick = (e, imgUrl) => {
    const isCapacitor = window.Capacitor !== undefined;
    const platform = isCapacitor ? window.Capacitor.getPlatform() : 'web';
    
    const downloadUrl = getDownloadUrl(imgUrl);
    
    if (isCapacitor && (platform === 'ios' || platform === 'android')) {
      e.preventDefault();
      try {
        window.open(downloadUrl, '_system');
      } catch (err) {
        console.error("Capacitor download redirect error:", err);
        window.open(downloadUrl, '_blank');
      }
    }
  };

  const handleRegeneratePage = async (storyboardId, pageIdx) => {
    const confirmRegen = await confirm({ title: `Regenerasi Halaman ${pageIdx + 1}?`, message: 'Proses ini akan memakai beberapa kredit Freebeat.', confirmText: 'Regenerasi' });
    if (!confirmRegen) return;

    setRegeneratingPages(prev => ({ ...prev, [pageIdx]: true }));
    setRegenLogs(prev => ({ ...prev, [pageIdx]: 'Memulai proses regenerasi halaman...\n' }));

    try {
      const res = await api.post(`/storyboards/${storyboardId}/regenerate-page`, { pageIdx });
      const taskId = res.data.taskId;

      const interval = setInterval(async () => {
        try {
          const statusRes = await api.get(`/storyboards/tasks/${taskId}`);
          const task = statusRes.data;
          setRegenLogs(prev => ({ ...prev, [pageIdx]: task.logs || '' }));

          if (task.status === 'success') {
            clearInterval(interval);
            setRegeneratingPages(prev => ({ ...prev, [pageIdx]: false }));
            setResult(prev => ({
              ...prev,
              image_path: task.result.image_path
            }));
            toast.success(`Halaman ${pageIdx + 1} sukses diregenerasi!`);
          } else if (task.status === 'failed') {
            clearInterval(interval);
            setRegeneratingPages(prev => ({ ...prev, [pageIdx]: false }));
            toast.error(`Gagal meregenerasi Halaman ${pageIdx + 1}: ${task.error || 'Unknown error'}`);
          }
        } catch (e) {}
      }, 4000);
    } catch (err) {
      console.error(err);
      setRegeneratingPages(prev => ({ ...prev, [pageIdx]: false }));
      toast.error(err.response?.data?.message || 'Gagal meregenerasi halaman.');
    }
  };

  const fetchKeys = async () => {
    try {
      const res = await api.get('/storyboards/keys');
      setApiKeys(res.data);
      if (res.data.length > 0) {
        setApiKeyId('auto');
      }
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
          setCurrentCarouselIdx(0);
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
    api.get('/auth/me').then((r) => {
      const pp = r.data.preferred_provider || 'freebeat';
      setUserProvider(pp);
      if (pp === 'magica') {
        api.get('/magica/catalog').then((c) => {
          setMagicaCatalog(c.data);
          const imgs = (c.data && c.data.imageModels) || [];
          const def = imgs.find((m) => m.nodeType === 'gpt_image_2') || imgs[0];
          if (def) setMagicaImageModel(def.nodeType);
        }).catch(() => {});
      }
    }).catch(() => {});
    const savedTaskId = localStorage.getItem('activeTaskId');
    if (savedTaskId) {
      setCurrentTaskId(savedTaskId);
      setGenerating(true);
      setTaskLogs('Menyambungkan kembali ke proses latar belakang...\n');
      startPolling(savedTaskId);
    }
    // Preloaded reference image from clicking a "[Ref]" item in the gallery — add it
    // as a reference so the user can turn it into a storyboard here.
    try {
      const pre = localStorage.getItem('preloadRefImage');
      if (pre) {
        localStorage.removeItem('preloadRefImage');
        const obj = JSON.parse(pre);
        if (obj && obj.value) {
          setMode('manual');
          setSelectedRefImages(prev => (prev.some(p => p.value === obj.value) ? prev : [...prev, {
            id: `galref-${Date.now()}`, type: 'url', source: 'ai', value: obj.value, preview: getFullImageUrl(obj.value),
          }]));
        }
      }
    } catch (e) {}
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
  }, []);

  // Live Magica cost estimate for ONE storyboard image (per gambar).
  useEffect(() => {
    if (userProvider !== 'magica' || !magicaImageModel) { setImgEstimate(null); return; }
    const t = setTimeout(async () => {
      try {
        const r = await api.post('/magica/estimate', {
          kind: 'image', model: magicaImageModel, aspectRatio,
          imageUrls: (selectedRefImages && selectedRefImages.length) ? ['x'] : [],
        });
        setImgEstimate(r.data);
      } catch (e) { setImgEstimate(null); }
    }, 500);
    return () => clearTimeout(t);
  }, [userProvider, magicaImageModel, aspectRatio, (selectedRefImages || []).length]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
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
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedRefImages(prev => [
          ...prev,
          {
            id: 'local_' + Date.now() + '_' + Math.random(),
            type: 'base64',
            value: reader.result,
            preview: reader.result
          }
        ]);
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const toggleTokopediaImage = (imgUrl) => {
    setSelectedRefImages(prev => {
      const exists = prev.find(item => item.value === imgUrl);
      if (exists) {
        return prev.filter(item => item.value !== imgUrl);
      } else {
        return [...prev, {
          id: imgUrl,
          type: 'url',
          value: imgUrl,
          preview: imgUrl
        }];
      }
    });
  };

  const removeSelectedImage = (id) => {
    setSelectedRefImages(prev => prev.filter(item => item.id !== id));
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
      setPrompt(scrapedDesc || '');
      setScrapedImages(images || []);
      if (images && images.length > 0) {
        setSelectedRefImages(prev => {
          // Keep character references, replace or add product references
          const charRefs = prev.filter(img => img.isCharacter);
          return [
            ...charRefs,
            {
              id: images[0],
              type: 'url',
              value: images[0],
              preview: images[0]
            }
          ];
        });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal mengambil data dari Tokopedia.');
    } finally {
      setScraping(false);
    }
  };

  const [autoLayout, setAutoLayout] = useState(true);

  const handleGenerateAiPrompt = async (requestMode) => {
    const mode = requestMode === 'random_idea' ? 'random_idea' : 'expand';
    const referenceImages = selectedRefImages
      .map(item => item?.value || item?.url)
      .filter(Boolean)
      .slice(0, 3);
    // Tulis AI expands the user's brief and attached visual references. Minta Ide is
    // deliberately independent: it uses only an optional keyword, never the old draft.
    const targetConcept = mode === 'expand' ? (aiInput.trim() || prompt.trim()) : aiInput.trim();
    if (mode === 'expand' && !targetConcept && referenceImages.length === 0) {
      setAiError('Tulis AI memerlukan ide teks atau minimal satu gambar referensi.');
      return;
    }
    setAiLoading(true);
    setAiError('');
    setAiMatchedLayout(null);
    setAiReferenceSummary('');
    setAiReferenceStatus('not_requested');
    setAiIdeaSeed('');
    try {
      const endpoint = mode === 'random_idea' ? '/ai/random-idea' : '/ai/write-prompt';
      const res = await api.post(endpoint, {
        concept: targetConcept,
        style: autoLayout ? 'auto' : style,
        videoEngine,
        gridCount,
        duration,
        aspectRatio,
        refImages: mode === 'expand' ? referenceImages : [],
        characterId: chosenCharacter ? chosenCharacter.id : undefined
      });
      const { title: aiTitle, description: aiDesc, layout: aiLayout, referenceSummary, referenceAnalysisStatus, ideaSeed } = res.data;
      setTitle(aiTitle || '');
      setPrompt(aiDesc || '');
      setAiReferenceSummary(referenceSummary || '');
      setAiReferenceStatus(referenceAnalysisStatus || 'not_requested');
      setAiIdeaSeed(ideaSeed || '');
      if (aiLayout) {
        setStyle(aiLayout);
        const matchOpt = LAYOUT_STYLES.find(opt => opt.value === aiLayout);
        if (matchOpt) setAiMatchedLayout(matchOpt.label);
      }
      setAiInput('');
    } catch (err) {
      setAiError(err.response?.data?.message || 'Gagal generate prompt dengan AI.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleEngineChange = (engine) => {
    setVideoEngine(engine);
    const defaults = { seedance: 30, omni: 30, veo: 32 };
    setDuration(defaults[engine] || 15);
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (userProvider !== 'magica' && (!apiKeyId || apiKeys.length === 0)) { setError('Admin belum mengonfigurasi API Key.'); return; }
    setError('');
    setResult(null);
    setTaskLogs('');
    setGenerating(true);

    const firstRef = selectedRefImages[0];
    const legacyBase64 = firstRef?.type === 'base64' ? firstRef.value : '';
    const legacyUrl = firstRef?.type === 'url' ? firstRef.value : '';
    const refImages = selectedRefImages.map(item => {
      if (item.type === 'base64') return { base64: item.value };
      return { url: item.value };
    });

    try {
      const finalTitle = mode === 'manual' ? (prompt.substring(0, 30).trim() || 'Manual Project') + '...' : title;
      // A selected character is passed by ID and used as an image-only reference in
      // the background job. Do not inject its trigger/profile text into the concept.
      const finalPrompt = prompt;

      const res = await api.post('/storyboards/generate', { 
        title: finalTitle, 
        prompt: finalPrompt, 
        style, 
        apiKeyId, 
        refImageBase64: legacyBase64, 
        refImageUrl: legacyUrl, 
        refImages,
        gridCount, 
        model, 
        duration,
        showFace,
        faceMode,
        aspectRatio,
        enableVo: voMode !== 'off',
        enableVoScript: voMode === 'script',
        enableVoImage: voMode === 'image',
        voMaxWords,
        voLanguage: voMode !== 'off' ? voLanguage : undefined,
        voTone: voMode !== 'off' ? voTone : undefined,
        videoEngine,
        containerShape,
        textOnScreen,
        magicaModel: userProvider === 'magica' ? magicaImageModel : undefined,
        magicaKeyId: userProvider === 'magica' ? magicaKeyId : undefined,
        characterId: chosenCharacter ? chosenCharacter.id : undefined
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
    if (path.startsWith('http') || path.startsWith('data:')) return path;

    const base = import.meta.env.VITE_API_URL || (api && api.defaults ? api.defaults.baseURL : '') || '/api';
    let cleanPath = path;
    if (cleanPath.startsWith('/uploads/')) {
      cleanPath = cleanPath.slice(1);
    } else if (cleanPath.startsWith('uploads/')) {
      cleanPath = cleanPath;
    } else {
      cleanPath = cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath;
    }

    if (base && base.startsWith('http')) {
      try {
        const origin = new URL(base).origin;
        return `${origin}/${cleanPath}`;
      } catch (e) {
        return `/${cleanPath}`;
      }
    }
    return `/${cleanPath}`;
  };

  // Build an authenticated download URL. The JWT is appended as ?token= because
  // downloads happen via browser navigation / window.open (mobile), which cannot
  // send an Authorization header.
  const getDownloadUrl = (imgUrl) => {
    const full = getFullImageUrl(imgUrl);
    const cleanUrl = full.startsWith('http') ? full : `${window.location.origin}${full.startsWith('/') ? '' : '/'}${full}`;
    const cleanBase = api.defaults.baseURL ? api.defaults.baseURL.replace(/\/api$/, '') : '';
    const token = localStorage.getItem('token');
    return `${cleanBase}/api/storyboards/download?url=${encodeURIComponent(cleanUrl)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
  };

  const getPreviewUrl = (styleName) => {
    if (!styleName) return '';
    return '';
  };

  // Text-to-Image: generate a reference image from a prompt (optional feature).
  const handleGenerateRefImage = async () => {
    if (!refGenPrompt.trim() || refGenLoading) return;
    setRefGenLoading(true);
    try {
      const res = await api.post('/storyboards/generate-ref-image', { prompt: refGenPrompt, aspectRatio });
      const taskId = res.data?.taskId;
      if (!taskId) { setRefGenLoading(false); toast.error('Gagal memulai. Coba lagi.'); return; }
      // Poll patiently — background task like a storyboard, NO timeout. To cancel,
      // the user just starts a new project.
      if (refGenPollRef.current) clearInterval(refGenPollRef.current);
      refGenPollRef.current = setInterval(async () => {
        try {
          const s = await api.get(`/storyboards/tasks/${taskId}`);
          const t = s.data;
          if (t.status === 'success') {
            clearInterval(refGenPollRef.current); refGenPollRef.current = null;
            const url = t.result?.url;
            if (url) {
              setSelectedRefImages(prev => [...prev, { id: `aigen-${Date.now()}`, type: 'url', source: 'ai', value: url, preview: getFullImageUrl(url) }]);
              setRefGenPrompt('');
            }
            setRefGenLoading(false);
          } else if (t.status === 'failed') {
            clearInterval(refGenPollRef.current); refGenPollRef.current = null;
            setRefGenLoading(false);
            toast.error(t.error || 'Gagal membuat gambar referensi.');
          }
          // else: still processing — keep waiting patiently.
        } catch (e) { /* task may not be ready yet; keep polling */ }
      }, 4000);
    } catch (err) {
      setRefGenLoading(false);
      toast.error(err.response?.data?.message || 'Gagal memulai pembuatan gambar.');
    }
  };

  const renderRefImagesSection = () => (
    <div className="bg-[#131211]/50 border border-[#2a2725] rounded-xl p-3 space-y-2.5">
      <div className="flex justify-between items-center">
        <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest">Referensi Gambar ({selectedRefImages.length})</label>
        <button 
          type="button" 
          onClick={() => fileInputRef.current?.click()} 
          className="text-[9px] font-bold text-[#cfae80] hover:underline uppercase tracking-wider flex items-center gap-1 cursor-pointer"
          disabled={generating}
        >
          <Upload className="w-3 h-3" /> Unggah File
        </button>
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
          className="hidden" 
          multiple 
          accept="image/*" 
        />
      </div>

      {selectedRefImages.length > 0 ? (
        <div className="grid grid-cols-4 gap-2 pt-1">
          {selectedRefImages.map((img) => (
            <div key={img.id} className="relative aspect-square rounded-lg overflow-hidden border border-[#2a2725] group bg-black/40">
              <img src={getFullImageUrl(img.preview || img.url || img.value)} alt="Preview" className="w-full h-full object-cover" />
              <button 
                type="button" 
                onClick={() => removeSelectedImage(img.id)} 
                className="absolute top-1 right-1 p-1 bg-black/85 text-red-400 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 hover:text-white cursor-pointer"
                disabled={generating}
              >
                <X className="w-2.5 h-2.5" />
              </button>
              {img.type === 'url' && img.source === 'ai' && (
                <span className="absolute bottom-1 left-1 px-1 py-0.5 bg-black/80 text-[7px] text-emerald-400 rounded font-bold uppercase">
                  AI
                </span>
              )}
              {img.type === 'url' && img.source !== 'ai' && (
                <span className="absolute bottom-1 left-1 px-1 py-0.5 bg-black/80 text-[7px] text-[#cfae80] rounded font-bold uppercase">
                  Tokopedia
                </span>
              )}
              {img.type === 'base64' && (
                <span className="absolute bottom-1 left-1 px-1 py-0.5 bg-black/80 text-[7px] text-sky-400 rounded font-bold uppercase">
                  Lokal
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[9px] text-slate-500 text-center py-2 border border-dashed border-[#2a2725] rounded-lg">
          {mode === 'tokopedia' 
            ? 'Tidak ada referensi gambar terpilih. Klik gambar Tokopedia di atas atau unggah gambar lokal.'
            : 'Tidak ada referensi gambar terpilih. Unggah gambar produk Anda di atas.'}
        </div>
      )}

      {/* Text-to-Image: buat ref image dari prompt (OPSIONAL) */}
      <div className="pt-2.5 border-t border-[#2a2725]/60 space-y-1.5">
        <label className="text-slate-350 text-[9px] font-bold uppercase tracking-widest flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-[#cfae80]" /> Buat Ref dari Teks (AI) — opsional
        </label>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={refGenPrompt}
            onChange={(e) => setRefGenPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleGenerateRefImage(); } }}
            placeholder="Contoh: sepatu lari futuristik hitam-emas, studio"
            className="flex-grow bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-700 focus:outline-none focus:border-[#cfae80] transition-all"
            disabled={refGenLoading || generating}
          />
          <button
            type="button"
            onClick={handleGenerateRefImage}
            disabled={refGenLoading || generating || !refGenPrompt.trim()}
            className="bg-[#cfae80]/10 border border-[#cfae80]/25 hover:bg-[#cfae80] hover:text-black text-[#cfae80] font-bold text-[9px] px-3 py-2 rounded-xl transition-all disabled:opacity-40 flex items-center justify-center shrink-0 gap-1"
          >
            {refGenLoading ? <><Loader className="animate-spin w-3.5 h-3.5" /> Proses</> : <><Sparkles className="w-3 h-3" /> Buat</>}
          </button>
        </div>
        {refGenLoading ? (
          <p className="text-[8px] text-[#cfae80] leading-relaxed animate-pulse">Sedang membuat gambar referensi di latar belakang… tunggu ya (bisa agak lama). Untuk batal, cukup buat project baru.</p>
        ) : (
          <p className="text-[8px] text-slate-500 leading-relaxed">Gambar hasil AI otomatis jadi referensi (model 108, kualitas tinggi). Proses di latar belakang, tanpa batas waktu.</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="p-1 sm:p-4 md:p-6 space-y-3 sm:space-y-6 animate-fadeIn relative">
      <div className="hidden sm:flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#1a1918]/60 border border-[#2a2725] p-3.5 sm:p-6 rounded-2xl md:rounded-3xl backdrop-blur-md">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-4xl font-editorial italic text-white tracking-tight flex items-center gap-2">
            <Sparkles className="w-5 h-5 md:w-6 md:h-6 text-[#cfae80] fill-[#cfae80]/10" />
            Generator Storyboard AI
          </h1>
          <p className="text-slate-400 text-[10px] sm:text-xs mt-1.5 font-medium tracking-wide">Ciptakan visualisasi alur storyboard video promosi berkualitas tinggi secara instan.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-8 items-start">
        <form onSubmit={handleGenerate} className={`lg:col-span-5 bg-[#1a1918]/60 border border-[#2a2725] rounded-2xl p-3 sm:p-4 md:p-5 space-y-3 md:space-y-4.5 backdrop-blur-md relative ${dropdownOpen ? 'z-40' : 'z-10'}`}>
          <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/25 to-transparent"></div>
          <div className="flex items-center gap-1.5 border-b border-[#2a2725] pb-2">
            <Sliders className="w-3.5 h-3.5 text-[#cfae80]" />
            <h3 className="text-[9px] font-bold text-white uppercase tracking-widest">Parameter Kreatif</h3>
          </div>

          {/* Mode Selector Buttons */}
          <div className="flex bg-black/40 border border-[#2a2725] rounded-xl p-1 gap-1">
            <button
              type="button"
              onClick={() => setMode('tokopedia')}
              className={`flex-1 text-[9.5px] font-bold uppercase tracking-widest py-2 rounded-lg transition-all ${
                mode === 'tokopedia'
                  ? 'bg-[#cfae80] text-black shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              Tokopedia
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`flex-1 text-[9.5px] font-bold uppercase tracking-widest py-2 rounded-lg transition-all ${
                mode === 'manual'
                  ? 'bg-[#cfae80] text-black shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              Manual
            </button>
          </div>

          {/* CONSISTENT CHARACTER SELECTOR */}
          <div className="bg-[#131211]/50 border border-[#2a2725] rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-slate-350 text-[9px] font-bold uppercase tracking-widest flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-[#cfae80]" /> Karakter Konsisten (Opsional)
              </label>
              <button
                type="button"
                onClick={() => setTab('characters')}
                className="text-[9px] text-[#cfae80] hover:underline font-semibold"
              >
                + Kelola Karakter
              </button>
            </div>

            <select
              value={chosenCharacter ? chosenCharacter.id : ''}
              onChange={(e) => {
                const found = userCharacters.find(c => String(c.id) === e.target.value);
                setChosenCharacter(found || null);
                if (setSelectedCharacter) setSelectedCharacter(found || null);
              }}
              className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#cfae80]"
            >
              <option value="">-- Tanpa Karakter Konsisten --</option>
              {userCharacters.map((char) => (
                <option key={char.id} value={char.id}>
                  {char.name} {char.tagline ? `(${char.tagline})` : ''}
                </option>
              ))}
            </select>

            {chosenCharacter && (
              <div className="p-2.5 bg-[#cfae80]/10 border border-[#cfae80]/30 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  {(chosenCharacter.sheet_image_url || (chosenCharacter.reference_images && chosenCharacter.reference_images[0])) ? (
                    <img src={getFullImageUrl(chosenCharacter.sheet_image_url || chosenCharacter.reference_images[0])} alt={chosenCharacter.name} className="w-8 h-8 rounded-lg object-cover border border-[#cfae80]/40 shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-[#cfae80]/20 flex items-center justify-center text-[#cfae80] font-bold text-xs shrink-0">
                      {chosenCharacter.name.charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">{chosenCharacter.name}</p>
                    <p className="text-[9px] text-[#cfae80] font-mono truncate">{chosenCharacter.visual_tone || 'Aktif'}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setChosenCharacter(null); if (setSelectedCharacter) setSelectedCharacter(null); }}
                  className="p-1 text-slate-400 hover:text-red-400"
                  title="Lepas Karakter"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {mode === 'tokopedia' && (
            <div className="bg-[#131211]/50 border border-[#2a2725] rounded-xl p-3 space-y-2.5">
              <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest">Auto-Fill via Link Tokopedia (Opsional)</label>
              <div className="flex gap-2">
                <input type="text" value={tokopediaUrl} onChange={(e) => setTokopediaUrl(e.target.value)} className="flex-grow bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-700 focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all" placeholder="Masukkan URL produk Tokopedia..." disabled={scraping || generating} />
                <button type="button" onClick={handleScrape} disabled={scraping || generating || !tokopediaUrl} className="bg-[#cfae80]/10 border border-[#cfae80]/20 hover:bg-[#cfae80] hover:text-black text-[#cfae80] font-bold text-[9px] px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 flex items-center justify-center shrink-0">{scraping ? <Loader className="animate-spin w-3.5 h-3.5" /> : 'Isi Form'}</button>
              </div>
              {scrapedImages.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-[#2a2725]">
                  <span className="text-[8.5px] text-slate-400 font-bold uppercase tracking-wider block">Pilih Gambar Produk:</span>
                  <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                    {scrapedImages.map((imgUrl, idx) => {
                      const isSelected = selectedRefImages.some(item => item.value === imgUrl);
                      const selectedIndex = selectedRefImages.findIndex(item => item.value === imgUrl) + 1;
                      return (
                        <button 
                          key={idx} 
                          type="button" 
                          onClick={() => toggleTokopediaImage(imgUrl)} 
                          className={`relative shrink-0 w-10 h-10 rounded-lg overflow-hidden border transition-all ${isSelected ? 'border-[#cfae80] ring-1 ring-[#cfae80]/30' : 'border-[#2a2725] hover:border-slate-650'}`}
                        >
                          <img src={imgUrl} alt={`Scraped ${idx}`} className="w-full h-full object-cover" />
                          {isSelected && (
                            <div className="absolute top-0.5 right-0.5 bg-[#cfae80] text-black text-[8px] font-extrabold w-3.5 h-3.5 rounded-full flex items-center justify-center shadow-md">
                              {selectedIndex}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className={`relative ${dropdownOpen ? 'z-50' : 'z-10'}`} ref={dropdownRef}>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest">Gaya Layout Storyboard</label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoLayout}
                  onChange={(e) => setAutoLayout(e.target.checked)}
                  className="w-3 h-3 accent-[#cfae80] rounded cursor-pointer"
                />
                <span className="text-[9px] font-bold text-[#cfae80] uppercase tracking-wider">Auto Pilih (AI)</span>
              </label>
            </div>
            <button type="button" onClick={() => { setDropdownOpen(!dropdownOpen); setStyleSearch(''); }} className={`w-full bg-black/40 border rounded-xl px-3.5 py-2.5 text-white focus:outline-none transition-all text-xs text-left flex justify-between items-center ${autoLayout ? 'border-[#cfae80]/40 bg-[#cfae80]/5' : 'border-[#2a2725] focus:border-[#cfae80]'}`} disabled={generating}>
              <span className="truncate flex items-center gap-1.5">
                {autoLayout && <Sparkles className="w-3 h-3 text-[#cfae80] inline shrink-0" />}
                {LAYOUT_STYLES.find(opt => opt.value === style)?.label || 'Pilih Gaya Layout'}
                {autoLayout && <span className="text-[9px] text-[#cfae80] font-normal italic">(Dipilih Otomatis AI)</span>}
              </span>
              <ChevronRight className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${dropdownOpen ? 'rotate-90' : ''}`} />
            </button>
            {dropdownOpen && (
              <div className="absolute left-0 mt-1.5 w-full bg-[#1a1918] border border-[#2a2725] rounded-xl shadow-2xl z-50 flex flex-col max-h-72">
                {/* Search box to filter layout styles by name / description / category */}
                <div className="p-2 border-b border-[#2a2725] shrink-0">
                  <input
                    type="text"
                    autoFocus
                    value={styleSearch}
                    onChange={(e) => setStyleSearch(e.target.value)}
                    placeholder="Cari gaya layout… (mis. edukasi, iklan, ASMR)"
                    className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[11px] focus:outline-none focus:border-[#cfae80] transition-all"
                  />
                </div>
                <div className="flex-grow overflow-y-auto py-1 divide-y divide-[#2a2725] scrollbar-thin">
                  {(() => {
                    const q = styleSearch.trim().toLowerCase();
                    const filtered = q
                      ? LAYOUT_STYLES.filter((o) => `${o.label} ${o.desc} ${o.category || ''}`.toLowerCase().includes(q))
                      : LAYOUT_STYLES;
                    if (filtered.length === 0) {
                      return <div className="px-3 py-4 text-[10px] text-slate-500 text-center">Tidak ada gaya cocok "{styleSearch}"</div>;
                    }
                    return filtered.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => { setStyle(opt.value); setAutoLayout(false); setDropdownOpen(false); setHoveredStyle(null); setAiMatchedLayout(null); setStyleSearch(''); }}
                        onMouseEnter={() => setHoveredStyle(opt.value)}
                        onMouseLeave={() => setHoveredStyle(null)}
                        className={`w-full text-left px-3 py-2.5 hover:bg-[#cfae80]/10 text-xs transition-colors flex flex-col gap-0.5 ${style === opt.value ? 'bg-[#cfae80]/20 text-white font-bold' : 'text-slate-350'}`}
                      >
                        <span className="truncate">{opt.label}</span>
                        <span className="text-[9px] text-slate-500 font-normal">{opt.desc}</span>
                      </button>
                    ));
                  })()}
                </div>
              </div>
            )}
            


            {(style === 'capsule_transform' || style === 'capsule_toss_transform') && (
              <div className="mt-3 space-y-1.5 animate-fadeIn">
                <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest">Bentuk Wadah Awal (Kotak/Kapsul)</label>
                <select 
                  value={containerShape} 
                  onChange={(e) => setContainerShape(e.target.value)} 
                  className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs"
                  disabled={generating}
                >
                  <option value="auto" className="bg-[#1a1918]">Otomatis (Deteksi dari Judul)</option>
                  <option value="rectangular_block" className="bg-[#1a1918]">Kotak Balok Ramping (Cocok untuk Motor/Sepeda)</option>
                  <option value="cube" className="bg-[#1a1918]">Kubus Geometris Kokoh (Cocok untuk Gedung/Rumah)</option>
                  <option value="low_profile_box" className="bg-[#1a1918]">Kapsul Ceper / Aerodinamis (Cocok untuk Mobil)</option>
                  <option value="cylindrical_capsule" className="bg-[#1a1918]">Kapsul Silinder Bulat (Cocok untuk Gadget/Mainan Klasik)</option>
                  <option value="sphere" className="bg-[#1a1918]">Kubah Bola Bulat (Cocok untuk Robot/Mainan Bulat)</option>
                </select>
              </div>
            )}

            {aiMatchedLayout && (
              <p className="text-[9px] text-[#cfae80] mt-2 font-medium flex items-center gap-1 animate-fadeIn">
                <span>✨</span> Ide mengikuti gaya layout: <strong className="underline">{aiMatchedLayout}</strong>
              </p>
            )}
          </div>

          {/* Manual Mode only: Referensi Gambar (Moved below layout style) */}
          {mode === 'manual' && renderRefImagesSection()}

          {/* Engine Video */}
          <div>
            <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest mb-1">Engine Video</label>
            <select value={videoEngine} onChange={(e) => handleEngineChange(e.target.value)} className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs" disabled={generating}>
              <option value="seedance25">SeedDance 2.5 Pro (30 Detik/Panel)</option>
              <option value="seedance">SeedDance 1.0 (15 Detik/Panel)</option>
              <option value="omni">Omni (10 Detik/Panel)</option>
              <option value="veo">Veo (8 Detik/Panel)</option>
            </select>
          </div>

          {/* Jumlah Panel and Durasi Video */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest mb-1">Jumlah Panel</label>
              <select value={gridCount} onChange={(e) => setGridCount(Number(e.target.value))} className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs" disabled={generating}>
                <option value={4}>4 Panel</option>
                <option value={6}>6 Panel</option>
                <option value={8}>8 Panel</option>
                <option value={9}>9 Panel</option>
                <option value={12}>12 Panel</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-355 text-[9px] font-bold uppercase tracking-widest mb-1">Durasi Video</label>
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs" disabled={generating}>
                {(ENGINE_DURATIONS[videoEngine] || ENGINE_DURATIONS.seedance).map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Model Generator AI */}
          <div>
            <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest mb-1">Model Generator AI{userProvider === 'magica' ? ' (Magica)' : ''}</label>
            {userProvider === 'magica' ? (
              <select value={magicaImageModel} onChange={(e) => setMagicaImageModel(e.target.value)} className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#a855f7] transition-all text-xs" disabled={generating}>
                {((magicaCatalog && magicaCatalog.imageModels) || []).map((m) => (
                  <option key={m.nodeType} value={m.nodeType}>{m.name}</option>
                ))}
                {(!magicaCatalog || !((magicaCatalog.imageModels || []).length)) && <option value="">Memuat model Magica...</option>}
              </select>
            ) : (
              <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs" disabled={generating}>
                <option value="80">Nano Banana 2 (Model 80)</option>
                <option value="64">Nano Banana Pro (Model 64)</option>
                <option value="108">GPT-Image 2 (Model 108)</option>
                <option value="100">Wan V2.7 Pro (Model 100)</option>
                <option value="99">Wan V2.7 (Model 99)</option>
              </select>
            )}
          </div>

          {/* Ukuran Gambar (Aspect Ratio) */}
          <div>
            <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest mb-1">Ukuran Gambar (Aspect Ratio)</label>
            <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs" disabled={generating}>
              <option value="1:1">1:1 (Square)</option>
              <option value="16:9">16:9 (Landscape)</option>
              <option value="9:16">9:16 (Portrait)</option>
            </select>
          </div>

          {/* AI Prompt Assistant (Available in both Manual & Tokopedia mode) */}
          <div className="bg-[#131211]/50 border border-[#2a2725]/60 hover:border-[#cfae80]/20 rounded-xl p-3 space-y-2.5 transition-colors relative animate-fadeIn">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#cfae80]" />
                <span className="text-[9px] font-bold uppercase tracking-widest text-[#cfae80]">AI Prompt Assistant</span>
              </div>
              <span className="text-[8px] text-slate-500 font-mono">Pembersih Teks & Auto Layout</span>
            </div>
            
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                placeholder="Tulis brief untuk Tulis AI, atau kata kunci opsional untuk Minta Ide"
                className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-700 focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all"
                disabled={aiLoading || generating}
              />
              {selectedRefImages.length > 0 && (
                <p className="flex items-center gap-1 text-[8px] text-emerald-300/90 font-medium">
                  <Eye className="w-3 h-3" /> Tulis AI akan menganalisis {Math.min(selectedRefImages.length, 3)} gambar referensi yang dipilih.
                </p>
              )}
              <p className="text-[8px] text-slate-500 leading-relaxed">Minta Ide membuat konsep baru dari kata kunci opsional dan layout; draft serta gambar referensi saat ini tidak dikirim.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleGenerateAiPrompt('expand')}
                  className="flex-grow bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-1.5 rounded-lg transition-all text-[8.5px] uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
                  disabled={aiLoading || generating || (!aiInput.trim() && !prompt.trim() && selectedRefImages.length === 0)}
                  title="Menganalisis brief dan gambar referensi yang dipilih untuk membuat storyboard yang sesuai produk nyata"
                >
                  {aiLoading ? <Loader className="animate-spin w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                  Tulis AI
                </button>
                <button
                  type="button"
                  onClick={() => handleGenerateAiPrompt('random_idea')}
                  className="flex-grow bg-[#1a1918] hover:bg-[#2a2725] text-[#cfae80] border border-[#cfae80]/20 font-bold py-1.5 rounded-lg transition-all text-[8.5px] uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
                  title="Membuat konsep acak baru; hanya kata kunci opsional dan layout yang dipilih dipakai"
                  disabled={aiLoading || generating}
                >
                  {aiLoading ? <Loader className="animate-spin w-3 h-3" /> : <Sparkles className="w-3 h-3 text-[#cfae80]" />}
                  Minta Ide
                </button>
              </div>
            </div>
            
            {aiReferenceSummary && aiReferenceStatus === 'analyzed' && (
              <p className="text-[9px] text-emerald-300 mt-1 font-medium">Referensi terdeteksi: {aiReferenceSummary}</p>
            )}
            {aiReferenceStatus === 'text_fallback' && (
              <p className="text-[9px] text-amber-300 mt-1 font-medium">Gambar tidak berhasil dianalisis; hasil dibuat hanya dari brief teks, tanpa menebak detail produk.</p>
            )}
            {aiIdeaSeed && (
              <p className="text-[8px] text-slate-500 font-mono">Ide acak: {aiIdeaSeed}</p>
            )}
            {aiError && (
              <p className="text-[9px] text-red-400 mt-1 font-medium">{aiError}</p>
            )}
          </div>

          {/* Manual Mode only: Prompt */}
          {mode === 'manual' && (
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest">Prompt</label>
                <span className={`text-[9px] font-mono transition-colors duration-200 ${prompt.length > effectiveMax ? 'text-red-400 font-bold' : 'text-slate-500'}`}>
                  {prompt.length} / {effectiveMax}
                </span>
              </div>
              <textarea 
                value={prompt} 
                onChange={(e) => setPrompt(e.target.value)} 
                rows={3} 
                className={`w-full bg-black/40 border rounded-xl px-3.5 py-2.5 text-white placeholder-slate-700 focus:outline-none focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs resize-none ${prompt.length > effectiveMax ? 'border-red-500 focus:border-red-500' : 'border-[#2a2725] focus:border-[#cfae80]'}`}
                placeholder="Tulis prompt visual yang detail untuk storyboard Anda..."
                required={mode === 'manual'}
                disabled={generating} 
              />
              {prompt.length > effectiveMax && (
                <p className="text-[9px] text-red-400 mt-1 font-medium">⚠️ Deskripsi terlalu panjang. Hapus beberapa karakter hingga di bawah {effectiveMax}.</p>
              )}
            </div>
          )}

          {/* Tokopedia Mode only: Judul Proyek */}
          {mode === 'tokopedia' && (
            <div>
              <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest mb-1">Judul Proyek</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3.5 py-2.5 text-white placeholder-slate-700 focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs" placeholder="Contoh: Iklan Mainan Anak Lego" required={mode === 'tokopedia'} disabled={generating} />
            </div>
          )}

          {/* Tokopedia Mode only: Deskripsi Video / Ide Utama */}
          {mode === 'tokopedia' && (
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest">Deskripsi Video / Ide Utama</label>
                <span className={`text-[9px] font-mono transition-colors duration-200 ${prompt.length > effectiveMax ? 'text-red-400 font-bold' : 'text-slate-500'}`}>
                  {prompt.length} / {effectiveMax}
                </span>
              </div>
              <textarea 
                value={prompt} 
                onChange={(e) => setPrompt(e.target.value)} 
                rows={3} 
                className={`w-full bg-black/40 border rounded-xl px-3.5 py-2.5 text-white placeholder-slate-700 focus:outline-none focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs resize-none ${prompt.length > effectiveMax ? 'border-red-500 focus:border-red-500' : 'border-[#2a2725] focus:border-[#cfae80]'}`}
                placeholder="Jelaskan alur, aksi produk, atau ide utama cerita..." 
                required={mode === 'tokopedia'}
                disabled={generating} 
              />
              {prompt.length > effectiveMax && (
                <p className="text-[9px] text-red-400 mt-1 font-medium">⚠️ Deskripsi terlalu panjang. Hapus beberapa karakter hingga di bawah {effectiveMax}.</p>
              )}
            </div>
          )}

          {/* Tokopedia Mode only: Referensi Gambar (At the bottom) */}
          {mode === 'tokopedia' && renderRefImagesSection()}

          {userProvider === 'magica' ? (
            <div>
              <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest mb-1">Pilih API Key Magica</label>
              <select
                value={magicaKeyId}
                onChange={(e) => setMagicaKeyId(e.target.value)}
                disabled={generating}
                className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#a855f7] transition-all text-xs"
              >
                <option value="auto">Pilih Otomatis (Auto-detect)</option>
                {(((magicaCatalog && magicaCatalog.keys) || []).length)
                  ? magicaCatalog.keys.map((k) => { const low = k.balance != null && k.balance < 1000000; return (<option key={k.id} value={k.id} disabled={low}>{k.label}{k.formatted != null ? ` (⚡ ${k.formatted} kredit)` : ''}{low ? ' — Saldo tipis (< 1 kredit)' : ''}</option>); })
                  : <option value="" disabled>Belum ada API Key Magica aktif</option>}
              </select>
              <p className="text-[8px] text-slate-500 mt-1">Provider: Magica — "Auto" memilih key aktif pertama dari kolam.</p>
            </div>
          ) : apiKeys.length > 0 ? (
            <div>
              <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest mb-1">Pilih API Key Freebeat</label>
              <select
                value={apiKeyId}
                onChange={(e) => setApiKeyId(e.target.value)}
                className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs"
                disabled={generating}
              >
                <option value="auto">Pilih Otomatis (Auto-detect)</option>
                {apiKeys.map((k) => (
                  <option key={k.id} value={k.id} disabled={k.in_use}>
                    {k.label} (Terpakai: {k.total_credits || 0} Kredit) {k.in_use ? ' - Sedang Digunakan' : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="bg-black/20 border border-[#2a2725] rounded-xl p-3 transition-all hover:border-[#cfae80]/30">
            <label htmlFor="faceMode" className="text-[10px] font-bold text-slate-300 select-none block mb-1.5">
              Mode Wajah
              <span className="block text-[8.5px] text-slate-500 font-normal mt-0.5">"Sampai Dagu" aman untuk video Seedance (tanpa wajah utuh).</span>
            </label>
            <select
              id="faceMode"
              value={faceMode}
              onChange={(e) => setFaceMode(e.target.value)}
              disabled={generating}
              className="w-full bg-black border border-[#2a2725] rounded-lg px-2 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#cfae80]/50 cursor-pointer"
            >
              <option value="faceless">Tanpa Wajah (fokus produk/tangan)</option>
              <option value="chin_max">Sampai Dagu (aman Seedance)</option>
              <option value="full">Wajah Penuh (Seedance mungkin tolak)</option>
            </select>
          </div>

          {/* Voice Over settings */}
          <div className="bg-[#131211]/30 border border-[#2a2725] rounded-xl p-3 space-y-2.5">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-300">Pengaturan Voice Over (VO)</div>
            
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input 
                  type="radio" 
                  name="voMode"
                  value="off"
                  checked={voMode === 'off'} 
                  onChange={() => setVoMode('off')} 
                  className="border-[#2a2725] bg-black text-[#cfae80] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                  disabled={generating}
                />
                <span className="text-xs text-slate-400 font-medium">Tanpa Voiceover (Nonaktif)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input 
                  type="radio" 
                  name="voMode"
                  value="script"
                  checked={voMode === 'script'} 
                  onChange={() => setVoMode('script')} 
                  className="border-[#2a2725] bg-black text-[#cfae80] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                  disabled={generating}
                />
                <span className="text-xs text-slate-200 font-medium">Voiceover Storyboard (Naskah / Skrip Video)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input 
                  type="radio" 
                  name="voMode"
                  value="image"
                  checked={voMode === 'image'} 
                  onChange={() => setVoMode('image')} 
                  className="border-[#2a2725] bg-black text-[#cfae80] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                  disabled={generating}
                />
                <span className="text-xs text-slate-200 font-medium">Voiceover Gambar Storyboard (Teks VO di Panel Gambar)</span>
              </label>
            </div>

            {voMode !== 'off' && (
              <div className="space-y-2.5 pt-2 border-t border-[#2a2725]/50 animate-fadeIn">
                {voMode === 'script' && (
                  <div className="space-y-1">
                    <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest">Batas Maksimal Kata per Narasi (Scene)</label>
                    <select 
                      value={voMaxWords} 
                      onChange={(e) => setVoMaxWords(Number(e.target.value))} 
                      className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs font-semibold"
                      disabled={generating}
                    >
                      {[8, 9, 10, 11, 12, 13, 14, 15].map(w => (
                        <option key={w} value={w}>{w} Kata Maksimal</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="space-y-1">
                  <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest">Pilih Bahasa Narasi</label>
                  <select 
                    value={voLanguage} 
                    onChange={(e) => setVoLanguage(e.target.value)} 
                    className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs font-semibold"
                    disabled={generating}
                  >
                    <option value="Bahasa Indonesia">Bahasa Indonesia</option>
                    <option value="English">English</option>
                    <option value="Bahasa Malaysia">Bahasa Malaysia</option>
                    <option value="Japanese">Japanese (Jepang)</option>
                    <option value="Mandarin">Mandarin (Cina)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest">Gaya Bahasa Narasi</label>
                  <select 
                    value={voTone} 
                    onChange={(e) => setVoTone(e.target.value)} 
                    className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs font-semibold"
                    disabled={generating}
                  >
                    <option value="casual">Casual / Santai (Akrab)</option>
                    <option value="comedy">Comedy / Humor (Lucu)</option>
                    <option value="excited">Excited / Antusias (Selling/Promo)</option>
                    <option value="formal">Formal / Serius (Edukasi)</option>
                    <option value="emotional">Emotional / Menyentuh (Hangat)</option>
                    <option value="storytelling">Storytelling / Bercerita</option>
                    <option value="dramatic">Dramatic / Misterius & Teater (Tegang)</option>
                    <option value="soft_spoken">Soft Spoken / ASMR (Bisikan Lembut & Santai)</option>
                    <option value="luxury_premium">Luxury / Premium & Eksekutif (Mewah & Elegan)</option>
                    <option value="poetic_aesthetic">Poetic / Estetik & Artistik (Puitis)</option>
                    <option value="news_anchor">News Anchor / Breaking News (Reporter Lugas)</option>
                    <option value="motivator_inspirational">Motivator / Inspiratif (Semangat Positif)</option>
                    <option value="review_honest">Honest Reviewer / Ulasan Jujur (Tanpa Basa-Basi)</option>
                    <option value="cinematic_trailer">Cinematic Trailer / Movie Epik (Bintang Film)</option>
                    <option value="sarcastic_witty">Sarcastic / Witty & Sindiran Halus (Cerdas)</option>
                    <option value="kids_playful">Kids & Playful / Ceria & Dunia Anak</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Text On Screen — AI burns a stylized caption into each storyboard panel */}
          <div className="bg-[#131211]/30 border border-[#2a2725] rounded-xl p-3 space-y-1.5">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={textOnScreen}
                onChange={(e) => setTextOnScreen(e.target.checked)}
                className="rounded border-[#2a2725] bg-black text-[#cfae80] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                disabled={generating}
              />
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-300">Text On Screen (caption di gambar)</span>
            </label>
            {textOnScreen && (
              <p className="text-[9px] text-slate-500 leading-relaxed animate-fadeIn">
                AI menambahkan caption bergaya (bold, warna &amp; font bervariasi) di tiap panel, menyesuaikan gaya layout — cocok untuk iklan/edukasi ala TikTok. Berlaku untuk Freebeat &amp; Magica.
              </p>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-950/30 border border-red-500/40 rounded-xl px-3 py-2.5 text-red-300 text-[10px]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="break-words leading-relaxed"><b className="uppercase tracking-wider">Gagal:</b> {error}</span>
            </div>
          )}

          {userProvider === 'magica' && imgEstimate && (
            <div className="text-center text-[9px] text-slate-400 font-semibold -mb-1">
              Estimasi biaya Magica: <span className="text-[#a855f7] font-bold">≈ {imgEstimate.credits.toFixed(3)} kredit / gambar</span> × {pagesForDuration(videoEngine, duration)} halaman = <span className="text-[#a855f7] font-bold">≈ {(imgEstimate.credits * pagesForDuration(videoEngine, duration)).toFixed(3)} kredit total</span>
            </div>
          )}

          <button type="submit" disabled={generating || (userProvider !== 'magica' && apiKeys.length === 0) || prompt.length > effectiveMax} className="w-full bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-2.5 px-4 rounded-xl transition-all shadow-lg hover:shadow-[#cfae80]/10 disabled:opacity-50 flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-wider cursor-pointer">
            {generating ? <><Loader className="animate-spin w-3.5 h-3.5" /> Memproses...</> : <><Sparkles className="w-3.5 h-3.5" /> Generate Storyboard AI</>}
          </button>
        </form>

        <div className="lg:col-span-7 bg-[#1a1918]/60 border border-[#2a2725] rounded-2xl p-4 min-h-[400px] md:min-h-[500px] flex flex-col justify-between relative overflow-hidden backdrop-blur-md">
          <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/25 to-transparent"></div>
          <div className="flex justify-between items-center mb-4 border-b border-[#2a2725] pb-2">
            <h3 className="text-[10px] font-bold text-white uppercase tracking-widest flex items-center gap-2"><ImageIcon className="w-4 h-4 text-[#cfae80]" /> Hasil Visualisasi</h3>
          </div>

          {generating ? (
            <div className="flex-grow flex flex-col items-center justify-center py-16 space-y-6">
              <div className="relative flex items-center justify-center"><Loader className="animate-spin text-[#cfae80] w-12 h-12" /><Zap className="absolute text-[#cfae80] w-4 h-4 fill-[#cfae80]/10 animate-pulse" /></div>
              <div className="text-center max-w-sm">
                <p className="text-white font-editorial italic text-lg">Membuat Storyboard AI...</p>
                <p className="text-slate-450 text-xs mt-1.5 leading-relaxed">Sistem sedang merender visual menggunakan GPU server. Proses ini memakan waktu beberapa menit.</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (await confirm({ title: 'Buat storyboard baru?', message: 'Generasi yang sedang berjalan akan tetap diproses di latar belakang dan bisa dilihat di Dashboard.', confirmText: 'Buat Baru' })) {
                    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
                    localStorage.removeItem('activeTaskId');
                    setGenerating(false);
                    setCurrentTaskId(null);
                    setTaskLogs('');
                  }
                }}
                className="bg-[#1a1918] hover:bg-[#252422] text-[#cfae80] border border-[#cfae80]/30 font-bold py-2 px-5 rounded-xl text-[10px] uppercase tracking-widest transition-all mt-4"
              >
                ⚙️ Buat Storyboard Baru
              </button>
            </div>
          ) : result ? (
            <div className="flex-grow flex flex-col justify-between space-y-6 animate-fadeIn w-full">
              {(() => {
                const getResultImages = () => { if (!result || !result.image_path) return []; try { if (result.image_path.startsWith('[')) return JSON.parse(result.image_path); } catch(e) {} return [result.image_path]; };
                const images = getResultImages();
                const activeImg = images[0] || '';
                return (
                  <div className="flex-grow flex flex-col items-center justify-center space-y-5 w-full">
                    {images.length > 1 ? (
                      <div className="flex overflow-x-auto snap-x snap-mandatory gap-3 w-full pb-2 scrollbar-thin">
                        {images.map((img, idx) => (
                          <div key={idx} className="snap-center shrink-0 w-[82%] sm:w-[47%] flex flex-col space-y-1.5 border border-[#2a2725] rounded-xl overflow-hidden bg-black/80 p-2 group relative">
                            <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-black/40 flex items-center justify-center">
                              <img src={getFullImageUrl(img)} alt={`Halaman ${idx+1}`} className="max-w-full max-h-full object-contain" />
                              <div className="absolute top-1.5 left-1.5 bg-black/80 text-[#cfae80] font-bold text-[7px] px-1.5 py-0.5 rounded-md border border-[#cfae80]/20">
                                Halaman {idx + 1}
                              </div>
                              {regeneratingPages[idx] && (
                                <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-3 z-10 space-y-2">
                                  <Loader className="animate-spin text-[#cfae80] w-6 h-6" />
                                  <span className="text-[8px] font-bold text-[#cfae80] uppercase tracking-widest animate-pulse">Regenerasi...</span>
                                  <div className="w-full bg-[#131211] border border-[#2a2725] rounded-lg p-1.5 h-24 overflow-y-auto text-[7px] text-slate-400 font-mono scrollbar-thin whitespace-pre-line leading-normal text-left">
                                    {regenLogs[idx] || 'Mengantre...'}
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="flex gap-1.5 w-full justify-between pt-1">
                              <a href={getFullImageUrl(img)} target="_blank" rel="noopener noreferrer" className="flex-1 bg-[#131211] hover:bg-[#1a1918] text-slate-200 font-bold py-2 rounded-xl border border-[#2a2725] text-[9px] uppercase tracking-wider text-center flex items-center justify-center gap-1"><ExternalLink className="w-3 h-3 text-[#cfae80]" /> Full</a>
                              <a href={getDownloadUrl(img)} onClick={(e) => handleDownloadClick(e, getFullImageUrl(img))} download className="flex-1 bg-[#131211] hover:bg-[#1a1918] text-slate-200 font-bold py-2 rounded-xl border border-[#2a2725] text-[9px] uppercase tracking-wider text-center flex items-center justify-center gap-1"><Download className="w-3 h-3" /> Unduh</a>
                              <button
                                type="button"
                                disabled={regeneratingPages[idx]}
                                onClick={() => handleRegeneratePage(result.id, idx)}
                                className="flex-1 bg-[#cfae80]/10 hover:bg-[#cfae80]/20 text-[#cfae80] border border-[#cfae80]/30 font-bold py-2 rounded-xl text-[9px] uppercase tracking-wider text-center flex items-center justify-center gap-1 transition-all disabled:opacity-50"
                              >
                                🔄 Regen
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex-grow flex flex-col items-center justify-center space-y-5 w-full">
                        <div className="relative w-full border border-[#2a2725] rounded-3xl overflow-hidden bg-black/80 flex justify-center items-center max-h-[500px] min-h-[350px] group">
                          {regeneratingPages[0] ? (
                            <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-6 space-y-3 z-10">
                              <Loader className="animate-spin text-[#cfae80] w-8 h-8" />
                              <span className="text-xs font-bold text-[#cfae80] uppercase tracking-widest animate-pulse">Meregenerasi Halaman...</span>
                              <div className="max-w-md w-full bg-[#131211] border border-[#2a2725] rounded-xl p-4 h-36 overflow-y-auto text-[9px] text-slate-400 font-mono scrollbar-thin whitespace-pre-line leading-relaxed text-left">
                                {regenLogs[0] || 'Mengantre...'}
                              </div>
                            </div>
                          ) : (
                            <img src={getFullImageUrl(activeImg)} alt="Result" className="max-w-full max-h-[500px] object-contain" />
                          )}
                        </div>
                        <div className="flex flex-wrap gap-3 justify-end border-t border-[#2a2725] pt-5 w-full">
                          <a href={getFullImageUrl(activeImg)} target="_blank" rel="noopener noreferrer" className="bg-[#131211] hover:bg-[#1a1918] text-slate-200 font-bold py-3.5 px-4 rounded-2xl flex items-center gap-1.5 border border-[#2a2725] text-xs uppercase tracking-wider"><ExternalLink className="w-4 h-4 text-[#cfae80]" /> Resolusi Penuh</a>
                          <a href={getDownloadUrl(activeImg)} onClick={(e) => handleDownloadClick(e, getFullImageUrl(activeImg))} download className="bg-[#131211] hover:bg-[#1a1918] text-slate-200 font-bold py-3.5 px-4 rounded-2xl flex items-center gap-1.5 border border-[#2a2725] text-xs uppercase tracking-wider"><Download className="w-4 h-4" /> Unduh</a>
                          <button
                            type="button"
                            disabled={regeneratingPages[0]}
                            onClick={() => handleRegeneratePage(result.id, 0)}
                            className="bg-[#cfae80]/10 hover:bg-[#cfae80]/20 text-[#cfae80] border border-[#cfae80]/30 font-bold py-3.5 px-5 rounded-2xl flex items-center gap-1.5 transition-all text-xs uppercase tracking-wider disabled:opacity-50"
                          >
                            🔄 Regenerasi Halaman
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
              
              {/* Buka Video Studio Banner */}
              <div className="w-full bg-[#1c1a19] border border-[#cfae80]/20 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 mt-3">
                <div className="text-left">
                  <h4 className="text-xs font-bold text-white tracking-wide">Storyboard & Voiceover Siap!</h4>
                  <p className="text-[10px] text-slate-400 mt-1">Naskah naskah/voiceover Anda telah di-generate secara otomatis. Klik tombol untuk langsung membuka Video Studio.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem('openStoryboardId', String(result.id));
                    if (setTab) setTab('dashboard');
                  }}
                  className="bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-2.5 px-5 rounded-xl text-[9px] uppercase tracking-widest transition-all shadow-md shadow-[#cfae80]/15 cursor-pointer shrink-0"
                >
                  🎬 Buka Video Studio
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-grow flex flex-col items-center justify-center text-slate-500 py-16"><ImageIcon className="w-8 h-8 mb-4 text-[#cfae80]/60" /><p className="text-[10px] font-bold uppercase tracking-wider text-slate-450">Isi parameter lalu jalankan generator.</p></div>
          )}
        </div>
      </div>

      {/* Floating log bubble — only while generating or when there are logs. Lifted
          above the mobile bottom-nav (lg: desktop has a sidebar, no bottom nav). */}
      {showLogModal && (generating || taskLogs) && (
        <div className="fixed bottom-24 lg:bottom-6 right-4 lg:right-8 z-50 bg-[#1a1918]/95 border border-[#2a2725] w-[calc(100vw-2rem)] sm:w-96 h-72 sm:h-80 max-h-[52vh] rounded-3xl p-4 shadow-2xl flex flex-col backdrop-blur-md">
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
          <div ref={logContainerRef} className="flex-grow bg-black/60 border border-[#2a2725] rounded-2xl p-4 overflow-y-auto font-mono text-[10px] text-emerald-400 leading-relaxed scrollbar-thin">
            {taskLogs ? (
              taskLogs.split('\n').filter(l => l.trim()).map((line, idx) => (
                <div key={idx} className="mb-0.5 opacity-90">{line}</div>
              ))
            ) : (
              <div className="text-slate-600">Menunggu proses...</div>
            )}
          </div>
        </div>
      )}

      {/* Re-open button when bubble is closed (only when there's something to show) */}
      {!showLogModal && (generating || taskLogs) && (
        <button
          type="button"
          onClick={() => setShowLogModal(true)}
          className="fixed bottom-24 lg:bottom-6 right-4 lg:right-8 z-50 bg-[#1a1918]/95 border border-[#cfae80]/40 text-[#cfae80] text-[9px] font-bold tracking-widest uppercase py-3 px-4 rounded-2xl flex items-center gap-2 shadow-2xl backdrop-blur-md hover:bg-[#cfae80] hover:text-black transition-all"
        >
          <Terminal className="w-3.5 h-3.5" />
          Live Logs
          {generating && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
        </button>
      )}



    </div>
  );
}

