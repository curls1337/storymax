import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import api from '../utils/api';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { CapacitorHttp } from '@capacitor/core';
import { Plus, Trash2, ExternalLink, Calendar, Loader, FolderOpen, X, ChevronRight, ChevronLeft, Download, Eye, AlertTriangle, Image, FileText, Film, Play, Zap, RefreshCw, Sparkles } from 'lucide-react';

export default function Dashboard({ setTab }) {
  const [storyboards, setStoryboards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedStoryboard, setSelectedStoryboard] = useState(null);
  const [modalCarouselIdx, setModalCarouselIdx] = useState(0);
  const [activeMergedIdx, setActiveMergedIdx] = useState(0);
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
        if (document.hidden) return; // hemat baterai & data: jangan polling saat app di background
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

  const [generatingStoryboardCopy, setGeneratingStoryboardCopy] = useState(false);

  const handleRegenerateStoryboardMarketingCopy = async () => {
    if (!selectedStoryboard) return;
    setGeneratingStoryboardCopy(true);
    try {
      const res = await api.post(`/storyboards/${selectedStoryboard.id}/scenes/${modalCarouselIdx}/marketing-copy`);
      setSelectedStoryboard(prev => {
        let videoPrompts = [];
        try {
          videoPrompts = JSON.parse(prev.video_prompts) || [];
        } catch (e) {
          videoPrompts = [];
        }
        if (!Array.isArray(videoPrompts)) videoPrompts = [];
        if (!videoPrompts[modalCarouselIdx]) {
          videoPrompts[modalCarouselIdx] = { scene_idx: modalCarouselIdx };
        }
        videoPrompts[modalCarouselIdx].marketing_title = res.data.marketing_title;
        videoPrompts[modalCarouselIdx].marketing_description = res.data.marketing_description;
        
        const updated = {
          ...prev,
          video_prompts: JSON.stringify(videoPrompts)
        };
        setStoryboards(list => list.map(item => item.id === prev.id ? updated : item));
        return updated;
      });
    } catch (err) {
      console.error("Error regenerating storyboard marketing copy:", err);
      alert('Gagal membuat naskah promosi.');
    } finally {
      setGeneratingStoryboardCopy(false);
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

  // Google Sheets Export selection states
  const [exportSelectedIds, setExportSelectedIds] = useState([]);
  const [exportingGoogle, setExportingGoogle] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportSuccessModal, setExportSuccessModal] = useState(null);

  const toggleExportSelect = (id, e) => {
    if (e) e.stopPropagation();
    setExportSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleExportSelectAll = () => {
    if (exportSelectedIds.length === storyboards.length) {
      setExportSelectedIds([]);
    } else {
      setExportSelectedIds(storyboards.map(s => s.id));
    }
  };

  const handleExportToGoogleSheets = async () => {
    if (exportSelectedIds.length === 0) return;
    setExportingGoogle(true);
    try {
      const res = await api.post('/storyboards/export-google-sheets', {
        storyboardIds: exportSelectedIds
      });
      setExportSuccessModal({
        url: res.data.spreadsheetUrl,
        message: res.data.message,
        count: res.data.count
      });
    } catch (err) {
      console.error("Error exporting to Google Sheets:", err);
      alert(err.response?.data?.message || 'Gagal mengekspor data ke Google Sheets.');
    } finally {
      setExportingGoogle(false);
    }
  };

  const handleExportToCSV = async () => {
    if (exportSelectedIds.length === 0) return;
    setExportingCsv(true);
    try {
      const response = await api.post(
        '/storyboards/export-csv',
        { storyboardIds: exportSelectedIds },
        { responseType: 'blob' }
      );
      
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `storymax_export_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error exporting to CSV:", err);
      alert('Gagal mengekspor data ke CSV.');
    } finally {
      setExportingCsv(false);
    }
  };

  // Video Studio states
  const [videos, setVideos] = useState([]);
  const [fetchingVideos, setFetchingVideos] = useState(false);
  const [videoTaskId, setVideoTaskId] = useState(null);
  const [activeVideoTask, setActiveVideoTask] = useState(null);
  const [activeVideoIdx, setActiveVideoIdx] = useState(0);
  const [showGenForm, setShowGenForm] = useState(false);

  const [videoModel, setVideoModel] = useState('seedance-2.0-fast');
  const [videoGenType, setVideoGenType] = useState('reference');
  const [videoStudioPrompt, setVideoStudioPrompt] = useState('');
  const [videoDuration, setVideoDuration] = useState('15');
  const [videoResolution, setVideoResolution] = useState('720p');
  const [videoAspectRatio, setVideoAspectRatio] = useState('9:16');
  const [videoGenerateAudio, setVideoGenerateAudio] = useState(false);
  const [videoBacksound, setVideoBacksound] = useState(false);
  const [apiKeys, setApiKeys] = useState([]);
  const [selectedApiKeyId, setSelectedApiKeyId] = useState('auto');
  
  const [regeneratingPages, setRegeneratingPages] = useState({});
  const [regenLogs, setRegenLogs] = useState({});
  const [downloadingId, setDownloadingId] = useState(null);
  const [mergingVideos, setMergingVideos] = useState(false);
  const [selectedVideoIds, setSelectedVideoIds] = useState({});

  useEffect(() => {
    if (!selectedStoryboard || !videos) return;
    
    let pagesList = [];
    try {
      const parsed = JSON.parse(selectedStoryboard.image_path);
      pagesList = Array.isArray(parsed) ? parsed : [selectedStoryboard.image_path];
    } catch (e) {
      if (selectedStoryboard.image_path && selectedStoryboard.image_path.includes(',')) {
        pagesList = selectedStoryboard.image_path.split(',').map(s => s.trim());
      } else if (selectedStoryboard.image_path) {
        pagesList = [selectedStoryboard.image_path];
      }
    }

    if (pagesList.length === 0) return;

    const initialSelections = { ...selectedVideoIds };
    let changed = false;

    for (let i = 0; i < pagesList.length; i++) {
      const sceneVids = videos.filter(v => v.scene_idx === i && v.status === 'success');
      if (sceneVids.length > 0) {
        const latest = sceneVids.sort((a, b) => b.id - a.id)[0];
        if (!initialSelections[i] || !sceneVids.some(v => v.id === initialSelections[i])) {
          initialSelections[i] = latest.id;
          changed = true;
        }
      }
    }

    if (changed) {
      setSelectedVideoIds(initialSelections);
    }
  }, [selectedStoryboard, videos]);

  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeTransitionType, setMergeTransitionType] = useState('fade');
  const [mergeAudioBlend, setMergeAudioBlend] = useState(true);
  const [mergeSequence, setMergeSequence] = useState([]);

  // Swipe gesture helper: lets users slide left/right to move between storyboard
  // pages and between videos (no need to tap Next/Prev). Returns touch handlers to
  // spread onto a container; onLeft fires on a left swipe, onRight on a right swipe.
  const swipeStart = useRef({ x: 0, y: 0 });
  const onSwipe = (onLeft, onRight) => ({
    onTouchStart: (e) => {
      const t = e.changedTouches[0];
      swipeStart.current = { x: t.screenX, y: t.screenY };
    },
    onTouchEnd: (e) => {
      const t = e.changedTouches[0];
      const dx = t.screenX - swipeStart.current.x;
      const dy = t.screenY - swipeStart.current.y;
      // Only trigger on a clearly horizontal swipe (ignore taps & vertical scrolls).
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        if (dx < 0) { if (onLeft) onLeft(); }
        else { if (onRight) onRight(); }
      }
    },
  });

  useEffect(() => {
    if (showMergeModal && selectedStoryboard) {
      let pagesList = [];
      try {
        const parsed = JSON.parse(selectedStoryboard.image_path);
        pagesList = Array.isArray(parsed) ? parsed : [selectedStoryboard.image_path];
      } catch (e) {
        if (selectedStoryboard.image_path && selectedStoryboard.image_path.includes(',')) {
          pagesList = selectedStoryboard.image_path.split(',').map(s => s.trim());
        } else if (selectedStoryboard.image_path) {
          pagesList = [selectedStoryboard.image_path];
        }
      }
      // Initialize sequence: [0, 1, 2, ...]
      setMergeSequence(pagesList.map((_, i) => i));
    }
  }, [showMergeModal, selectedStoryboard]);

  const moveSequenceItem = (index, direction) => {
    const newSeq = [...mergeSequence];
    if (direction === 'up' && index > 0) {
      const temp = newSeq[index];
      newSeq[index] = newSeq[index - 1];
      newSeq[index - 1] = temp;
    } else if (direction === 'down' && index < newSeq.length - 1) {
      const temp = newSeq[index];
      newSeq[index] = newSeq[index + 1];
      newSeq[index + 1] = temp;
    }
    setMergeSequence(newSeq);
  };

  const handleMergeVideos = () => {
    if (!selectedStoryboard) return;
    setShowMergeModal(true);
  };

  const confirmMergeVideos = async () => {
    setShowMergeModal(false);

    const videoIds = [];
    for (let i = 0; i < mergeSequence.length; i++) {
      const pageIdx = mergeSequence[i];
      const id = selectedVideoIds[pageIdx];
      if (id) {
        videoIds.push(id);
      }
    }

    if (videoIds.length < 2) {
      alert('Minimal harus ada 2 video sukses untuk dapat digabungkan.');
      return;
    }

    setMergingVideos(true);
    try {
      const res = await api.post(`/videos/storyboard/${selectedStoryboard.id}/merge`, { 
        videoIds,
        transitionType: mergeTransitionType,
        audioBlend: mergeAudioBlend
      });
      
      // Update selectedStoryboard merged_video_url & merged_video_history in state
      setSelectedStoryboard(prev => {
        let history = [];
        if (prev.merged_video_history) {
          try { history = JSON.parse(prev.merged_video_history); } catch (e) { history = []; }
        }
        if (!Array.isArray(history)) history = [];
        if (res.data.merged_video_history) {
          try { history = JSON.parse(res.data.merged_video_history); } catch (e) {}
        } else {
          if (prev.merged_video_url && !history.includes(prev.merged_video_url)) {
            history.push(prev.merged_video_url);
          }
          if (!history.includes(res.data.merged_video_url)) {
            history.push(res.data.merged_video_url);
          }
        }
        
        const updatedHistoryJson = JSON.stringify(history);
        setActiveMergedIdx(Math.max(0, history.length - 1));

        return {
          ...prev,
          merged_video_url: res.data.merged_video_url,
          merged_video_history: updatedHistoryJson
        };
      });
      
      // Update storyboards list state so it stays updated
      setStoryboards(prev => prev.map(sb => {
        if (sb.id === selectedStoryboard.id) {
          let history = [];
          if (res.data.merged_video_history) {
            try { history = JSON.parse(res.data.merged_video_history); } catch (e) {}
          }
          return { 
            ...sb, 
            merged_video_url: res.data.merged_video_url,
            merged_video_history: JSON.stringify(history)
          };
        }
        return sb;
      }));
      
      alert('Semua video pilihan berhasil digabungkan menjadi satu!');
    } catch (err) {
      console.error('Error merging videos:', err);
      alert(err.response?.data?.message || 'Gagal menggabungkan video.');
    } finally {
      setMergingVideos(false);
    }
  };

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

  // genTypes = generation-types Freebeat supports per model (from Freebeat errors).
  // Only these appear in "Metode Pembuatan" so we never send an unsupported type.
  const VIDEO_MODELS = [
    { value: 'pixverse-c1', label: 'Pixverse C1 (1-15s, Audio)', genTypes: ['image','text','transition'], durations: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], resolutions: ['360p', '540p', '720p', '1080p'], supportsAudio: true },
    { value: 'pixverse-v6', label: 'Pixverse V6 (5-15s, Audio)', genTypes: ['image','text','transition'], durations: [5,6,7,8,9,10,11,12,13,14,15], resolutions: ['720p', '1080p'], supportsAudio: true },
    { value: 'veo3-1', label: 'Veo 3.1 (4-8s, Audio)', genTypes: ['image','text'], durations: [4,6,8], resolutions: ['720p', '1080p'], supportsAudio: true },
    { value: 'veo3-1-fast', label: 'Veo 3.1 Fast (4-8s, Audio)', genTypes: ['image','text'], durations: [4,6,8], resolutions: ['720p', '1080p'], supportsAudio: true },
    { value: 'sora-2-pro', label: 'Sora 2 Pro (4|8|12s, 16:9|9:16)', genTypes: ['image','text'], durations: [4, 8, 12], resolutions: ['720p', '1080p'], supportsAudio: false },
    { value: 'kling-v3-4k', label: 'Kling V3 4K (3-15s, 4K)', genTypes: ['image','text','transition'], durations: [3,4,5,6,7,8,9,10,11,12,13,14,15], resolutions: ['4k'], supportsAudio: false },
    { value: 'seedance-2.0', label: 'SeedDance 2.0 (4-15s)', genTypes: ['image','text','transition','reference'], durations: [4,5,6,7,8,9,10,11,12,13,14,15], resolutions: ['720p'], supportsAudio: false },
    { value: 'seedance-2.0-fast', label: 'SeedDance 2.0 Fast (4-15s)', genTypes: ['image','text','transition','reference'], durations: [4,5,6,7,8,9,10,11,12,13,14,15], resolutions: ['720p'], supportsAudio: false },
    { value: 'wan-v2.7-video', label: 'Wan V2.7 Video (2-10s)', genTypes: ['image','text','transition','reference'], durations: [2,3,4,5,6,7,8,9,10], resolutions: ['720p', '1080p'], supportsAudio: false },
    { value: 'happy-horse', label: 'HappyHorse (3-15s)', genTypes: ['image','text','transition'], durations: [3,4,5,6,7,8,9,10,11,12,13,14,15], resolutions: ['720p', '1080p'], supportsAudio: false }
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
          setSelectedApiKeyId('auto');
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
      let basePrompt = (videoGenType === 'image' || videoGenType === 'reference' || videoGenType === 'transition') ? (i2v || '') : (t2v || '');
      
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
        if (document.hidden) return; // hemat baterai & data: jangan polling saat app di background
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
        backsound: videoBacksound,
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
        backsound: videoBacksound,
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
    
    // Append the JWT so browser-navigation downloads (window.open on mobile, or a
    // plain <a download> on web) are authenticated — they cannot send headers.
    const token = localStorage.getItem('token');
    return `${cleanBase}/storyboards/download?url=${encodeURIComponent(cleanUrl)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
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

    // Redirect mobile platform downloads directly to system browser (Safari/Chrome)
    try {
      window.open(downloadUrl, '_system');
    } catch (err) {
      console.error("Capacitor external open error:", err);
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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={fetchStoryboards}
            className="border border-[#2a2725] bg-black/40 hover:bg-[#cfae80] hover:text-black text-slate-300 font-bold py-3 px-4 rounded-2xl transition-all duration-300 text-xs tracking-widest uppercase shrink-0 flex items-center justify-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button
            type="button"
            onClick={() => setTab('generator')}
            className="border border-[#cfae80] hover:bg-[#cfae80] hover:text-black text-[#cfae80] font-bold py-3 px-6 rounded-2xl transition-all duration-300 text-xs tracking-widest uppercase shrink-0"
          >
            <Plus className="w-4 h-4 inline mr-2" />
            Mulai Project
          </button>
        </div>
      </div>

      {/* Mobile Header */}
      <div className="flex md:hidden flex-row justify-between items-center border-b border-[#2a2725] pb-3 mb-2">
        <h1 className="text-lg font-editorial italic text-white">Galeri Storyboard</h1>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={fetchStoryboards}
            className="border border-[#2a2725] bg-black/40 hover:bg-[#cfae80] hover:text-black text-slate-350 font-bold py-1.5 px-2.5 rounded-xl transition-all duration-300 text-[10px] tracking-wider uppercase shrink-0 flex items-center justify-center"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setTab('generator')}
            className="border border-[#cfae80] hover:bg-[#cfae80] hover:text-black text-[#cfae80] font-bold py-1.5 px-3 rounded-xl transition-all duration-300 text-[10px] tracking-wider uppercase shrink-0"
          >
            <Plus className="w-3.5 h-3.5 inline mr-1" />
            Mulai Project
          </button>
        </div>
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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#131211]/60 border border-[#2a2725] rounded-2xl p-3.5 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={storyboards.length > 0 && exportSelectedIds.length === storyboards.length}
                  onChange={toggleExportSelectAll}
                  className="w-4 h-4 rounded border-[#2a2725] bg-black text-[#cfae80] focus:ring-0 cursor-pointer accent-[#cfae80]"
                />
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">
                  {exportSelectedIds.length === storyboards.length ? 'Batal Pilih Semua' : 'Pilih Semua'}
                </span>
              </label>
              <span className="text-[9px] text-[#cfae80] font-semibold bg-[#cfae80]/10 border border-[#cfae80]/20 px-2 py-0.5 rounded-full">
                {exportSelectedIds.length} dari {storyboards.length} terpilih
              </span>
            </div>

            {exportSelectedIds.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleExportToCSV}
                  disabled={exportingCsv || exportingGoogle}
                  className="bg-black/60 hover:bg-[#cfae80] hover:text-black text-slate-200 border border-[#2a2725] font-bold py-2 px-3.5 rounded-xl text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer disabled:opacity-50"
                >
                  {exportingCsv ? (
                    <>
                      <Loader className="animate-spin w-3.5 h-3.5" />
                      Mengunduh CSV...
                    </>
                  ) : (
                    <>
                      📥 Export CSV
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleExportToGoogleSheets}
                  disabled={exportingGoogle || exportingCsv}
                  className="bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-2 px-4 rounded-xl text-[10px] uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-lg cursor-pointer disabled:opacity-50"
                >
                  {exportingGoogle ? (
                    <>
                      <Loader className="animate-spin w-3.5 h-3.5" />
                      Mengespor ke Drive...
                    </>
                  ) : (
                    <>
                      📊 Export Google Sheets
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
          
          {/* COMPACT CARD GRID */}
          <div className="grid grid-cols-3 min-[480px]:grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3 md:gap-5">
            {storyboards.map((sb) => {
              const isProcessing = sb.status === 'processing';
              const isFailed = sb.status === 'failed';
              const isSelectedForExport = exportSelectedIds.includes(sb.id);
              const isRefImage = (() => {
                try { return JSON.parse(sb.generation_params || '{}').style === 'ref_image'; }
                catch (e) { return (sb.title || '').startsWith('[Ref]'); }
              })();

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
                    if (isRefImage) {
                      // Still just a reference image (not a storyboard yet) -> open the AI
                      // Generator with it preloaded as a reference, to build a storyboard.
                      const imgs = getResultImages(sb);
                      const refUrl = imgs && imgs[0];
                      if (refUrl) { try { localStorage.setItem('preloadRefImage', JSON.stringify({ value: refUrl, title: sb.title })); } catch (e) {} }
                      if (setTab) setTab('generator');
                      return;
                    }
                    setSelectedStoryboard(sb);
                    setModalCarouselIdx(0);
                    setActiveSceneIdx(0);
                    setVideoPromptError('');
                  }}
                  className={`bg-[#1a1918]/60 border rounded-2xl overflow-hidden hover:border-[#cfae80]/40 transition-all duration-300 group flex flex-col relative ${
                    isSelectedForExport ? 'ring-2 ring-[#cfae80] border-[#cfae80]' : isProcessing ? 'border-[#cfae80]/20 cursor-wait' : isFailed ? 'border-red-500/20 cursor-default' : 'border-[#2a2725] cursor-pointer'
                  }`}
                >
                  {/* Selection Checkbox Overlay */}
                  <div 
                    onClick={(e) => toggleExportSelect(sb.id, e)}
                    className="absolute top-1.5 left-1.5 z-30 bg-black/70 p-1 rounded-lg backdrop-blur-sm cursor-pointer hover:scale-110 transition-transform"
                    title="Pilih untuk Export"
                  >
                    <input
                      type="checkbox"
                      checked={isSelectedForExport}
                      onChange={(e) => toggleExportSelect(sb.id, e)}
                      className="w-3.5 h-3.5 rounded border-[#2a2725] bg-black text-[#cfae80] focus:ring-0 cursor-pointer accent-[#cfae80]"
                    />
                  </div>

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
                        {sb.api_key_label ? ` · API: ${sb.api_key_label}` : ''}
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
              className="relative w-full h-full md:max-w-[1300px] md:h-[88vh] bg-[#131211] md:bg-[#1a1918] md:border md:border-[#2a2725] md:rounded-3xl overflow-hidden shadow-2xl flex flex-col my-auto animate-scaleUp"
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

              {/* Global Storyboard Page Navigation at the Top (Always visible on mobile & desktop) */}
              {images.length > 1 && (
                <div className="w-full bg-[#161514] border-b border-[#2a2725] px-4 py-2 flex items-center justify-center shrink-0 select-none z-10">
                  <div className="flex items-center gap-1.5 sm:gap-2.5 bg-[#131211] border border-[#2a2725] p-1 rounded-2xl shadow-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setModalCarouselIdx(prev => (prev > 0 ? prev - 1 : images.length - 1));
                        setActiveVideoIdx(0);
                      }}
                      className="px-3 py-1.5 bg-[#1a1918] hover:bg-[#cfae80] hover:text-black text-[#cfae80] rounded-xl transition-all border border-[#2a2725] cursor-pointer text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-md"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" /> Sebelumnya
                    </button>
                    
                    <span className="text-[9.5px] sm:text-[10px] font-bold text-white uppercase tracking-wider px-2.5 py-1">
                      Halaman {modalCarouselIdx + 1} dari {images.length}
                    </span>
                    
                    <button
                      type="button"
                      onClick={() => {
                        setModalCarouselIdx(prev => (prev < images.length - 1 ? prev + 1 : 0));
                        setActiveVideoIdx(0);
                      }}
                      className="px-3 py-1.5 bg-[#1a1918] hover:bg-[#cfae80] hover:text-black text-[#cfae80] rounded-xl transition-all border border-[#2a2725] cursor-pointer text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-md"
                    >
                      Berikutnya <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Columns split wrapper */}
              <div className="flex-grow flex flex-col md:flex-row overflow-hidden min-h-0">
                {/* Left Side: Large Image Carousel & Action Buttons */}
                <div className={`w-full md:w-2/5 bg-black/80 flex flex-col justify-between relative flex-grow md:flex-grow-0 md:min-h-0 border-b md:border-b-0 md:border-r border-[#2a2725] p-4 md:p-6 pb-24 md:pb-6 ${activeMobileTab === 'image' ? 'flex' : 'hidden md:flex'}`}>
                
                {/* Image display wrapper — swipe left/right to change page */}
                <div
                  className="flex-grow flex items-center justify-center relative min-h-[35vh]"
                  {...onSwipe(
                    () => { setModalCarouselIdx(prev => (prev < images.length - 1 ? prev + 1 : 0)); setActiveVideoIdx(0); },
                    () => { setModalCarouselIdx(prev => (prev > 0 ? prev - 1 : images.length - 1)); setActiveVideoIdx(0); }
                  )}
                >
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
                                  <option value="casual">Casual / Santai (Akrab & Gaul)</option>
                                  <option value="comedy">Comedy / Humor (Lucu & Jenaka)</option>
                                  <option value="excited">Excited / Antusias (Selling & High-Energy)</option>
                                  <option value="formal">Formal / Resmi & Edukatif (Berwibawa)</option>
                                  <option value="emotional">Emotional / Menyentuh Hati (Puitis & Empatis)</option>
                                  <option value="storytelling">Storytelling / Alur Kisah Memikat</option>
                                  <option value="dramatic">Dramatic / Misterius & Teater (Tegang)</option>
                                  <option value="soft_spoken">Soft-Spoken / Bisikan ASMR (Tenang & Rileks)</option>
                                  <option value="luxury_premium">Luxury / Premium Elite (Elegan & Mewah)</option>
                                  <option value="poetic_aesthetic">Poetic / Puitis & Estetik (Indah)</option>
                                  <option value="news_anchor">News Anchor / Reporter Berita (Fakta & Lugas)</option>
                                  <option value="motivator_inspirational">Motivator / Semangat Inspiratif (Powerfully Inspiring)</option>
                                  <option value="review_honest">Honest Reviewer / Ulasan Jujur (Autentik)</option>
                                  <option value="cinematic_trailer">Movie Trailer / Hollywood Box-Office (Epik)</option>
                                  <option value="sarcastic_witty">Sarcastic / Witty & Sindiran Halus (Cerdas)</option>
                                  <option value="kids_playful">Kids & Playful / Dunia Anak (Ceria & Riang)</option>
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
                                <option value="casual">Casual / Santai (Akrab & Gaul)</option>
                                <option value="comedy">Comedy / Humor (Lucu & Jenaka)</option>
                                <option value="excited">Excited / Antusias (Selling & High-Energy)</option>
                                <option value="formal">Formal / Resmi & Edukatif (Berwibawa)</option>
                                <option value="emotional">Emotional / Menyentuh Hati (Puitis & Empatis)</option>
                                <option value="storytelling">Storytelling / Alur Kisah Memikat</option>
                                <option value="dramatic">Dramatic / Misterius & Teater (Tegang)</option>
                                <option value="soft_spoken">Soft-Spoken / Bisikan ASMR (Tenang & Rileks)</option>
                                <option value="luxury_premium">Luxury / Premium Elite (Elegan & Mewah)</option>
                                <option value="poetic_aesthetic">Poetic / Puitis & Estetik (Indah)</option>
                                <option value="news_anchor">News Anchor / Reporter Berita (Fakta & Lugas)</option>
                                <option value="motivator_inspirational">Motivator / Semangat Inspiratif (Powerfully Inspiring)</option>
                                <option value="review_honest">Honest Reviewer / Ulasan Jujur (Autentik)</option>
                                <option value="cinematic_trailer">Movie Trailer / Hollywood Box-Office (Epik)</option>
                                <option value="sarcastic_witty">Sarcastic / Witty & Sindiran Halus (Cerdas)</option>
                                <option value="kids_playful">Kids & Playful / Dunia Anak (Ceria & Riang)</option>
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

                    {/* MERGED VIDEO SECTION */}
                    {selectedStoryboard && images.length > 1 && (() => {
                      const hasVideosForEveryPage = (() => {
                        for (let i = 0; i < images.length; i++) {
                          const hasSuccess = videos.some(v => v.scene_idx === i && v.status === 'success');
                          if (!hasSuccess) return false;
                        }
                        return true;
                      })();

                      const mergedHistory = (() => {
                        let list = [];
                        if (selectedStoryboard.merged_video_history) {
                          try { list = JSON.parse(selectedStoryboard.merged_video_history); } catch (e) { list = []; }
                        }
                        if (!Array.isArray(list) || list.length === 0) {
                          if (selectedStoryboard.merged_video_url) {
                            list = [selectedStoryboard.merged_video_url];
                          }
                        }
                        return list;
                      })();

                      const safeMergedIdx = Math.min(activeMergedIdx, Math.max(0, mergedHistory.length - 1));
                      const activeMergedUrl = mergedHistory[safeMergedIdx] || selectedStoryboard.merged_video_url;

                      return (
                        <div className="bg-[#131211]/50 border border-[#cfae80]/20 rounded-2xl p-4 animate-fadeIn">
                          <div className="flex items-center justify-between border-b border-[#2a2725]/30 pb-2 mb-2">
                            <span className="text-[9px] font-bold text-[#cfae80] uppercase tracking-widest flex items-center gap-1.5">
                              🎬 Video Gabungan ({images.length} Part)
                            </span>
                            {mergedHistory.length > 1 && (
                              <div className="flex items-center gap-1 bg-[#1a1918] border border-[#2a2725] px-2 py-0.5 rounded-full">
                                <button
                                  type="button"
                                  disabled={safeMergedIdx === 0}
                                  onClick={() => setActiveMergedIdx(prev => Math.max(0, prev - 1))}
                                  className="text-[#cfae80] hover:text-white disabled:opacity-30 transition-all p-0.5 cursor-pointer"
                                  title="Versi Sebelumnya"
                                >
                                  <ChevronLeft className="w-3.5 h-3.5" />
                                </button>
                                <span className="text-[8px] font-bold text-slate-300 uppercase tracking-wider px-1">
                                  {safeMergedIdx + 1}/{mergedHistory.length}
                                </span>
                                <button
                                  type="button"
                                  disabled={safeMergedIdx === mergedHistory.length - 1}
                                  onClick={() => setActiveMergedIdx(prev => Math.min(mergedHistory.length - 1, prev + 1))}
                                  className="text-[#cfae80] hover:text-white disabled:opacity-30 transition-all p-0.5 cursor-pointer"
                                  title="Versi Berikutnya"
                                >
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                          
                          {activeMergedUrl ? (
                            <div className="space-y-3">
                              <video 
                                key={activeMergedUrl}
                                src={getFullImageUrl(activeMergedUrl)} 
                                controls 
                                playsInline
                                preload="metadata"
                                className="w-full rounded-xl border border-[#2a2725] bg-black max-h-40"
                              />
                              <div className="grid grid-cols-2 gap-2">
                                <a
                                  href={getDownloadUrl(activeMergedUrl)}
                                  onClick={(e) => handleDownloadClick(e, activeMergedUrl, `storyboard-${selectedStoryboard.id}-v${safeMergedIdx + 1}-full.mp4`)}
                                  download={`storyboard-${selectedStoryboard.id}-v${safeMergedIdx + 1}-full.mp4`}
                                  className="w-full bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-2 px-2 rounded-lg text-[8px] uppercase tracking-wider flex items-center justify-center gap-1 transition-all text-center cursor-pointer"
                                >
                                  <Download className="w-3.5 h-3.5" /> Unduh Full
                                </a>
                                <button
                                  onClick={handleMergeVideos}
                                  disabled={mergingVideos || !hasVideosForEveryPage}
                                  className="w-full bg-[#131211] hover:bg-[#1a1918] text-slate-350 font-bold py-2 px-2 rounded-lg border border-[#2a2725]/60 text-[8px] uppercase tracking-wider flex items-center justify-center gap-1 transition-all text-center cursor-pointer disabled:opacity-50"
                                >
                                  {mergingVideos ? <Loader className="animate-spin w-3 h-3" /> : '🔄 Gabung Ulang'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2.5">
                              <p className="text-[8.5px] text-slate-400 leading-normal">
                                {hasVideosForEveryPage 
                                  ? "Semua part video sudah berhasil dibuat! Klik tombol di bawah untuk menggabungkannya menjadi satu video utuh."
                                  : "Buat/selesaikan video untuk semua part storyboard terlebih dahulu agar dapat digabungkan."
                                }
                              </p>
                              <button
                                onClick={handleMergeVideos}
                                disabled={mergingVideos || !hasVideosForEveryPage}
                                className="w-full bg-[#cfae80]/15 hover:bg-[#cfae80]/25 text-[#cfae80] border border-[#cfae80]/30 disabled:opacity-40 font-bold py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 text-[8.5px] uppercase tracking-wider transition-all"
                              >
                                {mergingVideos ? (
                                  <>
                                    <Loader className="animate-spin w-3.5 h-3.5" />
                                    Menggabungkan...
                                  </>
                                ) : (
                                  <>
                                    <span>🎬 Gabungkan Semua Video</span>
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()}

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
                        <div
                          className="space-y-3 bg-[#131211]/50 border border-emerald-500/20 rounded-2xl p-4 animate-fadeIn"
                          {...onSwipe(
                            () => { if (activeIdx < sceneVideos.length - 1) { const n = activeIdx + 1; setActiveVideoIdx(n); setSelectedVideoIds(prev => ({ ...prev, [modalCarouselIdx]: sceneVideos[n].id })); } },
                            () => { if (activeIdx > 0) { const n = activeIdx - 1; setActiveVideoIdx(n); setSelectedVideoIds(prev => ({ ...prev, [modalCarouselIdx]: sceneVideos[n].id })); } }
                          )}
                        >
                          {/* Navigation header for multiple videos */}
                          {sceneVideos.length > 1 && (
                            <div className="flex justify-between items-center bg-black/40 border border-[#2a2725] px-2.5 py-1.5 rounded-xl text-[9px] mb-1">
                              <span className="text-[#cfae80] font-bold uppercase tracking-wider">
                                🎥 Video {sceneVideos.length - activeIdx} / {sceneVideos.length}
                              </span>
                              <div className="flex gap-1">
                                <button
                                  disabled={activeIdx === sceneVideos.length - 1}
                                  onClick={() => {
                                    const newIdx = activeIdx + 1;
                                    setActiveVideoIdx(newIdx);
                                    setSelectedVideoIds(prev => ({ ...prev, [modalCarouselIdx]: sceneVideos[newIdx].id }));
                                  }}
                                  className="px-1.5 py-0.5 bg-[#131211] text-slate-300 disabled:opacity-30 rounded border border-[#2a2725] hover:bg-[#1a1918] text-[8px] font-bold"
                                >
                                  ◀ LAMA
                                </button>
                                <button
                                  disabled={activeIdx === 0}
                                  onClick={() => {
                                    const newIdx = activeIdx - 1;
                                    setActiveVideoIdx(newIdx);
                                    setSelectedVideoIds(prev => ({ ...prev, [modalCarouselIdx]: sceneVideos[newIdx].id }));
                                  }}
                                  className="px-1.5 py-0.5 bg-[#131211] text-slate-300 disabled:opacity-30 rounded border border-[#2a2725] hover:bg-[#1a1918] text-[8px] font-bold"
                                >
                                  BARU ▶
                                </button>
                              </div>
                            </div>
                          )}

                          <div className="flex justify-between items-center pb-1">
                            <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1">
                              ✓ Berhasil ({activeVid.model})
                              {selectedVideoIds[modalCarouselIdx] === activeVid.id && (
                                <span className="ml-1 bg-amber-500/20 text-amber-405 text-[7px] font-extrabold px-1.5 py-0.5 rounded border border-amber-500/35 uppercase tracking-wide">
                                  ✓ Pilihan Gabung
                                </span>
                              )}
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
                            onTouchStart={(e) => e.stopPropagation()}
                            onTouchEnd={(e) => e.stopPropagation()}
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

                        {/* Metode Pembuatan FIRST — the model list below auto-filters to models that support it */}
                        <div className="space-y-1">
                          <label className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80]">Metode Pembuatan</label>
                          <select
                            value={videoGenType}
                            onChange={(e) => {
                              const newType = e.target.value;
                              setVideoGenType(newType);
                              setVideoStudioPrompt((newType === 'text' ? textToVideoPrompt : imageToVideoPrompt) || '');
                              // Auto-switch to a model that supports this method if the current one doesn't.
                              const cur = VIDEO_MODELS.find(x => x.value === videoModel);
                              if (!cur || !(cur.genTypes || []).includes(newType)) {
                                const first = VIDEO_MODELS.find(x => (x.genTypes || []).includes(newType));
                                if (first) {
                                  setVideoModel(first.value);
                                  setVideoDuration(String(first.durations[0]));
                                  setVideoResolution(first.resolutions[0]);
                                }
                              }
                            }}
                            className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[10px] focus:outline-none focus:border-[#cfae80] transition-all font-semibold"
                          >
                            {[
                              { v: 'image', l: 'Image-to-Video (I2V - Gunakan Gambar Panel)' },
                              { v: 'text', l: 'Text-to-Video (T2V - Hanya Prompt Teks)' },
                              { v: 'transition', l: 'Transition-to-Video (Transisi Gambar)' },
                              { v: 'reference', l: 'Reference-to-Video (Referensi Karakter/Produk)' },
                            ].map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                          </select>
                        </div>

                        {/* Model — only those supporting the chosen method */}
                        <div className="space-y-1">
                          <label className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80]">Pilih Model Video (mendukung metode ini)</label>
                          <select
                            value={videoModel}
                            onChange={(e) => {
                              setVideoModel(e.target.value);
                              const m = VIDEO_MODELS.find(x => x.value === e.target.value);
                              if (m) {
                                setVideoDuration(String(m.durations[0]));
                                setVideoResolution(m.resolutions[0]);
                              }
                            }}
                            className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[10px] focus:outline-none focus:border-[#cfae80] transition-all font-semibold"
                          >
                            {VIDEO_MODELS.filter(m => (m.genTypes || []).includes(videoGenType)).map(m => (
                              <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
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

                        <label className="flex items-center gap-2 cursor-pointer select-none border-t border-[#2a2725]/40 pt-2 pb-1">
                          <input
                            type="checkbox"
                            checked={videoGenerateAudio}
                            onChange={(e) => setVideoGenerateAudio(e.target.checked)}
                            className="rounded border-[#2a2725] bg-black text-[#cfae80] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                          />
                          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-350">
                            Hasilkan Audio / Sound Effect (Voiceover)
                          </span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer select-none pb-1">
                          <input
                            type="checkbox"
                            checked={videoBacksound}
                            onChange={(e) => setVideoBacksound(e.target.checked)}
                            className="rounded border-[#2a2725] bg-black text-[#cfae80] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                          />
                          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-350">
                            Backsound / Musik Latar
                          </span>
                        </label>
                        {!videoBacksound && (
                          <p className="text-[8px] text-slate-500 -mt-1 pl-6">Tanpa musik latar — hanya suara natural/ASMR/SFX.</p>
                        )}

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

                {/* AI Copywriting / Marketing Info (Global) */}
                {(() => {
                  const activeScenePromptObj = selectedStoryboard && selectedStoryboard.video_prompts
                    ? (() => {
                        try {
                          const parsed = JSON.parse(selectedStoryboard.video_prompts);
                          return Array.isArray(parsed) ? parsed[modalCarouselIdx] : null;
                        } catch (e) {
                          return null;
                        }
                      })()
                    : null;

                  const sceneVideosList = videos
                    .filter(v => v.scene_idx === modalCarouselIdx)
                    .sort((a, b) => b.id - a.id);
                  const activeVideo = sceneVideosList[0];

                  const displayMarketingTitle = activeVideo?.marketing_title || activeScenePromptObj?.marketing_title;
                  const displayMarketingDesc = activeVideo?.marketing_description || activeScenePromptObj?.marketing_description;

                  return (
                    <div className="bg-[#181716] border border-[#2a2725]/80 rounded-xl p-3 space-y-3 mt-4 text-left shrink-0">
                      <h4 className="text-[9px] font-bold text-[#cfae80] uppercase tracking-widest flex items-center gap-1.5 border-b border-[#2a2725]/45 pb-1">
                        📢 AI Marketing Copy
                      </h4>

                      {displayMarketingTitle || displayMarketingDesc ? (
                        <div className="space-y-2.5 animate-fadeIn">
                          {/* Title display */}
                          <div className="space-y-1">
                            <div className="flex justify-between items-center text-[7px] font-bold text-slate-400 uppercase tracking-widest">
                              <span>Judul (Max 100 Karakter)</span>
                              <button 
                                onClick={() => {
                                  navigator.clipboard.writeText(displayMarketingTitle);
                                  alert('Judul berhasil disalin!');
                                }}
                                className="text-[#cfae80] hover:underline cursor-pointer"
                              >
                                Salin
                              </button>
                            </div>
                            <div className="bg-black/40 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[10px] font-semibold break-words leading-relaxed font-sans">
                              {displayMarketingTitle}
                            </div>
                          </div>

                          {/* Description & Hashtags display */}
                          <div className="space-y-1">
                            <div className="flex justify-between items-center text-[7px] font-bold text-slate-400 uppercase tracking-widest">
                              <span>Deskripsi & Hashtag</span>
                              <button 
                                onClick={() => {
                                  navigator.clipboard.writeText(displayMarketingDesc);
                                  alert('Deskripsi & Hashtag berhasil disalin!');
                                }}
                                className="text-[#cfae80] hover:underline cursor-pointer"
                              >
                                Salin
                              </button>
                            </div>
                            <div className="bg-black/40 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-slate-300 text-[9.5px] leading-relaxed break-words whitespace-pre-line font-sans max-h-32 overflow-y-auto scrollbar-thin">
                              {displayMarketingDesc}
                            </div>
                          </div>

                          {/* Option to regenerate */}
                          <div className="pt-1.5 flex justify-end">
                            <button
                              onClick={async () => {
                                if (activeVideo) {
                                  await handleRegenerateMarketingCopy(activeVideo.id);
                                } else {
                                  await handleRegenerateStoryboardMarketingCopy();
                                }
                              }}
                              disabled={regeneratingCopyId || generatingStoryboardCopy}
                              className="bg-[#cfae80]/5 hover:bg-[#cfae80]/15 text-[#cfae80] border border-[#cfae80]/20 font-bold py-1 px-2 rounded text-[7.5px] uppercase tracking-wider flex items-center justify-center gap-1 transition-all disabled:opacity-50"
                            >
                              <Sparkles className="w-2.5 h-2.5" /> Buat Ulang
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-4 gap-2 text-center">
                          <span className="text-[9px] text-slate-500 italic">
                            {regeneratingCopyId || generatingStoryboardCopy
                              ? '⏳ Sedang menulis konten promosi...' 
                              : 'Belum ada konten promosi.'}
                          </span>
                          {!regeneratingCopyId && !generatingStoryboardCopy && (
                            <button
                              onClick={async () => {
                                if (activeVideo) {
                                  await handleRegenerateMarketingCopy(activeVideo.id);
                                } else {
                                  await handleRegenerateStoryboardMarketingCopy();
                                }
                              }}
                              className="bg-[#cfae80]/10 hover:bg-[#cfae80]/20 text-[#cfae80] border border-[#cfae80]/20 font-bold py-1.5 px-2.5 rounded-lg text-[8px] uppercase tracking-wider flex items-center justify-center gap-1 transition-all cursor-pointer"
                            >
                              <Sparkles className="w-3 h-3 text-[#cfae80]" /> Buat Konten Promosi
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

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

      {showMergeModal && selectedStoryboard && createPortal(
        <div 
          className="fixed inset-0 bg-black/90 md:bg-black/85 md:backdrop-blur-sm flex items-center justify-center p-4 z-[60] select-text animate-fadeIn"
          onClick={() => setShowMergeModal(false)}
        >
          <div 
            className="relative w-full max-w-md bg-[#1a1918] border border-[#2a2725] rounded-3xl overflow-hidden shadow-2xl p-6 space-y-5 animate-scaleUp"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top gold line decoration */}
            <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/40 to-transparent"></div>

            {/* Header */}
            <div className="flex justify-between items-center pb-2 border-b border-[#2a2725]/60">
              <h3 className="text-xs font-bold uppercase tracking-widest text-[#cfae80] flex items-center gap-1.5">
                🎬 Penggabungan Video Premium
              </h3>
              <button 
                onClick={() => setShowMergeModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-full border border-white/5 bg-black/40 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Content: Video Selection per page */}
            <div className="space-y-4 max-h-60 overflow-y-auto scrollbar-thin pr-1">
              <span className="text-[9px] font-bold uppercase tracking-widest text-[#cfae80] block">1. Pilih Versi Video per Halaman</span>
              
              {(() => {
                let pagesList = [];
                try {
                  const parsed = JSON.parse(selectedStoryboard.image_path);
                  pagesList = Array.isArray(parsed) ? parsed : [selectedStoryboard.image_path];
                } catch (e) {
                  if (selectedStoryboard.image_path && selectedStoryboard.image_path.includes(',')) {
                    pagesList = selectedStoryboard.image_path.split(',').map(s => s.trim());
                  } else if (selectedStoryboard.image_path) {
                    pagesList = [selectedStoryboard.image_path];
                  }
                }

                return mergeSequence.map((pageIdx, idx) => {
                  const sceneVids = videos.filter(v => v.scene_idx === pageIdx && v.status === 'success');
                  
                  return (
                    <div key={pageIdx} className="space-y-1 bg-[#131211]/50 border border-[#2a2725]/45 rounded-xl p-3 flex flex-col">
                      <div className="flex justify-between items-center pb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] font-extrabold text-black bg-[#cfae80] rounded-full w-4 h-4 flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <label className="text-[8.5px] font-bold uppercase tracking-wide text-slate-350">
                            Halaman {pageIdx + 1}
                          </label>
                        </div>
                        
                        {/* Reorder Buttons */}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveSequenceItem(idx, 'up')}
                            className="px-1.5 py-0.5 text-[8px] bg-black/40 hover:bg-[#cfae80] hover:text-black text-slate-400 disabled:opacity-20 rounded border border-[#2a2725] transition-all cursor-pointer font-bold"
                          >
                            ▲ UP
                          </button>
                          <button
                            type="button"
                            disabled={idx === mergeSequence.length - 1}
                            onClick={() => moveSequenceItem(idx, 'down')}
                            className="px-1.5 py-0.5 text-[8px] bg-black/40 hover:bg-[#cfae80] hover:text-black text-slate-400 disabled:opacity-20 rounded border border-[#2a2725] transition-all cursor-pointer font-bold"
                          >
                            ▼ DOWN
                          </button>
                        </div>
                      </div>
                      
                      {sceneVids.length === 0 ? (
                        <p className="text-[8px] text-red-400 font-bold text-left">Belum ada video sukses untuk halaman ini</p>
                      ) : (
                        <select
                          value={selectedVideoIds[pageIdx] || ''}
                          onChange={(e) => setSelectedVideoIds(prev => ({ ...prev, [pageIdx]: parseInt(e.target.value) }))}
                          className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[9.5px] focus:outline-none focus:border-[#cfae80] transition-all font-semibold"
                        >
                          {sceneVids.map(v => (
                            <option key={v.id} value={v.id}>
                              Video ID {v.id} ({v.model} - {new Date(v.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })})
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                });
              })()}
            </div>

            {/* Content: Transitions */}
            <div className="space-y-3 pt-3 border-t border-[#2a2725]/40 text-left">
              <span className="text-[9px] font-bold uppercase tracking-widest text-[#cfae80] block">2. Pengaturan Transisi</span>
              
              <div className="space-y-1">
                <label className="text-[8.5px] font-bold uppercase tracking-wide text-slate-350">Efek Transisi Video</label>
                <select
                  value={mergeTransitionType}
                  onChange={(e) => setMergeTransitionType(e.target.value)}
                  className="w-full bg-black/40 border border-[#2a2725] rounded-lg px-2.5 py-1.5 text-white text-[10px] focus:outline-none focus:border-[#cfae80] transition-all font-semibold"
                >
                  <option value="none">Cut Langsung (Tanpa Transisi - Instan)</option>
                  <option value="fade">Crossfade (Fade Halus - 1.0s)</option>
                  <option value="slideleft">Slide Left (Geser Kiri - 1.0s)</option>
                  <option value="wipeleft">Wipe Left (Sapu Kiri - 1.0s)</option>
                  <option value="circleopen">Circle Open (Membulat - 1.0s)</option>
                </select>
              </div>

              {mergeTransitionType !== 'none' && (
                <label className="flex items-center gap-2 cursor-pointer select-none pt-1 animate-fadeIn">
                  <input 
                    type="checkbox" 
                    checked={mergeAudioBlend} 
                    onChange={(e) => setMergeAudioBlend(e.target.checked)} 
                    className="rounded border-[#2a2725] bg-black text-[#cfae80] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                  />
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-300">Seamless Audio Blend (Crossfade Suara)</span>
                </label>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowMergeModal(false)}
                className="w-1/2 bg-[#131211] hover:bg-[#1f1d1b] text-slate-300 font-bold py-2.5 px-4 rounded-xl border border-[#2a2725]/60 text-[9px] uppercase tracking-wider transition-all text-center"
              >
                Batal
              </button>
              <button
                onClick={confirmMergeVideos}
                className="w-1/2 bg-[#cfae80] hover:bg-[#c5a880] text-black font-extrabold py-2.5 px-4 rounded-xl text-[9px] uppercase tracking-wider transition-all text-center flex items-center justify-center gap-1.5 shadow-lg shadow-[#cfae80]/5"
              >
                🎬 Mulai Gabungkan
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Google Sheets Export Success Modal */}
      {exportSuccessModal && createPortal(
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#1a1918] border border-[#2a2725] rounded-3xl p-6 max-w-md w-full text-center space-y-4 shadow-2xl relative">
            <div className="w-12 h-12 bg-[#cfae80]/15 text-[#cfae80] rounded-full flex items-center justify-center mx-auto border border-[#cfae80]/30">
              <Sparkles className="w-6 h-6" />
            </div>
            
            <div>
              <h3 className="text-lg font-editorial italic text-white">Export Google Sheets Berhasil!</h3>
              <p className="text-slate-400 text-xs mt-1">
                {exportSuccessModal.message}
              </p>
            </div>

            <div className="bg-[#131211] border border-[#2a2725] p-3 rounded-2xl text-[11px] font-mono text-[#cfae80] break-all select-all text-left">
              {exportSuccessModal.url}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setExportSuccessModal(null)}
                className="flex-1 bg-[#131211] hover:bg-[#1f1d1b] text-slate-300 font-bold py-2.5 px-4 rounded-xl border border-[#2a2725] text-xs uppercase tracking-wider transition-all"
              >
                Tutup
              </button>
              <a
                href={exportSuccessModal.url}
                target="_blank"
                rel="noreferrer"
                onClick={() => setExportSuccessModal(null)}
                className="flex-1 bg-[#cfae80] hover:bg-[#c5a880] text-black font-extrabold py-2.5 px-4 rounded-xl text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-lg"
              >
                <ExternalLink className="w-4 h-4" /> Buka Sheet
              </a>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
