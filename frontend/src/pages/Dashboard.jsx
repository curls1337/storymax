import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { Plus, Trash2, ExternalLink, Calendar, Loader, FolderOpen, X, ChevronRight, Download, Eye } from 'lucide-react';

export default function Dashboard({ setTab }) {
  const [storyboards, setStoryboards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedStoryboard, setSelectedStoryboard] = useState(null);
  const [modalCarouselIdx, setModalCarouselIdx] = useState(0);

  const fetchStoryboards = async () => {
    try {
      const res = await api.get('/storyboards');
      setStoryboards(res.data);
    } catch (err) {
      setError('Gagal memuat riwayat storyboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStoryboards();
  }, []);

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

  const [videoPromptGenerating, setVideoPromptGenerating] = useState(false);
  const [videoPromptError, setVideoPromptError] = useState('');

  const handleGenerateVideoPrompts = async () => {
    if (!selectedStoryboard) return;
    setVideoPromptGenerating(true);
    setVideoPromptError('');
    try {
      const res = await api.post('/ai/video-prompts', { storyboardId: selectedStoryboard.id });
      const videoPromptsStr = JSON.stringify(res.data.videoPrompts);
      
      // Update selected storyboard in state
      const updatedSb = { ...selectedStoryboard, video_prompts: videoPromptsStr };
      setSelectedStoryboard(updatedSb);
      
      // Update storyboards list in state
      setStoryboards(prev => prev.map(sb => sb.id === selectedStoryboard.id ? updatedSb : sb));
    } catch (err) {
      setVideoPromptError(err.response?.data?.message || 'Gagal membuat prompt video.');
    } finally {
      setVideoPromptGenerating(false);
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
    const API_BASE = window.location.port === '5033' ? 'http://localhost:5022' : '';
    return `${API_BASE}${parsedPath}`;
  };

  const getSpecificImageUrl = (path) => {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    const API_BASE = window.location.port === '5033' ? 'http://localhost:5022' : '';
    return `${API_BASE}${path}`;
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
    <div className="p-8 space-y-10 animate-fadeIn font-sans relative">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-[#2a2725] pb-6">
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
          Mulai Proyek Baru
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
        <div className="space-y-6">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#cfae80]">Semua Riwayat Storyboard</h3>
          
          {/* COMPACT CARD GRID */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
            {storyboards.map((sb) => (
              <div
                key={sb.id}
                onClick={() => {
                  setSelectedStoryboard(sb);
                  setModalCarouselIdx(0);
                }}
                className="bg-[#1a1918]/60 border border-[#2a2725] rounded-2xl overflow-hidden hover:border-[#cfae80]/40 transition-all duration-300 group flex flex-col relative cursor-pointer"
              >
                {/* Thumbnail Container (4:3 ratio) */}
                <div className="aspect-[4/3] bg-black/40 relative overflow-hidden flex items-center justify-center border-b border-[#2a2725]">
                  <img
                    src={getFullImageUrl(sb.image_path)}
                    alt={sb.title}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                  
                  {/* Subtle hover icon overlay */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                    <div className="p-2.5 bg-[#cfae80] text-black rounded-full shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-transform duration-350">
                      <Eye className="w-4 h-4" />
                    </div>
                  </div>
                </div>

                {/* Card Info (Very Compact) */}
                <div className="p-3.5 flex flex-col justify-between flex-grow">
                  <h4 className="font-editorial italic text-white text-sm truncate group-hover:text-[#cfae80] transition-colors">{sb.title}</h4>
                  <div className="flex items-center justify-between text-[9px] text-slate-500 mt-2 pt-2 border-t border-[#2a2725]/60">
                    <span>
                      {new Date(sb.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                    </span>
                    <span className="font-bold text-[#cfae80]">
                      {getPageCount(sb.image_path) > 1 
                        ? `${getPageCount(sb.image_path)}p` 
                        : '15s'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* POPUP DETAIL MODAL */}
      {selectedStoryboard && (() => {
        const images = getResultImages(selectedStoryboard);
        const activeImg = images[modalCarouselIdx] || '';
        return (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fadeIn select-text">
            <div className="relative max-w-4xl w-full bg-[#1a1918] border border-[#2a2725] rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row max-h-[90vh]">
              {/* Top accent gold line */}
              <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/40 to-transparent"></div>
              
              {/* Close Button */}
              <button 
                onClick={() => setSelectedStoryboard(null)} 
                className="absolute top-4 right-4 z-20 text-slate-400 hover:text-white bg-black/50 p-1.5 rounded-full border border-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Left Side: Large Image Carousel */}
              <div className="md:w-3/5 bg-black/80 flex items-center justify-center relative min-h-[300px] md:min-h-0 border-b md:border-b-0 md:border-r border-[#2a2725]">
                <img
                  src={getSpecificImageUrl(activeImg)}
                  alt={selectedStoryboard.title}
                  className="w-full h-full object-contain max-h-[50vh] md:max-h-[80vh]"
                />
                
                {/* Carousel Navigation */}
                {images.length > 1 && (
                  <>
                    <button 
                      type="button" 
                      onClick={() => setModalCarouselIdx(prev => (prev > 0 ? prev - 1 : images.length - 1))} 
                      className="absolute left-4 p-2 bg-black/70 hover:bg-[#cfae80] hover:text-black text-white rounded-full transition-all border border-white/10"
                    >
                      <ChevronRight className="rotate-180 w-4 h-4" />
                    </button>
                    <button 
                      type="button" 
                      onClick={() => setModalCarouselIdx(prev => (prev < images.length - 1 ? prev + 1 : 0))} 
                      className="absolute right-4 p-2 bg-black/70 hover:bg-[#cfae80] hover:text-black text-white rounded-full transition-all border border-white/10"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    
                    {/* Page Index indicator */}
                    <div className="absolute bottom-4 bg-black/70 px-3 py-1 rounded-full text-[9px] font-bold tracking-widest uppercase border border-white/10 text-slate-300">
                      Panel {modalCarouselIdx + 1} dari {images.length}
                    </div>
                  </>
                )}
              </div>

              {/* Right Side: Editorial Metadata */}
              <div className="md:w-2/5 p-8 flex flex-col justify-between overflow-y-auto max-h-[40vh] md:max-h-full">
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-[#cfae80]" />
                      {new Date(selectedStoryboard.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                    <span className="px-2.5 py-0.5 rounded bg-[#cfae80]/15 text-[#cfae80] text-[8px] font-bold tracking-widest uppercase border border-[#cfae80]/20">
                      {getPageCount(selectedStoryboard.image_path) > 1 
                        ? `${getPageCount(selectedStoryboard.image_path)} Panel (${getPageCount(selectedStoryboard.image_path) * 15}s)` 
                        : '15 Detik'}
                    </span>
                  </div>

                  <h2 className="text-2xl font-editorial italic text-white tracking-tight leading-snug">
                    {selectedStoryboard.title}
                  </h2>

                  <div className="space-y-1.5">
                    <span className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80]">Ide Deskripsi Utama</span>
                    <div className="bg-[#131211]/50 border border-[#2a2725] rounded-xl p-3.5 text-slate-400 text-xs leading-relaxed max-h-48 overflow-y-auto scrollbar-thin">
                      {selectedStoryboard.prompt}
                    </div>
                  </div>

                  {/* Video Prompt Generator UI */}
                  <div className="space-y-2 mt-4 pt-4 border-t border-[#2a2725]/60">
                    <div className="flex justify-between items-center">
                      <span className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80]">
                        Prompt Video AI (Panel {modalCarouselIdx + 1})
                      </span>
                      {selectedStoryboard.video_prompts && (
                        <button
                          onClick={handleGenerateVideoPrompts}
                          disabled={videoPromptGenerating}
                          className="text-[8px] text-slate-400 hover:text-[#cfae80] font-bold uppercase tracking-widest transition-colors disabled:opacity-50"
                        >
                          {videoPromptGenerating ? 'Memproses...' : 'Tulis Ulang'}
                        </button>
                      )}
                    </div>

                    {!selectedStoryboard.video_prompts ? (
                      <button
                        onClick={handleGenerateVideoPrompts}
                        disabled={videoPromptGenerating}
                        className="w-full bg-[#cfae80]/10 hover:bg-[#cfae80]/20 text-[#cfae80] border border-[#cfae80]/30 font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 text-[9px] uppercase tracking-widest transition-all disabled:opacity-50"
                      >
                        {videoPromptGenerating ? (
                          <>
                            <Loader className="animate-spin w-3.5 h-3.5" />
                            Membuat Prompt Video...
                          </>
                        ) : (
                          <>
                            📝 Buat Prompt Video (AI)
                          </>
                        )}
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <div className="bg-[#131211]/50 border border-[#2a2725] rounded-xl p-3.5 text-slate-350 text-[11px] leading-relaxed relative max-h-36 overflow-y-auto scrollbar-thin">
                          {(() => {
                            try {
                              const prompts = JSON.parse(selectedStoryboard.video_prompts);
                              const activePrompt = prompts.find(p => p.scene === (modalCarouselIdx + 1))?.prompt || prompts[modalCarouselIdx]?.prompt;
                              return activePrompt || 'Prompt tidak ditemukan untuk adegan ini.';
                            } catch (e) {
                              return 'Format prompt salah atau rusak.';
                            }
                          })()}
                        </div>
                        <button
                          onClick={() => {
                            try {
                              const prompts = JSON.parse(selectedStoryboard.video_prompts);
                              const activePrompt = prompts.find(p => p.scene === (modalCarouselIdx + 1))?.prompt || prompts[modalCarouselIdx]?.prompt;
                              if (activePrompt) {
                                navigator.clipboard.writeText(activePrompt);
                                alert('Prompt video berhasil disalin ke clipboard!');
                              }
                            } catch (e) {
                              alert('Gagal menyalin prompt.');
                            }
                          }}
                          className="w-full bg-[#131211] hover:bg-[#1a1918] text-slate-300 font-bold py-2.5 px-4 rounded-xl border border-[#2a2725] text-[9px] uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all"
                        >
                          Salin Prompt Panel {modalCarouselIdx + 1}
                        </button>
                      </div>
                    )}

                    {videoPromptError && (
                      <p className="text-[9px] text-red-450 font-semibold mt-1">{videoPromptError}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-3 mt-6 pt-5 border-t border-[#2a2725]">
                  <div className="flex gap-2">
                    <a
                      href={getSpecificImageUrl(activeImg)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 bg-[#131211] hover:bg-[#1a1918] text-slate-200 font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-1.5 border border-[#2a2725] text-[10px] uppercase tracking-widest"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-[#cfae80]" />
                      Full-Res
                    </a>
                    <a
                      href={getSpecificImageUrl(activeImg)}
                      download
                      className="flex-1 bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-widest"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Unduh
                    </a>
                  </div>
                  
                  <button
                    onClick={() => handleDelete(selectedStoryboard.id)}
                    className="w-full border border-red-500/25 bg-red-950/10 hover:bg-red-650 hover:text-white text-red-400 font-bold py-2.5 px-4 rounded-xl text-[9px] uppercase tracking-widest flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Hapus Storyboard
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
