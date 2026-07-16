import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import api from '../utils/api';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { CapacitorHttp } from '@capacitor/core';
import { Plus, Trash2, ExternalLink, Calendar, Loader, FolderOpen, X, ChevronRight, ChevronLeft, Download, Eye, AlertTriangle, Image, FileText, Film, Play, Zap, RefreshCw } from 'lucide-react';

export default function Dashboard({ setTab }) {
  const [storyboards, setStoryboards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedStoryboard, setSelectedStoryboard] = useState(null);
  const [modalCarouselIdx, setModalCarouselIdx] = useState(0);
  const [activeSceneIdx, setActiveSceneIdx] = useState(0);
  const [activeMobileTab, setActiveMobileTab] = useState('image'); // 'image' | 'prompt' | 'video'

  const fetchStoryboards = async () => {
    try {
      const res = await api.get('/storyboards');
      setStoryboards(res.data);
      
      // Auto open newly generated storyboard
      const autoOpenId = localStorage.getItem('openStoryboardId');
      if (autoOpenId) {
        const match = res.data.find(sb => sb.id === Number(autoOpenId));
        if (match) {
          setSelectedStoryboard(match);
          setModalCarouselIdx(0);
          localStorage.removeItem('openStoryboardId');
        }
      }
    } catch (err) {
      setError('Gagal memuat riwayat storyboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStoryboards();
  }, []);

  useEffect(() => {
    const hasProcessing = storyboards.some(sb => sb.status === 'processing');
    let interval;
    if (hasProcessing) {
      interval = setInterval(() => {
        api.get('/storyboards')
          .then(res => {
            setStoryboards(res.data);
          })
          .catch(err => console.error("Error refreshing storyboards in background:", err));
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [storyboards]);

  const handleDelete = async (id) => {
    if (!window.confirm('Apakah Anda yakin ingin menghapus storyboard ini?')) return;
    try {
      await api.delete(`/storyboards/${id}`);
      setStoryboards(storyboards.filter((sb) => sb.id !== id));
      if (selectedStoryboard && selectedStoryboard.id === id) {
        setSelectedStoryboard(null);
      }
    } catch (err) {
      alert('Gagal menghapus storyboard.');
    }
  };

  const [regeneratingCopyId, setRegeneratingCopyId] = useState(null);

  const handleRegenerateMarketingCopy = async (videoId) => {
    setRegeneratingCopyId(videoId);
    try {
      const res = await api.post(`/videos/${videoId}/marketing-copy`);
      setVideos(prev => prev.map(v => v.id === videoId ? { 
        ...v, 
        marketing_title: res.data.marketing_title, 
        marketing_description: res.data.marketing_description 
      } : v));
    } catch (err) {
      console.error("Error regenerating marketing copy:", err);
      alert('Gagal membuat ulang deskripsi promosi.');
    } finally {
      setRegeneratingCopyId(null);
    }
  };

  const [generatingType, setGeneratingType] = useState(null); // 'image-to-video', 'text-to-video', or null
  const [videoPromptError, setVideoPromptError] = useState('');
  const [enableVoI2v, setEnableVoI2v] = useState(false);
  const [voLanguageI2v, setVoLanguageI2v] = useState('Bahasa Indonesia');
  const [voToneI2v, setVoToneI2v] = useState('casual');
  const [videoDurationI2v, setVideoDurationI2v] = useState('auto');
  const [enableVoT2v, setEnableVoT2v] = useState(false);
  const [voLanguageT2v, setVoLanguageT2v] = useState('Bahasa Indonesia');
  const [voToneT2v, setVoToneT2v] = useState('casual');
  const [videoDurationT2v, setVideoDurationT2v] = useState('auto');

  // Video Studio states
  const [videos, setVideos] = useState([]);
  const [fetchingVideos, setFetchingVideos] = useState(false);
  const [videoTaskId, setVideoTaskId] = useState(null);
  const [activeVideoTask, setActiveVideoTask] = useState(null);
  const [activeVideoIdx, setActiveVideoIdx] = useState(0);
  const [showGenForm, setShowGenForm] = useState(false);

  const [videoModel, setVideoModel] = useState('pixverse-c1');
  const [videoGenType, setVideoGenType] = useState('image');
  const [videoStudioPrompt, setVideoStudioPrompt] = useState('');
  const [videoDuration, setVideoDuration] = useState('5');
  const [videoResolution, setVideoResolution] = useState('720p');
  const [videoAspectRatio, setVideoAspectRatio] = useState('auto');
  const [videoGenerateAudio, setVideoGenerateAudio] = useState(false);
  const [apiKeys, setApiKeys] = useState([]);
  const [selectedApiKeyId, setSelectedApiKeyId] = useState('auto');
  
  const [regeneratingPages, setRegeneratingPages] = useState({});
  const [regenLogs, setRegenLogs] = useState({});
  const [downloadingId, setDownloadingId] = useState(null);

  const handleRegeneratePage = async (storyboardId, pageIdx) => {
    const confirmRegen = window.confirm(`Apakah Anda yakin ingin me-regenerasi Halaman ${pageIdx + 1}? (Proses ini membutuhkan beberapa kredit Freebeat).`);
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
            
            setSelectedStoryboard(prev => ({
              ...prev,
              image_path: task.result.image_path
            }));
            
            setStoryboards(prev => prev.map(sb => {
              if (sb.id === storyboardId) {
                return { ...sb, image_path: task.result.image_path };
              }
              return sb;
            }));
            alert(`Halaman ${pageIdx + 1} sukses diregenerasi!`);
          } else if (task.status === 'failed') {
            clearInterval(interval);
            setRegeneratingPages(prev => ({ ...prev, [pageIdx]: false }));
            alert(`Gagal meregenerasi Halaman ${pageIdx + 1}: ${task.error || 'Unknown error'}`);
          }
        } catch (e) {}
      }, 4000);
    } catch (err) {
      console.error(err);
      setRegeneratingPages(prev => ({ ...prev, [pageIdx]: false }));
      alert(err.response?.data?.message || 'Gagal meregenerasi halaman.');
    }
  };

  const VIDEO_MODELS = [
    { value: 'pixverse-c1', label: 'Pixverse C1 (1-15s, Audio)', durations: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], resolutions: ['360p', '540p', '720p', '1080p'], supportsAudio: true },
    { value: 'pixverse-v6', label: 'Pixverse V6 (5-15s, Audio)', durations: [5,6,7,8,9,10,11,12,13,14,15], resolutions: ['720p', '1080p'], supportsAudio: true },
    { value: 'veo3-1', label: 'Veo 3.1 (4-8s, Audio)', durations: [4,6,8], resolutions: ['720p', '1080p'], supportsAudio: true },
    { value: 'veo3-1-fast', label: 'Veo 3.1 Fast (4-8s, Audio)', durations: [4,6,8], resolutions: ['720p', '1080p'], supportsAudio: true },
    { value: 'sora-2-pro', label: 'Sora 2 Pro (4|8|12s, 16:9|9:16)', durations: [4, 8, 12], resolutions: ['720p', '1080p'], supportsAudio: false },
    { value: 'kling-v3-4k', label: 'Kling V3 4K (3-15s, 4K)', durations: [3,4,5,6,7,8,9,10,11,12,13,14,15], resolutions: ['4k'], supportsAudio: false },
    { value: 'seedance-2.0', label: 'SeedDance 2.0 (4-15s)', durations: [4,5,6,7,8,9,10,11,12,13,14,15], resolutions: ['720p'], supportsAudio: false },
    { value: 'seedance-2.0-fast', label: 'SeedDance 2.0 Fast (4-15s)', durations: [4,5,6,7,8,9,10,11,12,13,14,15], resolutions: ['720p'], supportsAudio: false },
    { value: 'wan-v2.7-video', label: 'Wan V2.7 Video (2-15s)', durations: [2,3,4,5,6,7,8,9,10,11,12,13,14,15], resolutions: ['720p', '1080p'], supportsAudio: false },
    { value: 'happy-horse', label: 'HappyHorse (3-15s)', durations: [3,4,5,6,7,8,9,10,11,12,13,14,15], resolutions: ['720p', '1080p'], supportsAudio: false }
  ];

  useEffect(() => {
    if (selectedStoryboard) {
      setFetchingVideos(true);
      api.get(`/videos/storyboard/${selectedStoryboard.id}`)
        .then(res => {
          setVideos(res.data);
        })
        .catch(err => console.error("Error fetching videos:", err))
        .finally(() => setFetchingVideos(false));

      api.get('/storyboards/keys')
        .then(res => {
          setApiKeys(res.data);
          const exists = res.data.find(k => k.id === selectedStoryboard.api_key_id);
          if (exists) {
            setSelectedApiKeyId(selectedStoryboard.api_key_id);
          } else if (res.data.length > 0) {
            setSelectedApiKeyId(res.data[0].id);
          }
        })
        .catch(err => console.error("Error fetching keys:", err));

      // Auto check generate audio if storyboard was generated with voiceover enabled
      if (selectedStoryboard.generation_params) {
        try {
          const params = JSON.parse(selectedStoryboard.generation_params);
          setVideoGenerateAudio(!!params.enableVo);
        } catch (e) {
          setVideoGenerateAudio(false);
        }
      } else {
        setVideoGenerateAudio(false);
      }
    } else {
      setVideos([]);
      setApiKeys([]);
      setSelectedApiKeyId('');
      setVideoGenerateAudio(false);
    }
  }, [selectedStoryboard]);

  useEffect(() => {
    if (selectedStoryboard) {
      const { imageToVideoPrompt: i2v, textToVideoPrompt: t2v, narration } = parseVideoPrompts(selectedStoryboard.video_prompts, modalCarouselIdx);
      let basePrompt = videoGenType === 'image' ? (i2v || '') : (t2v || '');
      
      if (videoGenerateAudio && narration) {
        let lang = 'Bahasa Indonesia';
        if (selectedStoryboard.generation_params) {
          try {
            const params = JSON.parse(selectedStoryboard.generation_params);
            if (params.voLanguage) lang = params.voLanguage;
          } catch (e) {}
        }
        basePrompt += `\n\nVoiceover (${lang}):\n${narration}`;
      }
      setVideoStudioPrompt(basePrompt);
    }
  }, [modalCarouselIdx, selectedStoryboard, videoGenType, videoGenerateAudio]);

  useEffect(() => {
    if (selectedStoryboard) {
      const m = VIDEO_MODELS.find(x => x.value === videoModel);
      if (m) {
        let targetSec = 15;
        try {
          const params = JSON.parse(selectedStoryboard.generation_params);
          const engine = params.videoEngine || 'seedance';
          if (engine === 'omni') targetSec = 10;
          else if (engine.startsWith('veo')) targetSec = 8;
        } catch (e) {}

        if (m.durations.includes(targetSec)) {
          setVideoDuration(String(targetSec));
        } else {
          setVideoDuration(String(m.durations[m.durations.length - 1]));
        }
      }
    }
  }, [selectedStoryboard, videoModel]);

  useEffect(() => {
    let interval;
    if (videoTaskId) {
      interval = setInterval(async () => {
        try {
          const res = await api.get(`/storyboards/tasks/${videoTaskId}`);
          setActiveVideoTask(res.data);
          if (res.data.status === 'success' || res.data.status === 'failed') {
            setVideoTaskId(null);
            if (selectedStoryboard) {
              const vRes = await api.get(`/videos/storyboard/${selectedStoryboard.id}`);
              setVideos(vRes.data);
            }
          }
        } catch (e) {
          console.error("Error polling video task status:", e);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [videoTaskId, selectedStoryboard]);

  useEffect(() => {
    setActiveVideoIdx(0);
    setShowGenForm(false);
    if (selectedStoryboard) {
      const sceneVideos = videos
        .filter(v => v.scene_idx === modalCarouselIdx)
        .sort((a, b) => b.id - a.id);
      const latestVideo = sceneVideos[0];
      if (latestVideo && latestVideo.status === 'processing') {
        if (videoTaskId !== latestVideo.task_id) {
          setVideoTaskId(latestVideo.task_id);
          setActiveVideoTask({ status: 'processing', logs: 'Menyambungkan kembali pemantauan...\n' });
        }
      } else {
        // Clear polling state for this scene since it's not processing!
        setVideoTaskId(null);
        setActiveVideoTask(null);
      }
    }
  }, [modalCarouselIdx, selectedStoryboard, videos]);

  const handleGenerateVideo = async () => {
    if (!selectedStoryboard) return;
    try {
      const res = await api.post('/videos/generate', {
        storyboardId: selectedStoryboard.id,
        sceneIdx: modalCarouselIdx,
        prompt: videoStudioPrompt || '',
        model: videoModel,
        generationType: videoGenType,
        aspectRatio: videoAspectRatio,
        duration: videoDuration === 'auto' ? undefined : Number(videoDuration),
        resolution: videoResolution,
        generateAudio: videoGenerateAudio,
        apiKeyId: selectedApiKeyId || 'auto'
      });
      
      // Refresh the video list to include the new 'processing' record
      const vRes = await api.get(`/videos/storyboard/${selectedStoryboard.id}`);
      setVideos(vRes.data);
      
      setVideoTaskId(res.data.taskId);
      setActiveVideoTask({ status: 'processing', logs: 'Menghubungi antrean Freebeat CLI...\n' });
      setShowGenForm(false);
    } catch (err) {
      console.error("Error creating video:", err);
      alert(err.response?.data?.message || 'Gagal memulai pembuatan video.');
    }
  };

  const handleGenerateAllVideos = async () => {
    if (!selectedStoryboard) return;
    const confirmAll = window.confirm("Apakah Anda yakin ingin men-generate video untuk SEMUA scene secara parallel? (Tiap scene akan berjalan dalam proses terpisah dengan API Key kosong otomatis).");
    if (!confirmAll) return;

    try {
      const res = await api.post('/videos/generate-all', {
        storyboardId: selectedStoryboard.id,
        model: videoModel,
        generationType: videoGenType,
        aspectRatio: videoAspectRatio,
        duration: videoDuration === 'auto' ? undefined : Number(videoDuration),
        resolution: videoResolution,
        generateAudio: videoGenerateAudio,
        apiKeyId: selectedApiKeyId || 'auto'
      });
      
      // Refresh the video list to include processing statuses
      const vRes = await api.get(`/videos/storyboard/${selectedStoryboard.id}`);
      setVideos(vRes.data);
      
      alert(res.data.message || 'Batch video generation sukses dimulai!');
      setShowGenForm(false);
    } catch (err) {
      console.error("Error creating all videos:", err);
      alert(err.response?.data?.message || 'Gagal memulai batch video generation.');
    }
  };

  const handleDownloadVideo = async (url, filename) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename || 'video.mp4';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      window.open(url, '_blank');
    }
  };

  const parseVideoPrompts = (rawText, sceneIdx = 0) => {
    if (!rawText) return { imageToVideoPrompt: '', textToVideoPrompt: '', narration: '' };
    try {
      const parsed = JSON.parse(rawText);
      if (parsed && typeof parsed === 'object') {
        // If it is the new scene-specific structure containing array of scenes
        if (parsed.scenes && Array.isArray(parsed.scenes)) {
          const match = parsed.scenes.find(s => s.scene_idx === sceneIdx);
          if (match) {
            return {
              imageToVideoPrompt: match.imageToVideoPrompt || '',
              textToVideoPrompt: match.textToVideoPrompt || '',
              narration: match.narration || ''
            };
          }
        }

        // Fallback for old object structure
        if ('imageToVideoPrompt' in parsed || 'textToVideoPrompt' in parsed) {
          return {
            imageToVideoPrompt: parsed.imageToVideoPrompt || '',
            textToVideoPrompt: parsed.textToVideoPrompt || '',
            narration: parsed.narration || ''
          };
        }
        if ('visualPrompt' in parsed) {
          return {
            imageToVideoPrompt: '',
            textToVideoPrompt: parsed.visualPrompt || '',
            narration: parsed.narration || ''
          };
        }
      }
    } catch (e) {}
    // Fallback for legacy plain text format
    return {
      imageToVideoPrompt: '',
      textToVideoPrompt: rawText,
      narration: ''
    };
  };

  const handleGenerateVideoPrompts = async (promptType, forceRegenerate = false) => {
    if (!selectedStoryboard) return;
    setGeneratingType(promptType);
    setVideoPromptError('');
    try {
      const useVo = promptType === 'text-to-video' ? enableVoT2v : enableVoI2v;
      const lang = promptType === 'text-to-video' ? voLanguageT2v : voLanguageI2v;
      const tone = promptType === 'text-to-video' ? voToneT2v : voToneI2v;
      const durationVal = promptType === 'text-to-video' ? videoDurationT2v : videoDurationI2v;

      const res = await api.post('/ai/video-prompts', { 
        storyboardId: selectedStoryboard.id,
        promptType,
        regenerate: forceRegenerate,
        enableVo: useVo,
        voLanguage: useVo ? lang : undefined,
        voTone: useVo ? tone : undefined,
        videoDuration: durationVal
      });
      const videoPromptsStr = res.data.videoPrompts;
      
      // Update selected storyboard in state
      const updatedSb = { ...selectedStoryboard, video_prompts: videoPromptsStr };
      setSelectedStoryboard(updatedSb);
      
      // Update storyboards list in state
      setStoryboards(prev => prev.map(sb => sb.id === selectedStoryboard.id ? updatedSb : sb));
    } catch (err) {
      console.error("Error generating video prompt:", err);
      setVideoPromptError(err.response?.data?.message || 'Gagal membuat prompt video.');
    } finally {
      setGeneratingType(null);
    }
  };

  const getFullImageUrl = (pathString) => {
    if (!pathString) return '';
    let parsedPath = pathString;
    try {
      if (pathString.startsWith('[')) {
        const arr = JSON.parse(pathString);
        parsedPath = arr[0] || '';
      }
    } catch (e) {}
    if (parsedPath.startsWith('http')) return parsedPath;

    const base = import.meta.env.VITE_API_URL || '/api';
    let cleanPath = parsedPath;
    if (parsedPath.startsWith('/uploads/')) {
      cleanPath = parsedPath.slice(1);
    } else if (parsedPath.startsWith('uploads/')) {
      cleanPath = parsedPath;
    } else {
      cleanPath = parsedPath.startsWith('/') ? parsedPath.slice(1) : parsedPath;
    }

    if (base.startsWith('http')) {
      try {
        const origin = new URL(base).origin;
        return `${origin}/${cleanPath}`;
      } catch (e) {
        return `/${cleanPath}`;
      }
    }
    return `/${cleanPath}`;
  };

  const getSpecificImageUrl = (path) => {
    return getFullImageUrl(path);
  };

  const getDownloadUrl = (sourceUrl) => {
    if (!sourceUrl) return '';
    const base = import.meta.env.VITE_API_URL || '/api';
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    
    let cleanUrl = sourceUrl;
    if (!sourceUrl.startsWith('http') && base.startsWith('http')) {
      const origin = new URL(base).origin;
      const slashPath = sourceUrl.startsWith('/') ? sourceUrl : `/${sourceUrl}`;
      cleanUrl = `${origin}${slashPath}`;
    }
    
    return `${cleanBase}/storyboards/download?url=${encodeURIComponent(cleanUrl)}`;
  };

  const downloadFileNative = async (url, filename, elementId) => {
    if (elementId) setDownloadingId(elementId);
    const isCapacitor = window.Capacitor !== undefined;
    const platform = isCapacitor ? window.Capacitor.getPlatform() : 'web';
    const downloadUrl = getDownloadUrl(url);
    
    if (!isCapacitor || platform === 'web') {
      try {
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (err) {
        console.error("Browser download error:", err);
      } finally {
        if (elementId) setDownloadingId(null);
      }
      return;
    }

    // iOS Platform: Share the public HTTP URL directly.
    // iOS native UIActivityViewController will fetch and offer "Save Image" / "Save Video"
    if (platform === 'ios') {
      try {
        await Share.share({
          url: downloadUrl
        });
      } catch (err) {
        console.error("iOS share error:", err);
        alert(`Gagal menyimpan file secara native. Membuka di browser...`);
        window.open(downloadUrl, '_blank');
      } finally {
        if (elementId) setDownloadingId(null);
      }
      return;
    }

    // Android Platform: Download to native cache, write file, and share local URI
    try {
      const response = await CapacitorHttp.get({
        url: downloadUrl,
        responseType: 'base64'
      });

      if (response.status !== 200) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const base64Data = response.data;
      if (!base64Data) {
        throw new Error('No data received from download proxy');
      }

      // Write to app internal cache folder (zero permissions required)
      const writeResult = await Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: Directory.Cache
      });

      const fileUri = writeResult.uri;

      // Share cached file URI on Android
      await Share.share({
        title: filename,
        url: fileUri
      });

    } catch (err) {
      console.error("Android native save/share error:", err);
      alert(`Gagal menyimpan file secara native. Membuka di browser...`);
      window.open(downloadUrl, '_blank');
    } finally {
      if (elementId) setDownloadingId(null);
    }
  };

  const handleDownloadClick = async (e, url, filename, elementId) => {
    const isCapacitor = window.Capacitor !== undefined;
    if (isCapacitor) {
      e.preventDefault();
      await downloadFileNative(url, filename, elementId);
    } else {
      if (elementId) {
        setDownloadingId(elementId);
        setTimeout(() => setDownloadingId(null), 2000);
      }
    }
  };

  const getResultImages = (sb) => {
    if (!sb || !sb.image_path) return [];
    try {
      if (sb.image_path.startsWith('[')) {
        return JSON.parse(sb.image_path);
      }
    } catch (e) {}
    return [sb.image_path];
  };

  const getPageCount = (pathString) => {
    try {
      if (pathString && pathString.startsWith('[')) {
        return JSON.parse(pathString).length;
      }
    } catch (e) {}
    return 1;
  };

  if (loading) {
    return (
      <div className="flex-grow flex flex-col items-center justify-center py-24">
        <Loader className="animate-spin text-[#cfae80] w-8 h-8 mb-4" />
        <span className="text-slate-400 text-[10px] font-bold tracking-widest uppercase">Memuat galeri...</span>
      </div>
    );
  }

  return (
    <div className="p-3 md:p-8 space-y-5 md:space-y-10 animate-fadeIn font-sans relative">
      {/* Header Section */}
      {/* Desktop Header */}
      <div className="hidden md:flex flex-row justify-between items-center gap-6 border-b border-[#2a2725] pb-6">
        <div>
          <h1 className="text-4xl font-editorial italic text-white tracking-tight">Galeri Storyboard</h1>
          <p className="text-slate-400 text-xs mt-1.5 font-medium tracking-wide">
            Kelola dan tinjau arsip visual storyboard video AI Anda.
          </p>
        </div>
        <button
          onClick={() => setTab('generator')}
          className="border border-[#cfae80] hover:bg-[#cfae80] hover:text-black text-[#cfae80] font-bold py-3 px-6 rounded-2xl transition-all duration-300 text-xs tracking-widest uppercase shrink-0"
        >
          <Plus className="w-4 h-4 inline mr-2" />
          Mulai Project
        </button>
      </div>

      {/* Mobile Header */}
      <div className="flex md:hidden flex-row justify-between items-center border-b border-[#2a2725] pb-3 mb-2">
        <h1 className="text-lg font-editorial italic text-white">Galeri Storyboard</h1>
        <button
          onClick={() => setTab('generator')}
          className="border border-[#cfae80] hover:bg-[#cfae80] hover:text-black text-[#cfae80] font-bold py-1.5 px-3 rounded-xl transition-all duration-300 text-[10px] tracking-wider uppercase shrink-0"
        >
          <Plus className="w-3.5 h-3.5 inline mr-1" />
          Mulai Project
        </button>
      </div>

      {error && (
        <div className="bg-red-950/20 border border-red-500/25 text-red-250 px-4 py-3 rounded-2xl text-xs">
          {error}
        </div>
      )}

      {storyboards.length === 0 ? (
        <div className="bg-[#1a1918]/30 border border-[#2a2725] rounded-3xl p-16 text-center flex flex-col items-center max-w-xl mx-auto backdrop-blur-sm relative">
          <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/20 to-transparent"></div>
          <div className="bg-white/[0.01] border border-[#2a2725] p-5 rounded-full text-slate-500 mb-6">
            <FolderOpen className="w-8 h-8 text-[#cfae80]/60" />
          </div>
          <h3 className="text-lg font-editorial italic text-white mb-2">Belum Ada Proyek</h3>
          <p className="text-slate-400 text-xs font-medium tracking-wide leading-relaxed mb-8">
            Visualisasikan ide video Anda dengan AI. Mulai buat storyboard pertama sekarang.
          </p>
          <button
            onClick={() => setTab('generator')}
            className="bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-3.5 px-6 rounded-2xl transition-all text-xs uppercase tracking-widest"
          >
            Buat Storyboard Pertama
          </button>
        </div>
      ) : (
        <div className="space-y-4 md:space-y-6">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#cfae80]">Semua Riwayat Storyboard</h3>
          
          {/* COMPACT CARD GRID */}
          <div className="grid grid-cols-3 min-[480px]:grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3 md:gap-5">
            {storyboards.map((sb) => {
              const isProcessing = sb.status === 'processing';
              const isFailed = sb.status === 'failed';

              return (
                <div
                  key={sb.id}
                  onClick={() => {
                    if (isProcessing) {
                      alert('Storyboard sedang dalam proses pembuatan di latar belakang. Silakan tunggu hingga selesai.');
                      return;
                    }
                    if (isFailed) {
                      alert('Proses pembuatan storyboard ini gagal. Silakan klik tombol "Hapus" pada kartu untuk membersihkannya.');
                      return;
                    }
                    setSelectedStoryboard(sb);
                    setModalCarouselIdx(0);
                    setActiveSceneIdx(0);
                    setVideoPromptError('');
                  }}
                  className={`bg-[#1a1918]/60 border rounded-2xl overflow-hidden hover:border-[#cfae80]/40 transition-all duration-300 group flex flex-col relative ${
                    isProcessing ? 'border-[#cfae80]/20 cursor-wait' : isFailed ? 'border-red-500/20 cursor-default' : 'border-[#2a2725] cursor-pointer'
                  }`}
                >
                  {/* Thumbnail Container (4:3 ratio) */}
                  <div className="aspect-[4/3] bg-black/40 relative overflow-hidden flex items-center justify-center border-b border-[#2a2725]">
                    {isProcessing ? (
                      <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1.5 p-1 text-center">
                        <Loader className="animate-spin text-[#cfae80] w-4.5 h-4.5" />
                        <span className="text-[6.5px] font-bold text-slate-400 uppercase tracking-widest animate-pulse">Membuat...</span>
                      </div>
                    ) : isFailed ? (
                      <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1.5 p-1 text-center">
                        <AlertTriangle className="text-red-400 w-4.5 h-4.5" />
                        <span className="text-[6.5px] font-bold text-red-400 uppercase tracking-widest">Gagal</span>
                      </div>
                    ) : (
                      <>
                        <img
                          src={getFullImageUrl(sb.image_path)}
                          alt={sb.title}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                        />
                        {/* Subtle hover icon overlay */}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                          <div className="p-2 bg-[#cfae80] text-black rounded-full shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-transform duration-350">
                            <Eye className="w-3.5 h-3.5" />
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Card Info (Very Compact) */}
                  <div className="p-2 flex flex-col justify-between flex-grow">
                    <h4 className="font-editorial italic text-white text-[10px] md:text-sm truncate group-hover:text-[#cfae80] transition-colors">{sb.title}</h4>
                    <div className="flex items-center justify-between text-[8px] md:text-[9px] text-slate-500 mt-1 md:mt-2 pt-1 md:pt-2 border-t border-[#2a2725]/60 font-medium">
                      <span className="truncate">
                        {new Date(sb.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                      </span>
                      {isProcessing ? (
                        <span className="text-[#cfae80] font-bold uppercase tracking-wider text-[7px] animate-pulse">Proses</span>
                      ) : isFailed ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(sb.id);
                          }}
                          className="text-red-400 hover:text-red-300 font-bold uppercase tracking-widest text-[7px] flex items-center gap-0.5 transition-all"
                        >
                          <Trash2 className="w-2.5 h-2.5" /> Hapus
                        </button>
                      ) : (
                        <div className="flex items-center gap-1 font-bold text-[#cfae80] shrink-0">
                          <span>
                            {getPageCount(sb.image_path) > 1 
                              ? `${getPageCount(sb.image_path)}p` 
                              : '15s'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* POPUP DETAIL MODAL */}
      {selectedStoryboard && (() => {
        const images = getResultImages(selectedStoryboard);
        const activeImg = images[modalCarouselIdx] || '';
        const { imageToVideoPrompt, textToVideoPrompt, narration } = parseVideoPrompts(selectedStoryboard.video_prompts, modalCarouselIdx);
        return createPortal(
          <div 
            className="fixed inset-0 bg-black/80 md:bg-black/85 md:backdrop-blur-md flex items-start md:items-center justify-center p-0 md:p-4 z-50 select-text animate-fadeIn"
            onClick={() => { setSelectedStoryboard(null); setVideoPromptError(''); setActiveSceneIdx(0); }}
          >
            <div 
              className="relative w-full h-full md:max-w-[1300px] md:h-[88vh] bg-[#131211] md:bg-[#1a1918] md:border md:border-[#2a2725] md:rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row my-auto animate-scaleUp"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Top accent gold line */}
              <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/40 to-transparent"></div>
              
              {/* Close Button (Desktop Only) */}
              <button 
                onClick={() => { setSelectedStoryboard(null); setVideoPromptError(''); setActiveSceneIdx(0); }} 
                className="hidden md:flex absolute top-4 right-4 z-50 text-slate-400 hover:text-white bg-black/70 p-1.5 rounded-full border border-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Mobile Top Bar with Back Button */}
              <div className="flex md:hidden items-center justify-between px-4 pt-[env(safe-area-inset-top,0.75rem)] pb-3 bg-[#1a1918] border-b border-[#2a2725] shrink-0 w-full">
                <button
                  type="button"
                  onClick={() => { setSelectedStoryboard(null); setVideoPromptError(''); setActiveSceneIdx(0); }}
                  className="flex items-center gap-1 text-slate-300 hover:text-white font-bold text-[9px] uppercase tracking-wider py-1.5 px-3 rounded-lg bg-[#2a2725]/45 border border-[#2a2725]/60 transition-all"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Kembali
                </button>
                <span className="text-[10px] font-bold text-slate-400 truncate max-w-[180px] uppercase tracking-wider">
                  Detail Storyboard
                </span>
                <div className="w-14"></div> {/* spacer to center the title */}
              </div>

              {/* Left Side: Large Image Carousel & Action Buttons */}
              <div className={`w-full md:w-2/5 bg-black/80 flex flex-col justify-between relative flex-grow md:flex-grow-0 md:min-h-0 border-b md:border-b-0 md:border-r border-[#2a2725] p-4 md:p-6 pb-24 md:pb-6 ${activeMobileTab === 'image' ? 'flex' : 'hidden md:flex'}`}>
                
                {/* Image display wrapper */}
                <div className="flex-grow flex items-center justify-center relative min-h-[35vh]">
                  {regeneratingPages[modalCarouselIdx] ? (
                    <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-6 space-y-3 z-10 animate-fadeIn">
                      <Loader className="animate-spin text-[#cfae80] w-8 h-8" />
                      <span className="text-xs font-bold text-[#cfae80] uppercase tracking-widest animate-pulse">Meregenerasi Halaman...</span>
                      <div className="max-w-md w-full bg-[#131211] border border-[#2a2725] rounded-xl p-4 h-36 overflow-y-auto text-[9px] text-slate-400 font-mono scrollbar-thin whitespace-pre-line leading-relaxed text-left">
                        {regenLogs[modalCarouselIdx] || 'Mengantre...'}
                      </div>
                    </div>
                  ) : (
                    <img
                      src={getSpecificImageUrl(activeImg)}
                      alt={selectedStoryboard.title}
                      className="max-w-full max-h-[45vh] md:max-h-[60vh] object-contain rounded-2xl border border-[#2a2725]/60 shadow-inner"
                    />
                  )}
                  
                  {/* Carousel Navigation */}
                  {images.length > 1 && (
                    <>
                      <button 
                        type="button" 
                        onClick={() => setModalCarouselIdx(prev => (prev > 0 ? prev - 1 : images.length - 1))} 
                        className="absolute left-0 p-2 bg-black/70 hover:bg-[#cfae80] hover:text-black text-white rounded-full transition-all border border-white/10"
                      >
                        <ChevronRight className="rotate-180 w-4 h-4" />
                      </button>
                      <button 
                        type="button" 
                        onClick={() => setModalCarouselIdx(prev => (prev < images.length - 1 ? prev + 1 : 0))} 
                        className="absolute right-0 p-2 bg-black/70 hover:bg-[#cfae80] hover:text-black text-white rounded-full transition-all border border-white/10"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>

                {/* Page Index indicator & Actions */}
                <div className="space-y-3 mt-4 shrink-0">
                  {images.length > 1 && (
                    <div className="text-center">
                      <span className="bg-[#1a1918] px-3 py-1 rounded-full text-[9px] font-bold tracking-widest uppercase border border-[#2a2725] text-slate-400">
                        Panel {modalCarouselIdx + 1} dari {images.length}
                      </span>
                    </div>
                  )}

                  {/* Actions under image */}
                  <div className="space-y-2 pt-2">
                    <div className="flex gap-2">
                      <a
                        href={getSpecificImageUrl(activeImg)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 bg-[#131211] hover:bg-[#1a1918] text-slate-200 font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 border border-[#2a2725]/65 text-[8.5px] uppercase tracking-wider transition-all"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-[#cfae80]" />
                        Full-Res
                      </a>
                      <a
                        href={getDownloadUrl(activeImg)}
                        onClick={(e) => handleDownloadClick(e, activeImg, `storyboard-${selectedStoryboard.id}-panel-${modalCarouselIdx + 1}.png`, `img-${selectedStoryboard.id}-${modalCarouselIdx}`)}
                        download={`storyboard-${selectedStoryboard.id}-panel-${modalCarouselIdx + 1}.png`}
                        className="flex-1 bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 text-[8.5px] uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50"
                        style={{ pointerEvents: downloadingId ? 'none' : 'auto' }}
                      >
                        {downloadingId === `img-${selectedStoryboard.id}-${modalCarouselIdx}` ? (
                          <>
                            <Loader className="animate-spin w-3.5 h-3.5" />
                            Simpan...
                          </>
                        ) : (
                          <>
                            <Download className="w-3.5 h-3.5" />
                            Simpan
                          </>
                        )}
                      </a>
                    </div>
                    
                    <button
                      disabled={regeneratingPages[modalCarouselIdx]}
                      onClick={() => handleRegeneratePage(selectedStoryboard.id, modalCarouselIdx)}
                      className="w-full bg-[#cfae80]/10 hover:bg-[#cfae80]/20 text-[#cfae80] border border-[#cfae80]/20 font-bold py-2 px-3 rounded-lg text-[8.5px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${regeneratingPages[modalCarouselIdx] ? 'animate-spin' : ''}`} /> Regenerasi Halaman
                    </button>
                    
                    <button
                      onClick={() => handleDelete(selectedStoryboard.id)}
                      className="w-full border border-red-500/20 bg-red-950/5 hover:bg-red-650 hover:text-white text-red-400 font-bold py-2 px-3 rounded-lg text-[8.5px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Hapus Storyboard
                    </button>
                  </div>
                </div>
              </div>

              {/* Middle Column: Editorial Metadata & Prompts */}
              <div className={`w-full md:w-[30%] p-4 md:p-6 flex flex-col justify-between overflow-y-auto flex-grow md:max-h-full border-b md:border-b-0 md:border-r border-[#2a2725] scrollbar-thin ${activeMobileTab === 'prompt' ? 'flex' : 'hidden md:flex'}`}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-[#cfae80]" />
                      {new Date(selectedStoryboard.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                    <div className="flex gap-2">
                      <span className="px-2.5 py-0.5 rounded bg-[#cfae80]/15 text-[#cfae80] text-[8px] font-bold tracking-widest uppercase border border-[#cfae80]/20">
                        {getPageCount(selectedStoryboard.image_path) > 1 
                          ? `${getPageCount(selectedStoryboard.image_path)} Panel (${getPageCount(selectedStoryboard.image_path) * 15}s)` 
                          : '15 Detik'}
                      </span>
                      <span className="px-2.5 py-0.5 rounded bg-slate-800/40 text-slate-300 text-[8px] font-bold tracking-widest uppercase border border-slate-700/50">
                        ⚡ {selectedStoryboard.used_credits || 0} Kredit
                      </span>
                    </div>
                  </div>

                  <h2 className="text-lg md:text-2xl font-editorial italic text-white tracking-tight leading-snug">
                    {selectedStoryboard.title}
                  </h2>

                  {/* Image-to-Video Section */}
                  <div className="space-y-3 mt-4 pt-4 border-t border-[#2a2725]/60">
                    <div className="flex justify-between items-center">
                      <span className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80]">
                        Prompt Image-to-Video (SeedDance/Kling/Omni)
                      </span>
                      {imageToVideoPrompt && (
                        <button
                          onClick={() => handleGenerateVideoPrompts('image-to-video', true)}
                          disabled={generatingType !== null}
                          className="text-[8px] text-slate-400 hover:text-[#cfae80] font-bold uppercase tracking-widest transition-colors disabled:opacity-50"
                        >
                          {generatingType === 'image-to-video' ? 'Memproses...' : 'Tulis Ulang'}
                        </button>
                      )}
                    </div>

                    {imageToVideoPrompt ? (
                      <div className="space-y-2">
                        <div className="bg-[#131211]/50 border border-[#2a2725] rounded-xl p-3.5 text-slate-350 text-[11px] leading-relaxed relative max-h-48 overflow-y-auto scrollbar-thin font-mono whitespace-pre-line">
                          {imageToVideoPrompt}
                        </div>
                        {narration && (
                          <div className="bg-[#1a1817] border border-[#2a2725]/60 rounded-xl p-3.5 mt-2 space-y-1.5 text-left">
                            <span className="text-[8.5px] font-extrabold uppercase tracking-widest text-[#cfae80] flex items-center gap-1.5">
                              🎤 Naskah Voice Over (VO)
                            </span>
                            <div className="text-[10.5px] text-slate-300 font-medium leading-relaxed font-sans whitespace-pre-line max-h-32 overflow-y-auto scrollbar-thin">
                              {narration}
                            </div>
                          </div>
                        )}
                        
                        {/* Options block for rewriting */}
                        <div className="flex flex-col gap-2.5 bg-[#131211]/30 border border-[#2a2725] rounded-xl p-3 mt-1.5">
                          <div className="space-y-1">
                            <span className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80] block">Durasi Video</span>
                            <select 
                              value={videoDurationI2v} 
                              onChange={(e) => setVideoDurationI2v(e.target.value)} 
                              className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2 py-1 text-white text-[9px] focus:outline-none focus:border-[#cfae80] transition-all font-semibold"
                            >
                              <option value="auto">Auto-detect (SeedDance: 15s | Omni: 10s | Kling: 15s | Gemini: 8s)</option>
                              <option value="8">8 Detik (Gemini)</option>
                              <option value="10">10 Detik (Omni)</option>
                              <option value="15">15 Detik (Kling/SeedDance)</option>
                              <option value="20">20 Detik</option>
                              <option value="30">30 Detik</option>
                              <option value="40">40 Detik</option>
                              <option value="45">45 Detik</option>
                              <option value="50">50 Detik</option>
                              <option value="60">60 Detik</option>
                            </select>
                          </div>

                          <label className="flex items-center gap-2 cursor-pointer select-none border-t border-[#2a2725]/40 pt-2">
                            <input 
                              type="checkbox" 
                              checked={enableVoI2v} 
                              onChange={(e) => setEnableVoI2v(e.target.checked)} 
                              className="rounded border-[#2a2725] bg-black text-[#cfae80] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                            />
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-300">Sertakan Voice Over (VO)</span>
                          </label>
                          
                          {enableVoI2v && (
                            <div className="space-y-1 animate-fadeIn">
                              <span className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80] block">Pilih Bahasa Narasi</span>
                              <select 
                                value={voLanguageI2v} 
                                onChange={(e) => setVoLanguageI2v(e.target.value)} 
                                className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2 py-1 text-white text-[9px] focus:outline-none focus:border-[#cfae80] transition-all font-semibold mb-1"
                              >
                                <option value="Bahasa Indonesia">Bahasa Indonesia</option>
                                <option value="English">English</option>
                                <option value="Bahasa Malaysia">Bahasa Malaysia</option>
                                <option value="Japanese">Japanese (Jepang)</option>
                                <option value="Mandarin">Mandarin (Cina)</option>
                              </select>
                              <span className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80] block">Gaya Bahasa Narasi</span>
                              <select 
                                value={voToneI2v} 
                                onChange={(e) => setVoToneI2v(e.target.value)} 
                                className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2 py-1 text-white text-[9px] focus:outline-none focus:border-[#cfae80] transition-all font-semibold"
                              >
                                <option value="casual">Casual / Santai (Akrab)</option>
                                <option value="comedy">Comedy / Humor (Lucu)</option>
                                <option value="excited">Excited / Antusias (Selling/Promo)</option>
                                <option value="formal">Formal / Serius (Edukasi)</option>
                                <option value="emotional">Emotional / Menyentuh (Hangat)</option>
                                <option value="storytelling">Storytelling / Bercerita</option>
                                <option value="dramatic">Dramatic / Misterius (Tegang)</option>
                              </select>
                            </div>
                          )}

                          <button
                            onClick={() => handleGenerateVideoPrompts('image-to-video', true)}
                            disabled={generatingType !== null}
                            className="w-full bg-[#cfae80]/10 hover:bg-[#cfae80]/20 text-[#cfae80] border border-[#cfae80]/20 font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 text-[8.5px] uppercase tracking-wider transition-all disabled:opacity-50 mt-1"
                          >
                            {generatingType === 'image-to-video' ? (
                              <>
                                <Loader className="animate-spin w-3 h-3" />
                                Memproses Tulis Ulang...
                              </>
                            ) : (
                              <>
                                <RefreshCw className="w-3 h-3" /> Tulis Ulang Prompt & Voice Over
                              </>
                            )}
                          </button>
                        </div>

                        <button
                          onClick={() => {
                            try {
                              navigator.clipboard.writeText(imageToVideoPrompt);
                              alert('Prompt Image-to-Video berhasil disalin!');
                            } catch (e) {
                              alert('Gagal menyalin.');
                            }
                          }}
                          className="w-full bg-[#131211] hover:bg-[#1a1918] text-slate-300 font-bold py-2 px-3 rounded-lg border border-[#2a2725] text-[9px] uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all"
                        >
                          Salin Prompt Image-to-Video (I2V)
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {generatingType !== 'image-to-video' && (
                          <div className="flex flex-col gap-2.5 bg-[#131211]/30 border border-[#2a2725] rounded-xl p-3.5">
                            {/* Duration Selection */}
                            <div className="space-y-1.5">
                              <span className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80] block">Durasi Video</span>
                              <select 
                                value={videoDurationI2v} 
                                onChange={(e) => setVideoDurationI2v(e.target.value)} 
                                className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[10px] focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all font-semibold"
                              >
                                <option value="auto">Auto-detect (SeedDance: 15s | Omni: 10s | Kling: 15s | Gemini: 8s)</option>
                                <option value="8">8 Detik (Gemini)</option>
                                <option value="10">10 Detik (Omni)</option>
                                <option value="15">15 Detik (Kling/SeedDance)</option>
                                <option value="20">20 Detik</option>
                                <option value="30">30 Detik</option>
                                <option value="40">40 Detik</option>
                                <option value="45">45 Detik</option>
                                <option value="50">50 Detik</option>
                                <option value="60">60 Detik</option>
                              </select>
                            </div>

                            <label className="flex items-center gap-2 cursor-pointer select-none border-t border-[#2a2725]/40 pt-2.5">
                              <input 
                                type="checkbox" 
                                checked={enableVoI2v} 
                                onChange={(e) => setEnableVoI2v(e.target.checked)} 
                                className="rounded border-[#2a2725] bg-black text-[#cfae80] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                              />
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Sertakan Voice Over (VO)</span>
                            </label>
                            
                            {enableVoI2v && (
                              <div className="space-y-1.5 animate-fadeIn">
                                <span className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80] block">Pilih Bahasa Narasi</span>
                                <select 
                                  value={voLanguageI2v} 
                                  onChange={(e) => setVoLanguageI2v(e.target.value)} 
                                  className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[10px] focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all font-semibold mb-1"
                                >
                                  <option value="Bahasa Indonesia">Bahasa Indonesia</option>
                                  <option value="English">English</option>
                                  <option value="Bahasa Malaysia">Bahasa Malaysia</option>
                                  <option value="Japanese">Japanese (Jepang)</option>
                                  <option value="Mandarin">Mandarin (Cina)</option>
                                </select>
                                <span className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80] block">Gaya Bahasa Narasi</span>
                                <select 
                                  value={voToneI2v} 
                                  onChange={(e) => setVoToneI2v(e.target.value)} 
                                  className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[10px] focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all font-semibold"
                                >
                                  <option value="casual">Casual / Santai (Akrab)</option>
                                  <option value="comedy">Comedy / Humor (Lucu)</option>
                                  <option value="excited">Excited / Antusias (Selling/Promo)</option>
                                  <option value="formal">Formal / Serius (Edukasi)</option>
                                  <option value="emotional">Emotional / Menyentuh (Hangat)</option>
                                  <option value="storytelling">Storytelling / Bercerita</option>
                                  <option value="dramatic">Dramatic / Misterius (Tegang)</option>
                                </select>
                              </div>
                            )}
                          </div>
                        )}
                        <button
                          onClick={() => handleGenerateVideoPrompts('image-to-video', false)}
                          disabled={generatingType !== null}
                          className="w-full bg-[#cfae80]/10 hover:bg-[#cfae80]/20 text-[#cfae80] border border-[#cfae80]/30 font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 text-[9px] uppercase tracking-widest transition-all disabled:opacity-50"
                        >
                          {generatingType === 'image-to-video' ? (
                            <>
                              <Loader className="animate-spin w-3.5 h-3.5" />
                              Membuat Prompt I2V...
                            </>
                          ) : (
                            <>
                              📝 Generate Prompt Image-to-Video
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Text-to-Video Section */}
                  <div className="space-y-3 mt-4 pt-4 border-t border-[#2a2725]/60">
                    <div className="flex justify-between items-center">
                      <span className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80]">
                        Prompt Text-to-Video (AI Video)
                      </span>
                      {textToVideoPrompt && (
                        <button
                          onClick={() => handleGenerateVideoPrompts('text-to-video', true)}
                          disabled={generatingType !== null}
                          className="text-[8px] text-slate-400 hover:text-[#cfae80] font-bold uppercase tracking-widest transition-colors disabled:opacity-50"
                        >
                          {generatingType === 'text-to-video' ? 'Memproses...' : 'Tulis Ulang'}
                        </button>
                      )}
                    </div>

                    {textToVideoPrompt ? (
                      <div className="space-y-2">
                        <div className="bg-[#131211]/50 border border-[#2a2725] rounded-xl p-3.5 text-slate-350 text-[11px] leading-relaxed relative max-h-48 overflow-y-auto scrollbar-thin font-mono whitespace-pre-line">
                          {textToVideoPrompt}
                        </div>
                        {narration && (
                          <div className="bg-[#1a1817] border border-[#2a2725]/60 rounded-xl p-3.5 mt-2 space-y-1.5 text-left">
                            <span className="text-[8.5px] font-extrabold uppercase tracking-widest text-[#cfae80] flex items-center gap-1.5">
                              🎤 Naskah Voice Over (VO)
                            </span>
                            <div className="text-[10.5px] text-slate-300 font-medium leading-relaxed font-sans whitespace-pre-line max-h-32 overflow-y-auto scrollbar-thin">
                              {narration}
                            </div>
                          </div>
                        )}
                        
                        {/* Options block for rewriting */}
                        <div className="flex flex-col gap-2.5 bg-[#131211]/30 border border-[#2a2725] rounded-xl p-3 mt-1.5">
                          <div className="space-y-1">
                            <span className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80] block">Durasi Video</span>
                            <select 
                              value={videoDurationT2v} 
                              onChange={(e) => setVideoDurationT2v(e.target.value)} 
                              className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2 py-1 text-white text-[9px] focus:outline-none focus:border-[#cfae80] transition-all font-semibold"
                            >
                              <option value="auto">Auto-detect (15 Detik)</option>
                              <option value="8">8 Detik (Gemini)</option>
                              <option value="10">10 Detik (Omni)</option>
                              <option value="15">15 Detik (Kling/SeedDance)</option>
                              <option value="20">20 Detik</option>
                              <option value="30">30 Detik</option>
                              <option value="40">40 Detik</option>
                              <option value="45">45 Detik</option>
                              <option value="50">50 Detik</option>
                              <option value="60">60 Detik</option>
                            </select>
                          </div>

                          <label className="flex items-center gap-2 cursor-pointer select-none border-t border-[#2a2725]/40 pt-2">
                            <input 
                              type="checkbox" 
                              checked={enableVoT2v} 
                              onChange={(e) => setEnableVoT2v(e.target.checked)} 
                              className="rounded border-[#2a2725] bg-black text-[#cfae80] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                            />
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-300">Sertakan Voice Over (VO)</span>
                          </label>
                          
                          {enableVoT2v && (
                            <div className="space-y-1 animate-fadeIn">
                              <span className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80] block">Pilih Bahasa Narasi</span>
                              <select 
                                value={voLanguageT2v} 
                                onChange={(e) => setVoLanguageT2v(e.target.value)} 
                                className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2 py-1 text-white text-[9px] focus:outline-none focus:border-[#cfae80] transition-all font-semibold mb-1"
                              >
                                <option value="Bahasa Indonesia">Bahasa Indonesia</option>
                                <option value="English">English</option>
                                <option value="Bahasa Malaysia">Bahasa Malaysia</option>
                                <option value="Japanese">Japanese (Jepang)</option>
                                <option value="Mandarin">Mandarin (Cina)</option>
                              </select>
                              <span className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80] block">Gaya Bahasa Narasi</span>
                              <select 
                                value={voToneT2v} 
                                onChange={(e) => setVoToneT2v(e.target.value)} 
                                className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2 py-1 text-white text-[9px] focus:outline-none focus:border-[#cfae80] transition-all font-semibold"
                              >
                                <option value="casual">Casual / Santai (Akrab)</option>
                                <option value="comedy">Comedy / Humor (Lucu)</option>
                                <option value="excited">Excited / Antusias (Selling/Promo)</option>
                                <option value="formal">Formal / Serius (Edukasi)</option>
                                <option value="emotional">Emotional / Menyentuh (Hangat)</option>
                                <option value="storytelling">Storytelling / Bercerita</option>
                                <option value="dramatic">Dramatic / Misterius (Tegang)</option>
                              </select>
                            </div>
                          )}
                          <button
                            onClick={() => handleGenerateVideoPrompts('text-to-video', true)}
                            disabled={generatingType !== null}
                            className="w-full bg-[#cfae80]/15 hover:bg-[#cfae80]/25 text-[#cfae80] border border-[#cfae80]/30 font-bold py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 text-[9px] uppercase tracking-widest transition-all disabled:opacity-50 mt-1"
                          >
                            {generatingType === 'text-to-video' ? (
                              <>
                                <Loader className="animate-spin w-3 h-3" />
                                Memproses Tulis Ulang...
                              </>
                            ) : (
                              '⚙️ Tulis Ulang Prompt & Voice Over'
                            )}
                          </button>
                        </div>

                        <button
                          onClick={() => {
                            try {
                              navigator.clipboard.writeText(textToVideoPrompt);
                              alert('Prompt Text-to-Video berhasil disalin!');
                            } catch (e) {
                              alert('Gagal menyalin.');
                            }
                          }}
                          className="w-full bg-[#131211] hover:bg-[#1a1918] text-slate-300 font-bold py-2 px-3 rounded-lg border border-[#2a2725] text-[9px] uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all"
                        >
                          Salin Prompt Text-to-Video (T2V)
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {generatingType !== 'text-to-video' && (
                          <div className="flex flex-col gap-2.5 bg-[#131211]/30 border border-[#2a2725] rounded-xl p-3.5">
                            {/* Duration Selection */}
                            <div className="space-y-1.5">
                              <span className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80] block">Durasi Video</span>
                              <select 
                                value={videoDurationT2v} 
                                onChange={(e) => setVideoDurationT2v(e.target.value)} 
                                className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[10px] focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all font-semibold"
                              >
                                <option value="auto">Auto-detect (15 Detik)</option>
                                <option value="8">8 Detik (Gemini)</option>
                                <option value="10">10 Detik (Omni)</option>
                                <option value="15">15 Detik (Kling/SeedDance)</option>
                                <option value="20">20 Detik</option>
                                <option value="30">30 Detik</option>
                                <option value="40">40 Detik</option>
                                <option value="45">45 Detik</option>
                                <option value="50">50 Detik</option>
                                <option value="60">60 Detik</option>
                              </select>
                            </div>

                            <label className="flex items-center gap-2 cursor-pointer select-none border-t border-[#2a2725]/40 pt-2.5">
                              <input 
                                type="checkbox" 
                                checked={enableVoT2v} 
                                onChange={(e) => setEnableVoT2v(e.target.checked)} 
                                className="rounded border-[#2a2725] bg-black text-[#cfae80] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                              />
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Sertakan Voice Over (VO)</span>
                            </label>
                            
                            {enableVoT2v && (
                              <div className="space-y-1.5 animate-fadeIn">
                                <span className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80] block">Pilih Bahasa Narasi</span>
                                <select 
                                  value={voLanguageT2v} 
                                  onChange={(e) => setVoLanguageT2v(e.target.value)} 
                                  className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[10px] focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all font-semibold mb-1"
                                >
                                  <option value="Bahasa Indonesia">Bahasa Indonesia</option>
                                  <option value="English">English</option>
                                  <option value="Bahasa Malaysia">Bahasa Malaysia</option>
                                  <option value="Japanese">Japanese (Jepang)</option>
                                  <option value="Mandarin">Mandarin (Cina)</option>
                                </select>
                                <span className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80] block">Gaya Bahasa Narasi</span>
                                <select 
                                  value={voToneT2v} 
                                  onChange={(e) => setVoToneT2v(e.target.value)} 
                                  className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[10px] focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all font-semibold"
                                >
                                  <option value="casual">Casual / Santai (Akrab)</option>
                                  <option value="comedy">Comedy / Humor (Lucu)</option>
                                  <option value="excited">Excited / Antusias (Selling/Promo)</option>
                                  <option value="formal">Formal / Serius (Edukasi)</option>
                                  <option value="emotional">Emotional / Menyentuh (Hangat)</option>
                                  <option value="storytelling">Storytelling / Bercerita</option>
                                  <option value="dramatic">Dramatic / Misterius (Tegang)</option>
                                </select>
                              </div>
                            )}
                          </div>
                        )}
                        <button
                          onClick={() => handleGenerateVideoPrompts('text-to-video', false)}
                          disabled={generatingType !== null}
                          className="w-full bg-[#cfae80]/10 hover:bg-[#cfae80]/20 text-[#cfae80] border border-[#cfae80]/20 font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 text-[8.5px] uppercase tracking-wider transition-all disabled:opacity-50"
                        >
                          {generatingType === 'text-to-video' ? (
                            <>
                              <Loader className="animate-spin w-3.5 h-3.5" />
                              Membuat Prompt T2V...
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5" /> Generate Prompt Text-to-Video
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="pt-2">
                    {videoPromptError && (
                      <p className="text-[9px] text-red-450 font-semibold mt-1">{videoPromptError}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Video Studio & Actions */}
              <div className={`w-full md:w-[30%] p-4 md:p-6 flex flex-col justify-between overflow-y-auto flex-grow scrollbar-thin pb-20 md:pb-6 ${activeMobileTab === 'video' ? 'flex' : 'hidden md:flex'}`}>
                <div className="space-y-4">
                  {/* VIDEO STUDIO (FREEBEAT VIDEO GENERATOR) */}
                  <div className="space-y-4">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#cfae80] flex items-center gap-1.5">
                      🎬 Video Studio (Freebeat)
                    </h3>

                  {(() => {
                    const sceneVideos = videos
                      .filter(v => v.scene_idx === modalCarouselIdx)
                      .sort((a, b) => b.id - a.id); // sorted newest ID first

                    const latestVideo = sceneVideos[0];

                    if (latestVideo && latestVideo.status === 'processing') {
                      const activeTask = activeVideoTask;
                      return (
                        <div className="space-y-3 bg-[#131211]/50 border border-[#cfae80]/20 rounded-2xl p-4">
                          <div className="flex items-center justify-between border-b border-[#2a2725]/30 pb-2">
                            <div className="flex items-center gap-2">
                              <Loader className="animate-spin text-[#cfae80] w-3.5 h-3.5" />
                              <span className="text-[9px] font-bold text-[#cfae80] uppercase tracking-widest">
                                Sedang Membuat Video...
                              </span>
                            </div>
                          </div>
                          <div className="bg-black/80 border border-[#2a2725] rounded-xl p-3 h-32 overflow-y-auto font-mono text-[9px] text-slate-400 scrollbar-thin whitespace-pre-line leading-relaxed">
                            {activeTask?.logs || 'Menhubungi antrean Freebeat CLI...'}
                          </div>
                        </div>
                      );
                    }

                    if (latestVideo && latestVideo.status === 'failed') {
                      return (
                        <div className="space-y-3 bg-[#131211]/50 border border-red-500/25 rounded-2xl p-4 animate-fadeIn">
                          <div className="flex justify-between items-center">
                            <span className="text-[9px] font-bold text-red-400 uppercase tracking-widest">
                              ✗ Pembuatan Video Gagal
                            </span>
                            <button
                              onClick={async () => {
                                try {
                                  await api.delete(`/videos/${latestVideo.id}`);
                                  setVideos(prev => prev.filter(v => v.id !== latestVideo.id));
                                  setVideoTaskId(null);
                                  setActiveVideoTask(null);
                                } catch (e) {
                                  alert('Gagal membersihkan data.');
                                }
                              }}
                              className="text-[9px] text-[#cfae80] hover:text-[#c5a880] font-bold uppercase tracking-widest transition-colors"
                            >
                              Coba Lagi / Bersihkan
                            </button>
                          </div>
                          <div className="bg-black/80 border border-[#2a2725] rounded-xl p-3 h-32 overflow-y-auto font-mono text-[9px] text-red-300/80 scrollbar-thin whitespace-pre-line leading-relaxed">
                            {activeVideoTask && (activeVideoTask.taskId === latestVideo.task_id || activeVideoTask.status === 'failed')
                              ? (activeVideoTask.logs || activeVideoTask.error || 'Terjadi kesalahan saat memproses Freebeat CLI.')
                              : (latestVideo.logs || latestVideo.error_message || 'Pembuatan video gagal. Silakan klik "Coba Lagi / Bersihkan" untuk mencoba ulang dengan model atau prompt lain.')
                            }
                          </div>
                        </div>
                      );
                    }

                    // If we have successful videos and we are not in recreate form mode
                    if (sceneVideos.length > 0 && !showGenForm) {
                      const activeIdx = activeVideoIdx < sceneVideos.length ? activeVideoIdx : 0;
                      const activeVid = sceneVideos[activeIdx];

                      return (
                        <div className="space-y-3 bg-[#131211]/50 border border-emerald-500/20 rounded-2xl p-4 animate-fadeIn">
                          {/* Navigation header for multiple videos */}
                          {sceneVideos.length > 1 && (
                            <div className="flex justify-between items-center bg-black/40 border border-[#2a2725] px-2.5 py-1.5 rounded-xl text-[9px] mb-1">
                              <span className="text-[#cfae80] font-bold uppercase tracking-wider">
                                🎥 Video {sceneVideos.length - activeIdx} / {sceneVideos.length}
                              </span>
                              <div className="flex gap-1">
                                <button
                                  disabled={activeIdx === sceneVideos.length - 1}
                                  onClick={() => setActiveVideoIdx(prev => prev + 1)}
                                  className="px-1.5 py-0.5 bg-[#131211] text-slate-300 disabled:opacity-30 rounded border border-[#2a2725] hover:bg-[#1a1918] text-[8px] font-bold"
                                >
                                  ◀ LAMA
                                </button>
                                <button
                                  disabled={activeIdx === 0}
                                  onClick={() => setActiveVideoIdx(prev => prev - 1)}
                                  className="px-1.5 py-0.5 bg-[#131211] text-slate-300 disabled:opacity-30 rounded border border-[#2a2725] hover:bg-[#1a1918] text-[8px] font-bold"
                                >
                                  BARU ▶
                                </button>
                              </div>
                            </div>
                          )}

                          <div className="flex justify-between items-center pb-1">
                            <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest">
                              ✓ Berhasil ({activeVid.model})
                            </span>
                            <button
                              onClick={async () => {
                                if (window.confirm('Apakah Anda yakin ingin menghapus video ini secara permanen?')) {
                                  try {
                                    await api.delete(`/videos/${activeVid.id}`);
                                    setVideos(prev => prev.filter(v => v.id !== activeVid.id));
                                    setActiveVideoIdx(prev => Math.max(0, Math.min(prev, sceneVideos.length - 2)));
                                  } catch (e) {
                                    alert('Gagal menghapus video.');
                                  }
                                }
                              }}
                              className="text-[9px] text-red-400 hover:text-red-300 font-bold uppercase tracking-widest transition-colors"
                            >
                              Hapus
                            </button>
                          </div>
                          
                          <video 
                            key={activeVid.id} // re-mount player when switching videos
                            src={getFullImageUrl(activeVid.video_url)} 
                            controls 
                            playsInline
                            preload="auto"
                            className="w-full rounded-xl border border-[#2a2725] bg-black max-h-48"
                          />

                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <a
                              href={getDownloadUrl(activeVid.video_url)}
                              onClick={(e) => handleDownloadClick(e, activeVid.video_url, `storyboard-${selectedStoryboard.id}-scene-${modalCarouselIdx + 1}.mp4`, `vid-${selectedStoryboard.id}-${modalCarouselIdx}`)}
                              download={`storyboard-${selectedStoryboard.id}-scene-${modalCarouselIdx + 1}.mp4`}
                              className="w-full bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-2 px-2.5 rounded-lg text-[8.5px] uppercase tracking-wider flex items-center justify-center gap-1 transition-all text-center cursor-pointer disabled:opacity-50"
                              style={{ pointerEvents: downloadingId ? 'none' : 'auto' }}
                            >
                              {downloadingId === `vid-${selectedStoryboard.id}-${modalCarouselIdx}` ? (
                                <>
                                  <Loader className="animate-spin w-3.5 h-3.5" /> Simpan Video...
                                </>
                              ) : (
                                <>
                                  <Download className="w-3.5 h-3.5" /> Simpan Video
                                </>
                              )}
                            </a>
                            <a
                              href={activeVid.video_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full bg-[#131211] hover:bg-[#1a1918] text-slate-350 font-bold py-2 px-2.5 rounded-lg border border-[#2a2725]/60 text-[8.5px] uppercase tracking-wider flex items-center justify-center gap-1 transition-all text-center"
                            >
                              <ExternalLink className="w-3.5 h-3.5 text-[#cfae80]" /> Tab Baru
                            </a>
                          </div>

                          {/* AI Copywriting / Marketing Info */}
                          <div className="bg-[#181716] border border-[#2a2725]/80 rounded-xl p-3 space-y-3 mt-2 animate-fadeIn text-left">
                            <div className="flex items-center justify-between border-b border-[#2a2725]/50 pb-1.5">
                              <span className="text-[8px] font-bold text-[#cfae80] uppercase tracking-widest flex items-center gap-1">
                                📢 AI Marketing Copy
                              </span>
                              {activeVid.marketing_title && (
                                <button
                                  onClick={() => handleRegenerateMarketingCopy(activeVid.id)}
                                  disabled={regeneratingCopyId !== null}
                                  className="text-[8px] text-slate-400 hover:text-[#cfae80] font-bold uppercase tracking-widest transition-colors disabled:opacity-50"
                                >
                                  {regeneratingCopyId === activeVid.id ? 'Memproses...' : 'Tulis Ulang'}
                                </button>
                              )}
                            </div>

                            {activeVid.marketing_title ? (
                              <div className="space-y-2.5">
                                {/* Title display */}
                                <div className="space-y-1">
                                  <div className="flex justify-between items-center text-[7px] font-bold text-slate-400 uppercase tracking-widest">
                                    <span>Judul (Max 100 Karakter)</span>
                                    <button 
                                      onClick={() => {
                                        navigator.clipboard.writeText(activeVid.marketing_title);
                                        alert('Judul berhasil disalin!');
                                      }}
                                      className="text-[#cfae80] hover:underline"
                                    >
                                      Salin
                                    </button>
                                  </div>
                                  <div className="bg-black/40 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[10px] font-semibold break-words leading-relaxed font-sans">
                                    {activeVid.marketing_title}
                                  </div>
                                </div>

                                {/* Description & Hashtags display */}
                                <div className="space-y-1">
                                  <div className="flex justify-between items-center text-[7px] font-bold text-slate-400 uppercase tracking-widest">
                                    <span>Deskripsi & Hashtag</span>
                                    <button 
                                      onClick={() => {
                                        navigator.clipboard.writeText(activeVid.marketing_description);
                                        alert('Deskripsi & Hashtag berhasil disalin!');
                                      }}
                                      className="text-[#cfae80] hover:underline"
                                    >
                                      Salin
                                    </button>
                                  </div>
                                  <div className="bg-black/40 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-slate-300 text-[9.5px] leading-relaxed break-words whitespace-pre-line font-sans max-h-32 overflow-y-auto scrollbar-thin">
                                    {activeVid.marketing_description}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center justify-center py-4 gap-2 text-center">
                                <span className="text-[9px] text-slate-500 italic">
                                  {regeneratingCopyId === activeVid.id 
                                    ? '⏳ Sedang menulis konten promosi...' 
                                    : 'Belum ada konten promosi / Gagal dibuat.'}
                                </span>
                                {regeneratingCopyId !== activeVid.id && (
                                  <button
                                    onClick={() => handleRegenerateMarketingCopy(activeVid.id)}
                                    className="bg-[#cfae80]/10 hover:bg-[#cfae80]/20 text-[#cfae80] border border-[#cfae80]/20 font-bold py-1.5 px-2.5 rounded-lg text-[8px] uppercase tracking-wider flex items-center justify-center gap-1 transition-all"
                                  >
                                    <Sparkles className="w-3 h-3 text-[#cfae80]" /> Buat Konten Promosi
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Recreate Button */}
                          <div className="border-t border-[#2a2725]/40 pt-2.5 mt-2.5">
                            <button
                              onClick={() => setShowGenForm(true)}
                              className="w-full bg-[#131211] hover:bg-[#191817] text-[#cfae80] border border-[#cfae80]/20 font-bold py-1.5 px-2.5 rounded-lg text-[8.5px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all"
                            >
                              <Film className="w-3.5 h-3.5" /> Buat Video Baru (Recreate)
                            </button>
                          </div>
                        </div>
                      );
                    }

                    // Render the generation form if no videos exist OR if in showGenForm mode
                    return (
                      <div className="space-y-3 bg-[#131211]/35 border border-[#2a2725] rounded-2xl p-4">
                        {sceneVideos.length > 0 && (
                          <button
                            onClick={() => setShowGenForm(false)}
                            className="w-full bg-slate-950/40 hover:bg-slate-900/60 text-slate-300 border border-slate-800/80 font-bold py-1.5 px-2.5 rounded-lg text-[8.5px] uppercase tracking-wider flex items-center justify-center gap-1 transition-all mb-1"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" /> Kembali ke Video
                          </button>
                        )}
                        {apiKeys.length > 0 && (
                          <div className="space-y-1">
                            <label className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80]">API Key Freebeat</label>
                            <select
                              value={selectedApiKeyId}
                              onChange={(e) => setSelectedApiKeyId(e.target.value)}
                              className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[10px] focus:outline-none focus:border-[#cfae80] transition-all font-semibold"
                            >
                              <option value="auto">Pilih Otomatis (Auto-detect)</option>
                              {apiKeys.map(k => (
                                <option key={k.id} value={k.id}>
                                  {k.label} (⚡ {k.total_credits} Kredit)
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        <div className="space-y-1">
                          <label className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80]">Pilih Model Video</label>
                          <select
                            value={videoModel}
                            onChange={(e) => {
                              setVideoModel(e.target.value);
                              const m = VIDEO_MODELS.find(x => x.value === e.target.value);
                              if (m) {
                                setVideoDuration(String(m.durations[0]));
                                setVideoResolution(m.resolutions[0]);
                                if (!m.supportsAudio) {
                                  setVideoGenerateAudio(false);
                                }
                              }
                            }}
                            className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[10px] focus:outline-none focus:border-[#cfae80] transition-all font-semibold"
                          >
                            {VIDEO_MODELS.map(m => (
                              <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80]">Metode Pembuatan</label>
                          <select
                            value={videoGenType}
                            onChange={(e) => {
                              setVideoGenType(e.target.value);
                              if (e.target.value === 'image') {
                                setVideoStudioPrompt(imageToVideoPrompt || '');
                              } else {
                                setVideoStudioPrompt(textToVideoPrompt || '');
                              }
                            }}
                            className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[10px] focus:outline-none focus:border-[#cfae80] transition-all font-semibold"
                          >
                            <option value="image">Image-to-Video (I2V - Gunakan Gambar Panel)</option>
                            <option value="text">Text-to-Video (T2V - Hanya Prompt Teks)</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80]">Custom Prompt</label>
                          <textarea
                            value={videoStudioPrompt}
                            onChange={(e) => setVideoStudioPrompt(e.target.value)}
                            placeholder="Masukkan deskripsi detail gerakan video..."
                            className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[10px] focus:outline-none focus:border-[#cfae80] transition-all font-medium h-16 resize-none scrollbar-thin"
                          />
                        </div>

                        <div className="grid grid-cols-3 gap-1.5 border-t border-[#2a2725]/45 pt-2.5">
                          <div className="space-y-1">
                            <label className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Durasi</label>
                            <select
                              value={videoDuration}
                              onChange={(e) => setVideoDuration(e.target.value)}
                              className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-1.5 py-1 text-white text-[9px] focus:outline-none focus:border-[#cfae80] font-semibold"
                            >
                              {(() => {
                                const m = VIDEO_MODELS.find(x => x.value === videoModel);
                                return m?.durations.map(d => (
                                  <option key={d} value={d}>{d}s</option>
                                )) || <option value="5">5s</option>;
                              })()}
                            </select>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Resolusi</label>
                            <select
                              value={videoResolution}
                              onChange={(e) => setVideoResolution(e.target.value)}
                              className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-1.5 py-1 text-white text-[9px] focus:outline-none focus:border-[#cfae80] font-semibold"
                            >
                              {(() => {
                                const m = VIDEO_MODELS.find(x => x.value === videoModel);
                                return m?.resolutions.map(r => (
                                  <option key={r} value={r}>{r}</option>
                                )) || <option value="720p">720p</option>;
                              })()}
                            </select>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Rasio</label>
                            <select
                              value={videoAspectRatio}
                              onChange={(e) => setVideoAspectRatio(e.target.value)}
                              className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-1.5 py-1 text-white text-[9px] focus:outline-none focus:border-[#cfae80] font-semibold"
                            >
                              <option value="auto">Auto</option>
                              <option value="16:9">16:9</option>
                              <option value="9:16">9:16</option>
                              <option value="1:1">1:1</option>
                              <option value="4:3">4:3</option>
                              <option value="3:4">3:4</option>
                            </select>
                          </div>
                        </div>

                        {(() => {
                          const m = VIDEO_MODELS.find(x => x.value === videoModel);
                          const supportsAudio = m?.supportsAudio;
                          return (
                            <label className={`flex items-center gap-2 cursor-pointer select-none border-t border-[#2a2725]/40 pt-2 pb-1 ${!supportsAudio ? 'opacity-40 cursor-not-allowed' : ''}`}>
                              <input
                                type="checkbox"
                                checked={videoGenerateAudio}
                                disabled={!supportsAudio}
                                onChange={(e) => setVideoGenerateAudio(e.target.checked)}
                                className="rounded border-[#2a2725] bg-black text-[#cfae80] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 disabled:opacity-50"
                              />
                              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-350">
                                Hasilkan Audio / Sound Effect {!supportsAudio && <span className="text-[8px] text-red-500/80 font-medium normal-case ml-1">(Model ini tidak mendukung audio)</span>}
                              </span>
                            </label>
                          );
                        })()}

                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={handleGenerateVideo}
                            className="flex-1 bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 text-[8.5px] uppercase tracking-wider transition-all"
                          >
                            <Play className="w-3.5 h-3.5 fill-black" /> Buat Video
                          </button>
                          <button
                            onClick={handleGenerateAllVideos}
                            className="flex-1 bg-[#cfae80]/10 hover:bg-[#cfae80]/20 text-[#cfae80] border border-[#cfae80]/20 font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 text-[8.5px] uppercase tracking-wider transition-all"
                          >
                            <Zap className="w-3.5 h-3.5 text-[#cfae80] fill-[#cfae80]/10" /> Buat Semua
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                </div>
              </div>

              {/* Mobile Bottom Tab Switcher (Premium Native Style) */}
              <div className="flex md:hidden border-t border-[#2a2725] bg-[#141312]/95 backdrop-blur-md fixed bottom-0 left-0 right-0 z-40 px-6 pt-2 pb-[env(safe-area-inset-bottom,0.75rem)] shrink-0 w-full shadow-2xl justify-between items-center">
                <button
                  type="button"
                  onClick={() => setActiveMobileTab('image')}
                  className="flex flex-col items-center gap-1.5 py-1 px-3 transition-all relative flex-1"
                >
                  <Image className={`w-4 h-4 transition-colors duration-300 ${activeMobileTab === 'image' ? 'text-[#cfae80]' : 'text-slate-400'}`} />
                  <span className={`text-[8.5px] font-bold tracking-widest uppercase transition-all duration-300 ${activeMobileTab === 'image' ? 'text-[#cfae80]' : 'text-slate-500'}`}>
                    Gambar
                  </span>
                  {activeMobileTab === 'image' && (
                    <span className="absolute top-0 w-1 h-1 rounded-full bg-[#cfae80] shadow-sm shadow-[#cfae80]"></span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveMobileTab('prompt')}
                  className="flex flex-col items-center gap-1.5 py-1 px-3 transition-all relative flex-1"
                >
                  <FileText className={`w-4 h-4 transition-colors duration-300 ${activeMobileTab === 'prompt' ? 'text-[#cfae80]' : 'text-slate-400'}`} />
                  <span className={`text-[8.5px] font-bold tracking-widest uppercase transition-all duration-300 ${activeMobileTab === 'prompt' ? 'text-[#cfae80]' : 'text-slate-500'}`}>
                    Naskah
                  </span>
                  {activeMobileTab === 'prompt' && (
                    <span className="absolute top-0 w-1 h-1 rounded-full bg-[#cfae80] shadow-sm shadow-[#cfae80]"></span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveMobileTab('video')}
                  className="flex flex-col items-center gap-1.5 py-1 px-3 transition-all relative flex-1"
                >
                  <Film className={`w-4 h-4 transition-colors duration-300 ${activeMobileTab === 'video' ? 'text-[#cfae80]' : 'text-slate-400'}`} />
                  <span className={`text-[8.5px] font-bold tracking-widest uppercase transition-all duration-300 ${activeMobileTab === 'video' ? 'text-[#cfae80]' : 'text-slate-500'}`}>
                    Video
                  </span>
                  {activeMobileTab === 'video' && (
                    <span className="absolute top-0 w-1 h-1 rounded-full bg-[#cfae80] shadow-sm shadow-[#cfae80]"></span>
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}
    </div>
  );
}
