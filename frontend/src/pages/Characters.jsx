import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import api from '../utils/api';
import { 
  Sparkles, Plus, Search, Trash2, Edit3, Eye, Download, UserCheck, 
  X, Loader, Palette, Layers, Film, Tag, Check, RefreshCw, Upload, Image as ImageIcon,
  Copy, History, ArrowUpDown, AlertTriangle
} from 'lucide-react';
import { toast } from '../utils/toast';
import { confirm } from '../utils/confirm';
import CHARACTER_PRESETS from '../constants/characterPresets';

// Quick-pick dropdown: lets the user choose a ready-made preset that instantly
// fills the paired text field below, so manual entry no longer has to start
// from a blank page. The select always resets back to its placeholder after a
// pick so it can be used again, and the text field underneath stays fully
// editable in case the user wants to tweak the chosen preset.
function PresetPicker({ presets, onPick, placeholder }) {
  if (!presets || presets.length === 0) return null;
  return (
    <select
      value=""
      onChange={(e) => {
        const val = e.target.value;
        if (val) onPick(val);
      }}
      className="w-full bg-[#1a1918] border border-[#2a2725] rounded-xl px-3 py-2 text-[11px] text-[#cfae80] focus:outline-none focus:border-[#cfae80]/60 mb-1.5 font-semibold"
    >
      <option value="">{placeholder || '✨ Pilih dari pilihan siap pakai...'}</option>
      {presets.map((p, idx) => (
        <option key={idx} value={p.value}>{p.label}</option>
      ))}
    </select>
  );
}

export default function Characters({ setTab, onSelectCharacterForStoryboard }) {
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('created_desc');
  const [duplicatingId, setDuplicatingId] = useState(null);

  // Modals
  const [showAiModal, setShowAiModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [showSheetViewer, setShowSheetViewer] = useState(null); // Selected character for viewer
  const [editingCharacter, setEditingCharacter] = useState(null);

  // AI Modal State
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiRefImage, setAiRefImage] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiStep, setAiStep] = useState(''); // 'spec' | 'image'
  const [aiResultSpec, setAiResultSpec] = useState(null);
  const [aiSheetImageUrl, setAiSheetImageUrl] = useState('');
  const [aiRenderingImage, setAiRenderingImage] = useState(false);

  // Model & Provider Selector State
  const [selectedProvider, setSelectedProvider] = useState('freebeat');
  const [magicaCatalog, setMagicaCatalog] = useState(null);
  const [magicaModel, setMagicaModel] = useState('nano_fast');
  const [apiKeys, setApiKeys] = useState([]);
  const [apiKeyId, setApiKeyId] = useState('auto');
  const [magicaKeyId, setMagicaKeyId] = useState('auto');

  // Manual / Edit Form State
  const [formName, setFormName] = useState('');
  const [formTagline, setFormTagline] = useState('');
  const [formConcept, setFormConcept] = useState('');
  const [formVisualTone, setFormVisualTone] = useState('');
  const [formColorPalette, setFormColorPalette] = useState('#B22222, #FFC300, #F5F5F5, #8B4513, #28282B');
  const [formProfileNotes, setFormProfileNotes] = useState('');
  const [formTurnaroundNotes, setFormTurnaroundNotes] = useState('');
  const [formExpressions, setFormExpressions] = useState('01. Weary, 02. Ironic Smile, 03. Wide Laugh, 04. Suspicious, 05. Sad Clown');
  const [formWardrobe, setFormWardrobe] = useState('');
  const [formProductionNotes, setFormProductionNotes] = useState('');
  const [formTriggerPrompt, setFormTriggerPrompt] = useState('');
  const [formSheetImageUrl, setFormSheetImageUrl] = useState('');
  // Item 9: gender / skin tone (and "lainnya" captured via profile notes already).
  // Left empty = "Auto" (AI decides / infers from reference photo).
  const [formGender, setFormGender] = useState('');
  const [formSkinTone, setFormSkinTone] = useState('');
  // Item 8: per-character voice identity. All left empty = "Auto" (storyboard-level
  // tone/language is used as-is, unchanged behavior).
  const [formVoiceGender, setFormVoiceGender] = useState('');
  const [formVoiceTone, setFormVoiceTone] = useState('');
  const [formVoiceLanguage, setFormVoiceLanguage] = useState('');
  const [formVoiceNotes, setFormVoiceNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchCharacters = async () => {
    setLoading(true);
    try {
      const res = await api.get('/characters');
      setCharacters(res.data || []);
    } catch (err) {
      toast.error('Gagal memuat daftar karakter.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCharacters();
    api.get('/storyboards/keys').then(r => setApiKeys(r.data || [])).catch(() => {});
    api.get('/auth/me').then((r) => {
      const pp = r.data.preferred_provider || 'freebeat';
      setSelectedProvider(pp);
      api.get('/magica/catalog').then((c) => {
        setMagicaCatalog(c.data);
        const imgs = (c.data && c.data.imageModels) || [];
        const def = imgs.find((m) => m.nodeType === 'nano_fast') || imgs.find((m) => m.nodeType === 'gpt_image_2') || imgs[0];
        if (def) setMagicaModel(def.nodeType);
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  // Handle AI Character Spec Generation
  const handleGenerateAI = async () => {
    if (!aiPrompt.trim() && !aiRefImage) {
      toast.error('Masukkan deskripsi konsep atau gambar referensi.');
      return;
    }
    setAiGenerating(true);
    setAiStep('Menganalisis ide & menyusun Character Sheet dengan AI...');
    setAiResultSpec(null);
    setAiSheetImageUrl('');

    try {
      const res = await api.post('/characters/generate-ai', {
        prompt: aiPrompt,
        refImageUrl: aiRefImage.startsWith('http') ? aiRefImage : undefined,
        refImageBase64: aiRefImage.startsWith('data:') ? aiRefImage : undefined
      });

      if (res.data && res.data.characterSpec) {
        const spec = res.data.characterSpec;
        setAiResultSpec(spec);
        setAiStep('Profil karakter berhasil disusun! Sekarang merender lembar gambar...');
        
        // Auto-trigger sheet image generation
        handleRenderSheetImage(spec);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal menyusun karakter AI.');
      setAiGenerating(false);
    }
  };

  // Handle Sheet Image Render via Freebeat / Magica
  const handleRenderSheetImage = async (specToRender) => {
    const spec = specToRender || aiResultSpec;
    if (!spec) return;

    setAiRenderingImage(true);
    setAiStep('Merender Character Design Reference Sheet beresolusi tinggi...');
    try {
      const imagePrompt = spec.sheet_image_prompt || `Official character design reference sheet concept art presentation poster layout for ${spec.name}, featuring full multi-panel graphic composition layout: 1. Profile side view standing, 2. 360 degree turnaround view (front, 3/4 left, back, 3/4 right standing line-up), 3. Cinematic close up portrait, 4. Head study expressions grid with 5 emotions, 5. Wardrobe breakdown of clothing items, 6. Production notes & color palette swatches. Film production concept art sheet, 8k resolution masterwork, sleek studio dark background. Character details: ${spec.trigger_prompt || spec.concept || spec.name}`;
      const targetRefUrl = aiRefImage || (spec.reference_images && spec.reference_images[0]);
      const res = await api.post('/characters/generate-sheet-image', {
        prompt: imagePrompt,
        aspectRatio: '3:4',
        provider: selectedProvider,
        magicaModel: selectedProvider === 'magica' ? magicaModel : undefined,
        apiKeyId,
        magicaKeyId,
        refUrl: targetRefUrl
      });

      if (res.data && res.data.imageUrl) {
        setAiSheetImageUrl(res.data.imageUrl);
        toast.success('Lembar Karakter AI berhasil dirender!');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Sheet gambar gagal dirender. Periksa kunci API Anda.');
    } finally {
      setAiRenderingImage(false);
      setAiGenerating(false);
    }
  };

  // Render High-Res Poster Image for Existing Character
  const handleGenerateSheetForExistingCharacter = async (char) => {
    if (!char) return;
    setAiRenderingImage(true);
    toast.info(`Merender gambar Poster Character Reference Sheet untuk ${char.name}...`);
    try {
      const prompt = char.sheet_image_prompt || `Official character design reference sheet concept art presentation poster layout for ${char.name}, featuring full multi-panel graphic composition layout: 1. Profile side view standing, 2. 360 degree turnaround view (front, 3/4 left, back, 3/4 right standing line-up), 3. Cinematic close up portrait, 4. Head study expressions grid with 5 emotions, 5. Wardrobe breakdown of clothing items, 6. Production notes & color palette swatches. Film production concept art sheet, 8k resolution masterwork, sleek studio dark background. Character details: ${char.trigger_prompt || char.concept || char.name}`;
      const targetRefUrl = (char.reference_images && char.reference_images[0]) ? char.reference_images[0] : undefined;
      const res = await api.post('/characters/generate-sheet-image', {
        prompt,
        aspectRatio: '3:4',
        provider: selectedProvider,
        magicaModel: selectedProvider === 'magica' ? magicaModel : undefined,
        apiKeyId,
        magicaKeyId,
        refUrl: targetRefUrl
      });
      if (res.data && res.data.imageUrl) {
        await api.put(`/characters/${char.id}`, { sheet_image_url: res.data.imageUrl });
        toast.success('Gambar Reference Sheet Poster 8K berhasil dirender & disimpan!');
        setShowSheetViewer(prev => (prev && prev.id === char.id ? { ...prev, sheet_image_url: res.data.imageUrl } : prev));
        fetchCharacters();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal merender gambar reference sheet poster.');
    } finally {
      setAiRenderingImage(false);
    }
  };

  // Save AI Generated Character into Database
  const handleSaveAiCharacter = async () => {
    if (!aiResultSpec) return;
    setSaving(true);
    try {
      const refImgs = [];
      if (aiRefImage) refImgs.push(aiRefImage);
      if (aiSheetImageUrl && !refImgs.includes(aiSheetImageUrl)) refImgs.push(aiSheetImageUrl);

      const payload = {
        name: aiResultSpec.name || 'Karakter AI',
        tagline: aiResultSpec.tagline || '',
        concept: aiResultSpec.concept || '',
        visual_tone: aiResultSpec.visual_tone || '',
        color_palette: Array.isArray(aiResultSpec.color_palette) ? aiResultSpec.color_palette : ['#B22222', '#FFC300', '#F5F5F5'],
        profile_notes: aiResultSpec.profile_notes || '',
        turnaround_notes: aiResultSpec.turnaround_notes || '',
        expressions: Array.isArray(aiResultSpec.expressions) ? aiResultSpec.expressions : [aiResultSpec.expressions || ''],
        wardrobe: aiResultSpec.wardrobe || '',
        production_notes: aiResultSpec.production_notes || '',
        trigger_prompt: aiResultSpec.trigger_prompt || '',
        reference_images: refImgs,
        sheet_image_url: aiSheetImageUrl || '',
        // Item 9: gender / skin tone ("Auto" when the AI could not determine them).
        gender: aiResultSpec.gender || '',
        skin_tone: aiResultSpec.skin_tone || '',
        attributes_source: aiResultSpec.attributes_source || (aiRefImage ? 'ai_auto' : 'manual'),
        // Item 8: AI-suggested voice identity (all "Auto" if the AI left them blank).
        voice_gender: aiResultSpec.voice_gender || '',
        voice_tone: aiResultSpec.voice_tone || '',
        voice_language: aiResultSpec.voice_language || '',
        voice_notes: aiResultSpec.voice_notes || ''
      };

      await api.post('/characters', payload);
      toast.success(`Karakter "${payload.name}" berhasil disimpan!`);
      setShowAiModal(false);
      setAiPrompt('');
      setAiRefImage('');
      setAiResultSpec(null);
      setAiSheetImageUrl('');
      fetchCharacters();
    } catch (err) {
      toast.error('Gagal menyimpan karakter ke database.');
    } finally {
      setSaving(false);
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (char) => {
    setEditingCharacter(char);
    setFormName(char.name || '');
    setFormTagline(char.tagline || '');
    setFormConcept(char.concept || '');
    setFormVisualTone(char.visual_tone || '');
    setFormColorPalette(Array.isArray(char.color_palette) ? char.color_palette.join(', ') : (char.color_palette || ''));
    setFormProfileNotes(char.profile_notes || '');
    setFormTurnaroundNotes(char.turnaround_notes || '');
    setFormExpressions(Array.isArray(char.expressions) ? char.expressions.join(', ') : (char.expressions || ''));
    setFormWardrobe(char.wardrobe || '');
    setFormProductionNotes(char.production_notes || '');
    setFormTriggerPrompt(char.trigger_prompt || '');
    setFormSheetImageUrl(char.sheet_image_url || '');
    setFormGender(char.gender || '');
    setFormSkinTone(char.skin_tone || '');
    setFormVoiceGender(char.voice_gender || '');
    setFormVoiceTone(char.voice_tone || '');
    setFormVoiceLanguage(char.voice_language || '');
    setFormVoiceNotes(char.voice_notes || '');
    setShowManualModal(true);
  };

  // Reset form for Manual Create
  const handleOpenManualCreate = () => {
    setEditingCharacter(null);
    setFormName('');
    setFormTagline('');
    setFormConcept('');
    setFormVisualTone('');
    setFormColorPalette('#B22222, #FFC300, #F5F5F5, #8B4513, #28282B');
    setFormProfileNotes('');
    setFormTurnaroundNotes('');
    setFormExpressions('01. Weary, 02. Ironic Smile, 03. Wide Laugh, 04. Suspicious, 05. Sad Clown');
    setFormWardrobe('');
    setFormProductionNotes('');
    setFormTriggerPrompt('');
    setFormSheetImageUrl('');
    setFormGender('');
    setFormSkinTone('');
    setFormVoiceGender('');
    setFormVoiceTone('');
    setFormVoiceLanguage('');
    setFormVoiceNotes('');
    setShowManualModal(true);
  };

  // Submit Manual/Edit Character
  const handleSaveManual = async (e) => {
    e.preventDefault();
    if (!formName.trim()) {
      toast.error('Nama Karakter wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      const paletteArray = formColorPalette.split(',').map(s => s.trim()).filter(Boolean);
      const expressionsArray = formExpressions.split(',').map(s => s.trim()).filter(Boolean);

      const payload = {
        name: formName,
        tagline: formTagline,
        concept: formConcept,
        visual_tone: formVisualTone,
        color_palette: paletteArray,
        profile_notes: formProfileNotes,
        turnaround_notes: formTurnaroundNotes,
        expressions: expressionsArray,
        wardrobe: formWardrobe,
        production_notes: formProductionNotes,
        trigger_prompt: formTriggerPrompt,
        reference_images: formSheetImageUrl ? [formSheetImageUrl] : [],
        sheet_image_url: formSheetImageUrl,
        gender: formGender,
        skin_tone: formSkinTone,
        attributes_source: 'manual',
        voice_gender: formVoiceGender,
        voice_tone: formVoiceTone,
        voice_language: formVoiceLanguage,
        voice_notes: formVoiceNotes
      };

      if (editingCharacter) {
        await api.put(`/characters/${editingCharacter.id}`, payload);
        toast.success(`Karakter "${formName}" berhasil diperbarui.`);
      } else {
        await api.post('/characters', payload);
        toast.success(`Karakter "${formName}" berhasil dibuat.`);
      }

      setShowManualModal(false);
      fetchCharacters();
    } catch (err) {
      toast.error('Gagal menyimpan karakter.');
    } finally {
      setSaving(false);
    }
  };

  // Delete Character. Item 5: if the server reports the character is still used in
  // storyboards (HTTP 409), show a second confirmation naming the usage count and,
  // if approved, retry with force=1 to delete anyway (detaching those storyboards).
  const handleDelete = async (char) => {
    const isOk = await confirm({
      title: 'Hapus Karakter',
      message: `Apakah Anda yakin ingin menghapus karakter "${char.name}"? Action ini tidak dapat dibatalkan.`
    });
    if (!isOk) return;

    try {
      await api.delete(`/characters/${char.id}`);
      toast.success(`Karakter "${char.name}" telah dihapus.`);
      fetchCharacters();
    } catch (err) {
      if (err.response?.status === 409) {
        const usageCount = err.response?.data?.usageCount || 0;
        const forceOk = await confirm({
          title: 'Karakter Masih Dipakai',
          message: `Karakter "${char.name}" masih dipakai di ${usageCount} storyboard. Storyboard tersebut TIDAK akan dihapus, hanya tautan karakternya yang akan dilepas. Tetap hapus karakter ini?`
        });
        if (!forceOk) return;
        try {
          await api.delete(`/characters/${char.id}?force=1`);
          toast.success(`Karakter "${char.name}" telah dihapus (dipaksa).`);
          fetchCharacters();
        } catch (err2) {
          toast.error('Gagal menghapus karakter.');
        }
        return;
      }
      toast.error('Gagal menghapus karakter.');
    }
  };

  // Item 6: duplicate/clone an existing character (server copies its local files too).
  const handleDuplicate = async (char) => {
    setDuplicatingId(char.id);
    try {
      const res = await api.post(`/characters/${char.id}/duplicate`);
      toast.success(`Karakter "${char.name}" berhasil diduplikasi.`);
      fetchCharacters();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal menduplikasi karakter.');
    } finally {
      setDuplicatingId(null);
    }
  };

  // Handle image upload for manual sheet URL or AI reference
  const handleFileUpload = (e, callback) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      callback(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const filteredCharacters = characters
    .filter(c => 
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.visual_tone?.toLowerCase().includes(search.toLowerCase()) ||
      c.concept?.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      switch (sortBy) {
        case 'name_asc':
          return String(a.name || '').localeCompare(String(b.name || ''));
        case 'name_desc':
          return String(b.name || '').localeCompare(String(a.name || ''));
        case 'created_asc':
          return new Date(a.created_at || 0) - new Date(b.created_at || 0);
        case 'usage_desc':
          return (b.usage_count || 0) - (a.usage_count || 0);
        case 'created_desc':
        default:
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
    });

  const getFullImageUrl = (path) => {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    const base = import.meta.env.VITE_API_URL || '/api';
    let cleanPath = path.startsWith('/') ? path.slice(1) : path;
    if (base.startsWith('http')) {
      try { return `${new URL(base).origin}/${cleanPath}`; } catch (e) { return `/${cleanPath}`; }
    }
    return `/${cleanPath}`;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fadeIn">
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-[#2a2725]">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="p-2 rounded-xl bg-[#cfae80]/10 text-[#cfae80] border border-[#cfae80]/20">
              <UserCheck className="w-6 h-6" />
            </span>
            <h1 className="text-3xl font-editorial italic text-white tracking-wide">Karakter Konsisten</h1>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl">
            Buat dan kelola desain karakter (*Character Design Reference Sheet*) lengkap dengan pandangan 360°, wardrobe, ekspresi, dan palette warna. Gunakan di Storyboard agar visual wajah & pakaian konsisten.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAiModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[#cfae80] to-[#b89566] hover:from-[#dfbd8e] hover:to-[#cfae80] text-slate-950 font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg transition-all duration-200"
          >
            <Sparkles className="w-4 h-4" />
            Sihir AI (Otomatis)
          </button>
          <button
            onClick={handleOpenManualCreate}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#1a1918] hover:bg-[#252321] text-slate-200 border border-[#3a3633] font-bold text-xs uppercase tracking-wider rounded-xl transition-all duration-200"
          >
            <Plus className="w-4 h-4 text-[#cfae80]" />
            Tambah Manual
          </button>
        </div>
      </div>

      {/* SEARCH BAR */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="relative flex-grow max-w-md w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari karakter berdasarkan nama, gaya visual, atau konsep..."
            className="w-full bg-[#1a1918] border border-[#2a2725] rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#cfae80]/50"
          />
        </div>
        <div className="flex items-center gap-3">
          {/* Item 7: advanced sort/organization control */}
          <div className="relative flex items-center gap-1.5 bg-[#1a1918] border border-[#2a2725] rounded-xl px-3 py-2">
            <ArrowUpDown className="w-3.5 h-3.5 text-[#cfae80]" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-transparent text-xs text-slate-200 focus:outline-none"
            >
              <option value="created_desc">Terbaru</option>
              <option value="created_asc">Terlama</option>
              <option value="name_asc">Nama (A-Z)</option>
              <option value="name_desc">Nama (Z-A)</option>
              <option value="usage_desc">Paling Sering Dipakai</option>
            </select>
          </div>
          <span className="text-xs text-slate-400 font-mono whitespace-nowrap">
            Total: <strong className="text-[#cfae80]">{filteredCharacters.length}</strong> Karakter
          </span>
        </div>
      </div>

      {/* CHARACTERS GALLERY GRID */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3">
          <Loader className="w-8 h-8 text-[#cfae80] animate-spin" />
          <span className="text-xs text-slate-400">Memuat pustaka karakter...</span>
        </div>
      ) : filteredCharacters.length === 0 ? (
        <div className="py-20 border-2 border-dashed border-[#2a2725] rounded-2xl flex flex-col items-center justify-center text-center p-8 bg-[#1a1918]/40">
          <UserCheck className="w-12 h-12 text-slate-600 mb-3" />
          <h3 className="text-base font-bold text-slate-300">Belum ada Karakter Konsisten</h3>
          <p className="text-xs text-slate-500 max-w-md mt-1 mb-6">
            Buat desain karakter pertama Anda dengan Sihir AI atau masukkan data manual untuk mempertahankan penampilan fisik tokoh di seluruh storyboard adegan.
          </p>
          <button
            onClick={() => setShowAiModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#cfae80] text-slate-950 font-bold text-xs uppercase tracking-wider rounded-xl shadow-md hover:bg-[#dfbd8e] transition-all"
          >
            <Sparkles className="w-4 h-4" />
            Buat Karakter Pertama dengan AI
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCharacters.map((char) => {
            const hasSheetImage = !!char.sheet_image_url;
            const fullSheetUrl = getFullImageUrl(char.sheet_image_url);

            return (
              <div
                key={char.id}
                className="group bg-[#1a1918] border border-[#2a2725] hover:border-[#cfae80]/40 rounded-2xl overflow-hidden shadow-lg transition-all duration-300 flex flex-col justify-between"
              >
                {/* CHARACTER SHEET HEADER IMAGE PREVIEW */}
                <div 
                  onClick={() => setShowSheetViewer(char)}
                  className="relative aspect-[4/3] bg-[#121110] border-b border-[#2a2725] cursor-pointer overflow-hidden group/img"
                >
                  {hasSheetImage ? (
                    <img
                      src={fullSheetUrl}
                      alt={char.name}
                      className="w-full h-full object-cover object-top group-hover/img:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#1e1c1a] to-[#121110] p-6 text-center">
                      <Palette className="w-10 h-10 text-[#cfae80]/40 mb-2" />
                      <span className="text-xs text-slate-400 font-semibold">{char.name}</span>
                      <span className="text-[10px] text-slate-600 uppercase tracking-widest mt-1">Character Bible Sheet</span>
                    </div>
                  )}

                  {/* Badges Overlay */}
                  <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
                    <span className="px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-md text-[9px] font-bold text-[#cfae80] border border-[#cfae80]/30 tracking-widest uppercase">
                      Sheet V1.0
                    </span>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setShowSheetViewer(char); }}
                      className="p-2 rounded-full bg-black/70 backdrop-blur-md text-white hover:bg-[#cfae80] hover:text-black transition-all"
                      title="Buka Character Reference Sheet"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* CARD BODY CONTENT */}
                <div className="p-5 space-y-4 flex-grow">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-editorial italic text-white group-hover:text-[#cfae80] transition-colors">
                        {char.name}
                      </h3>
                      {char.tagline && (
                        <p className="text-xs text-[#cfae80]/80 font-medium italic mt-0.5 truncate">
                          "{char.tagline}"
                        </p>
                      )}
                    </div>
                    {/* Item 5: usage indicator */}
                    {char.usage_count > 0 && (
                      <span className="shrink-0 px-2 py-0.5 rounded-full bg-white/[0.04] border border-[#3a3633] text-[9px] font-bold text-slate-300 whitespace-nowrap">
                        {char.usage_count} storyboard
                      </span>
                    )}
                  </div>

                  {char.visual_tone && (
                    <div className="flex flex-wrap gap-1.5">
                      {char.visual_tone.split(',').map((tone, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded bg-white/[0.03] border border-[#3a3633] text-[9.5px] text-slate-300 font-mono">
                          {tone.trim()}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Color Palette Swatches */}
                  {Array.isArray(char.color_palette) && char.color_palette.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Color Palette:</span>
                      <div className="flex items-center gap-1.5">
                        {char.color_palette.map((color, idx) => (
                          <div
                            key={idx}
                            style={{ backgroundColor: color }}
                            className="w-5 h-5 rounded-full border border-black/40 shadow-sm"
                            title={color}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {char.concept && (
                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                      {char.concept}
                    </p>
                  )}
                </div>

                {/* CARD ACTIONS FOOTER */}
                <div className="p-4 border-t border-[#2a2725] bg-[#151413]/60 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setShowSheetViewer(char)}
                      className="px-3 py-1.5 bg-[#cfae80]/10 hover:bg-[#cfae80]/20 text-[#cfae80] border border-[#cfae80]/30 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5"
                    >
                      <Eye className="w-3 h-3" />
                      Sheet
                    </button>
                    <button
                      onClick={() => handleOpenEdit(char)}
                      className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-all"
                      title="Edit Karakter"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDuplicate(char)}
                      disabled={duplicatingId === char.id}
                      className="p-1.5 text-slate-400 hover:text-[#cfae80] rounded-lg hover:bg-white/5 transition-all disabled:opacity-50"
                      title="Duplikat / Clone Karakter"
                    >
                      {duplicatingId === char.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => handleDelete(char)}
                      className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-red-950/20 transition-all"
                      title="Hapus Karakter"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      if (onSelectCharacterForStoryboard) {
                        onSelectCharacterForStoryboard(char);
                      } else if (setTab) {
                        setTab('generator');
                      }
                    }}
                    className="px-3 py-1.5 bg-[#cfae80] hover:bg-[#dfbd8e] text-slate-950 font-bold rounded-lg text-[10px] uppercase tracking-wider transition-all flex items-center gap-1"
                  >
                    <Sparkles className="w-3 h-3" />
                    Gunakan
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 1: AI CHARACTER DESIGN GENERATOR */}
      {showAiModal && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-hidden">
          <div className="bg-[#1a1918] border border-[#3a3633] rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl animate-scaleUp">
            <div className="p-6 border-b border-[#2a2725] flex items-center justify-between bg-[#151413] shrink-0">
              <div className="flex items-center gap-3">
                <span className="p-2 rounded-xl bg-[#cfae80]/15 text-[#cfae80] border border-[#cfae80]/30">
                  <Sparkles className="w-5 h-5" />
                </span>
                <div>
                  <h2 className="text-xl font-editorial italic text-white">Sihir AI: Buat Character Design Sheet</h2>
                  <p className="text-xs text-slate-400">Masukkan deskripsi tokoh atau unggah foto untuk dibuatkan sheet lengkap otomatis. Jenis kelamin, warna kulit, dan identitas suara akan diisi otomatis oleh AI (mode Auto) — cukup kirim foto referensi saja jika Anda tidak ingin mengisi manual.</p>
                </div>
              </div>
              <button
                onClick={() => { if (!aiGenerating) setShowAiModal(false); }}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 flex-1 overflow-y-auto min-h-0">
              {!aiResultSpec ? (
                <>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
                      <span>Konsep / Ide Karakter</span>
                      <span className="text-[10px] text-slate-500 font-normal">Sebutkan nama, gaya, pakaian, sifat, atau mood</span>
                    </label>
                    <textarea
                      rows={4}
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder="Contoh: Aldi Taher - penyanyi pop eksentrik Indonesia, kaos kuning kumal bertuliskan 'I Love You', celana kargo krem, gitar akustik penuh stiker, jam tangan kuning, gaya film retro Tarantino 90s... (Kosongkan & unggah foto saja untuk mode Auto sepenuhnya)"
                      className="w-full bg-[#121110] border border-[#2a2725] rounded-xl p-3.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#cfae80]/60 leading-relaxed"
                    />
                  </div>

                  {/* Model & Engine AI Selection */}
                  <div className="space-y-2.5 bg-[#121110] p-3.5 rounded-xl border border-[#2a2725]">
                    <label className="text-xs font-bold uppercase tracking-wider text-[#cfae80] flex items-center justify-between">
                      <span>Engine & Model AI Renderer</span>
                      <span className="text-[10px] text-slate-500 font-normal">Pilih model pembuat gambar karakter</span>
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      {/* Provider Selector */}
                      <div>
                        <span className="text-[10px] text-slate-400 font-semibold mb-1 block">Provider Render:</span>
                        <select
                          value={selectedProvider}
                          onChange={(e) => setSelectedProvider(e.target.value)}
                          className="w-full bg-[#1a1918] border border-[#3a3633] rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-[#cfae80]/60 font-medium"
                        >
                          <option value="freebeat">Freebeat AI (Default)</option>
                          <option value="magica">Magica AI (8K)</option>
                        </select>
                      </div>

                      {/* Model Selector (Magica) */}
                      {selectedProvider === 'magica' ? (
                        <div>
                          <span className="text-[10px] text-slate-400 font-semibold mb-1 block">Model Magica:</span>
                          <select
                            value={magicaModel}
                            onChange={(e) => setMagicaModel(e.target.value)}
                            className="w-full bg-[#1a1918] border border-[#3a3633] rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-[#cfae80]/60 font-medium"
                          >
                            {magicaCatalog?.imageModels?.length > 0 ? (
                              magicaCatalog.imageModels.map((m) => (
                                <option key={m.nodeType} value={m.nodeType}>
                                  {m.name || m.nodeType}
                                </option>
                              ))
                            ) : (
                              <>
                                <option value="nano_fast">Nano Fast (Cepat)</option>
                                <option value="gpt_image_2">GPT Image 2 (Detail)</option>
                                <option value="flux">Flux Realism (8K)</option>
                                <option value="seedance_2_0_fast">Seedance 2.0 Fast</option>
                              </>
                            )}
                          </select>
                        </div>
                      ) : null}

                      {/* API Key Selector */}
                      <div className={selectedProvider !== 'magica' ? 'sm:col-span-2' : ''}>
                        <span className="text-[10px] text-slate-400 font-semibold mb-1 block">
                          Pilih API Key ({selectedProvider === 'magica' ? 'Magica' : 'Freebeat'}):
                        </span>
                        {selectedProvider === 'magica' ? (
                          <select
                            value={magicaKeyId}
                            onChange={(e) => setMagicaKeyId(e.target.value)}
                            className="w-full bg-[#1a1918] border border-[#3a3633] rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-[#cfae80]/60 font-medium"
                          >
                            <option value="auto">Pilih Otomatis (Auto-detect)</option>
                            {((magicaCatalog && magicaCatalog.keys) || []).map((k) => {
                              const low = k.balance != null && k.balance < 1000000;
                              return (
                                <option key={k.id} value={k.id} disabled={low}>
                                  {k.label} {k.formatted != null ? `(⚡ ${k.formatted} kredit)` : ''} {low ? '— Saldo tipis' : ''}
                                </option>
                              );
                            })}
                          </select>
                        ) : (
                          <select
                            value={apiKeyId}
                            onChange={(e) => setApiKeyId(e.target.value)}
                            className="w-full bg-[#1a1918] border border-[#3a3633] rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-[#cfae80]/60 font-medium"
                          >
                            <option value="auto">Pilih Otomatis (Acak)</option>
                            {apiKeys.map((k) => (
                              <option key={k.id} value={k.id}>
                                {k.name || `Key #${k.id} (${k.key_value ? k.key_value.slice(0, 8) + '...' : ''})`}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Optional Reference Image Upload */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Foto Referensi Visual (Opsional — Mode Auto)
                    </label>
                    <div className="flex items-center gap-3">
                      <label className="cursor-pointer px-4 py-2.5 bg-[#121110] hover:bg-[#201e1c] border border-[#2a2725] rounded-xl text-xs font-semibold text-slate-300 flex items-center gap-2 transition-all">
                        <Upload className="w-4 h-4 text-[#cfae80]" />
                        Unggah Foto
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleFileUpload(e, setAiRefImage)}
                          className="hidden"
                        />
                      </label>
                      <span className="text-xs text-slate-500">atau</span>
                      <input
                        type="text"
                        value={aiRefImage.startsWith('data:') ? 'Foto Lokal Diunggah' : aiRefImage}
                        onChange={(e) => setAiRefImage(e.target.value)}
                        placeholder="Tempel URL gambar referensi..."
                        className="flex-grow bg-[#121110] border border-[#2a2725] rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#cfae80]/50"
                      />
                    </div>
                    {aiRefImage && (
                      <div className="relative w-24 h-24 rounded-xl overflow-hidden border border-[#cfae80]/40 mt-2">
                        <img src={aiRefImage} alt="Ref preview" className="w-full h-full object-cover" />
                        <button
                          onClick={() => setAiRefImage('')}
                          className="absolute top-1 right-1 p-1 bg-black/80 rounded-full text-white hover:text-red-400"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  {aiGenerating && (
                    <div className="p-4 bg-[#cfae80]/10 border border-[#cfae80]/30 rounded-xl flex items-center gap-3">
                      <Loader className="w-5 h-5 text-[#cfae80] animate-spin shrink-0" />
                      <span className="text-xs text-[#cfae80] font-medium">{aiStep}</span>
                    </div>
                  )}
                </>
              ) : (
                /* PREVIEW AI GENERATED SPECIFICATION BEFORE SAVING */
                <div className="space-y-6 animate-fadeIn">
                  <div className="p-4 bg-[#cfae80]/10 border border-[#cfae80]/30 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Check className="w-5 h-5 text-[#cfae80]" />
                      <span className="text-xs text-[#cfae80] font-bold uppercase tracking-wider">Sheet Karakter AI Berhasil Disusun!</span>
                    </div>
                    {aiRenderingImage && (
                      <div className="flex items-center gap-2 text-[10px] text-amber-300">
                        <Loader className="w-3.5 h-3.5 animate-spin" />
                        <span>Merender Lembar Gambar...</span>
                      </div>
                    )}
                  </div>

                  {/* Sheet Image Preview if rendered */}
                  {aiSheetImageUrl && (
                    <div className="space-y-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Hasil Render Character Reference Sheet:</span>
                      <div className="relative aspect-[3/4] max-h-96 rounded-xl overflow-hidden border border-[#cfae80]/40 bg-black">
                        <img src={getFullImageUrl(aiSheetImageUrl)} alt="Rendered sheet" className="w-full h-full object-contain" />
                      </div>
                    </div>
                  )}

                  {/* Character Spec Breakdown Preview */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="bg-[#121110] p-4 rounded-xl border border-[#2a2725] space-y-2">
                      <h4 className="font-editorial italic text-base text-white">{aiResultSpec.name}</h4>
                      <p className="text-slate-400 italic">"{aiResultSpec.tagline}"</p>
                      <p className="text-slate-300">{aiResultSpec.concept}</p>
                      {(aiResultSpec.gender || aiResultSpec.skin_tone) && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {aiResultSpec.gender && <span className="px-2 py-0.5 rounded bg-white/[0.04] border border-[#3a3633] text-[9.5px] text-slate-300">Gender: {aiResultSpec.gender}</span>}
                          {aiResultSpec.skin_tone && <span className="px-2 py-0.5 rounded bg-white/[0.04] border border-[#3a3633] text-[9.5px] text-slate-300">Kulit: {aiResultSpec.skin_tone}</span>}
                        </div>
                      )}
                    </div>

                    <div className="bg-[#121110] p-4 rounded-xl border border-[#2a2725] space-y-2">
                      <span className="font-bold uppercase tracking-wider text-[#cfae80] text-[10px]">Visual Tone & Palette</span>
                      <p className="text-slate-300">{aiResultSpec.visual_tone}</p>
                      {Array.isArray(aiResultSpec.color_palette) && (
                        <div className="flex items-center gap-2 pt-1">
                          {aiResultSpec.color_palette.map((c, i) => (
                            <div key={i} style={{ backgroundColor: c }} className="w-6 h-6 rounded-full border border-black/40" title={c} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {(aiResultSpec.voice_gender || aiResultSpec.voice_tone || aiResultSpec.voice_language) && (
                    <div className="bg-[#121110] p-4 rounded-xl border border-[#2a2725] space-y-2 text-xs">
                      <span className="font-bold uppercase tracking-wider text-[#cfae80] text-[10px]">Identitas Suara (Voice Over) — Saran AI</span>
                      <p className="text-slate-300">
                        {[aiResultSpec.voice_gender, aiResultSpec.voice_tone, aiResultSpec.voice_language].filter(Boolean).join(' · ')}
                      </p>
                      {aiResultSpec.voice_notes && <p className="text-slate-500 text-[10px]">{aiResultSpec.voice_notes}</p>}
                    </div>
                  )}

                  <div className="bg-[#121110] p-4 rounded-xl border border-[#2a2725] space-y-2 text-xs">
                    <span className="font-bold uppercase tracking-wider text-[#cfae80] text-[10px]">Pakaian & Aksesoris (Wardrobe Breakdown)</span>
                    <p className="text-slate-300 leading-relaxed">{aiResultSpec.wardrobe}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="p-5 border-t border-[#2a2725] bg-[#151413] flex items-center justify-between shrink-0">
              <button
                onClick={() => {
                  if (aiResultSpec) {
                    setAiResultSpec(null);
                  } else {
                    setShowAiModal(false);
                  }
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-all"
                disabled={aiGenerating}
              >
                {aiResultSpec ? 'Kembali Edit Konsep' : 'Batal'}
              </button>

              {!aiResultSpec ? (
                <button
                  onClick={handleGenerateAI}
                  disabled={aiGenerating}
                  className="px-6 py-2.5 bg-[#cfae80] hover:bg-[#dfbd8e] text-slate-950 font-bold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {aiGenerating ? <Loader className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Susun Sheet Karakter
                </button>
              ) : (
                <button
                  onClick={handleSaveAiCharacter}
                  disabled={saving}
                  className="px-6 py-2.5 bg-[#cfae80] hover:bg-[#dfbd8e] text-slate-950 font-bold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Simpan Karakter Ini
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL 2: MANUAL CREATE / EDIT CHARACTER */}
      {showManualModal && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-hidden">
          <div className="bg-[#1a1918] border border-[#3a3633] rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl animate-scaleUp">
            <div className="p-6 border-b border-[#2a2725] flex items-center justify-between bg-[#151413] shrink-0">
              <h2 className="text-xl font-editorial italic text-white">
                {editingCharacter ? 'Edit Character Design Sheet' : 'Tambah Karakter Manual'}
              </h2>
              <button
                onClick={() => setShowManualModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveManual} className="flex-1 flex flex-col min-h-0 overflow-hidden text-xs">
              <div className="p-6 space-y-4 flex-1 overflow-y-auto min-h-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="font-bold uppercase tracking-wider text-slate-300">Nama Karakter *</label>
                    <input
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="Contoh: Aldi Taher / Ronald"
                      className="w-full bg-[#121110] border border-[#2a2725] rounded-xl px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#cfae80]/60"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="font-bold uppercase tracking-wider text-slate-300">Tagline / Slogan</label>
                    <input
                      type="text"
                      value={formTagline}
                      onChange={(e) => setFormTagline(e.target.value)}
                      placeholder="Contoh: I LOVE YOU ALDI TAHER"
                      className="w-full bg-[#121110] border border-[#2a2725] rounded-xl px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#cfae80]/60"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold uppercase tracking-wider text-slate-300">Konsep Ringkas (Character Concept)</label>
                  <textarea
                    rows={2}
                    value={formConcept}
                    onChange={(e) => setFormConcept(e.target.value)}
                    placeholder="Ringkasan latar belakang, sifat, dan kepribadian karakter..."
                    className="w-full bg-[#121110] border border-[#2a2725] rounded-xl p-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#cfae80]/60"
                  />
                </div>

                {/* Item 9: Gender / Skin Tone — leave blank for "Auto" (AI infers from photo) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="font-bold uppercase tracking-wider text-slate-300">Jenis Kelamin <span className="text-slate-500 normal-case font-normal">(kosongkan = Auto)</span></label>
                    <select
                      value={formGender}
                      onChange={(e) => setFormGender(e.target.value)}
                      className="w-full bg-[#121110] border border-[#2a2725] rounded-xl px-3.5 py-2.5 text-slate-100 focus:outline-none focus:border-[#cfae80]/60"
                    >
                      <option value="">Auto (Ditentukan AI)</option>
                      <option value="Male">Laki-laki</option>
                      <option value="Female">Perempuan</option>
                      <option value="Non-binary">Non-biner</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="font-bold uppercase tracking-wider text-slate-300">Warna Kulit <span className="text-slate-500 normal-case font-normal">(kosongkan = Auto)</span></label>
                    <input
                      type="text"
                      value={formSkinTone}
                      onChange={(e) => setFormSkinTone(e.target.value)}
                      placeholder="Contoh: Sawo matang, Kuning langsat, Gelap..."
                      className="w-full bg-[#121110] border border-[#2a2725] rounded-xl px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#cfae80]/60"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="font-bold uppercase tracking-wider text-slate-300">Visual Tone & Style</label>
                    <PresetPicker presets={CHARACTER_PRESETS.visualTone} onPick={setFormVisualTone} placeholder="✨ Pilih gaya visual siap pakai..." />
                    <input
                      type="text"
                      value={formVisualTone}
                      onChange={(e) => setFormVisualTone(e.target.value)}
                      placeholder="Tarantino Cinematic, 90s Retro, Gritty Urban Realism"
                      className="w-full bg-[#121110] border border-[#2a2725] rounded-xl px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#cfae80]/60"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="font-bold uppercase tracking-wider text-slate-300">Color Palette (Pisahkan dengan koma)</label>
                    <PresetPicker presets={CHARACTER_PRESETS.colorPalette} onPick={setFormColorPalette} placeholder="✨ Pilih palet warna siap pakai..." />
                    <input
                      type="text"
                      value={formColorPalette}
                      onChange={(e) => setFormColorPalette(e.target.value)}
                      placeholder="#E6D45A, #C4A85A, #F5F5F5, #8B5E34, #1E1E1E"
                      className="w-full bg-[#121110] border border-[#2a2725] rounded-xl px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#cfae80]/60 font-mono text-[11px]"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold uppercase tracking-wider text-slate-300">1. PROFILE Notes (Pandangan Samping & Ciri Fisik)</label>
                  <PresetPicker presets={CHARACTER_PRESETS.profileNotes} onPick={setFormProfileNotes} placeholder="✨ Pilih ciri fisik siap pakai..." />
                  <textarea
                    rows={2}
                    value={formProfileNotes}
                    onChange={(e) => setFormProfileNotes(e.target.value)}
                    placeholder="Rincian rambut keriting, ekspresi percaya diri, plester jari biru, jam tangan kuning..."
                    className="w-full bg-[#121110] border border-[#2a2725] rounded-xl p-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#cfae80]/60"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold uppercase tracking-wider text-slate-300">2. TURNAROUND Notes (360° View: Front, Left, Back, Right)</label>
                  <PresetPicker presets={CHARACTER_PRESETS.turnaroundNotes} onPick={setFormTurnaroundNotes} placeholder="✨ Pilih catatan turnaround siap pakai..." />
                  <textarea
                    rows={2}
                    value={formTurnaroundNotes}
                    onChange={(e) => setFormTurnaroundNotes(e.target.value)}
                    placeholder="Rincian pakaian dari sudut pandang depan, samping kiri, belakang, dan kanan..."
                    className="w-full bg-[#121110] border border-[#2a2725] rounded-xl p-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#cfae80]/60"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold uppercase tracking-wider text-slate-300">4. HEAD STUDY / Ekspresi Wajah (Pisahkan dengan koma)</label>
                  <PresetPicker presets={CHARACTER_PRESETS.expressions} onPick={setFormExpressions} placeholder="✨ Pilih set ekspresi siap pakai..." />
                  <input
                    type="text"
                    value={formExpressions}
                    onChange={(e) => setFormExpressions(e.target.value)}
                    placeholder="01. Happy, 02. Joyful, 03. Serious, 04. Surprised, 05. Playful"
                    className="w-full bg-[#121110] border border-[#2a2725] rounded-xl px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#cfae80]/60"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold uppercase tracking-wider text-slate-300">5. WARDROBE BREAKDOWN (Pakaian & Aksesoris)</label>
                  <PresetPicker presets={CHARACTER_PRESETS.wardrobe} onPick={setFormWardrobe} placeholder="✨ Pilih wardrobe siap pakai..." />
                  <textarea
                    rows={2}
                    value={formWardrobe}
                    onChange={(e) => setFormWardrobe(e.target.value)}
                    placeholder="Kaos kuning kumal, stiker gitar akustik, celana kargo, sepatu kets lusuh..."
                    className="w-full bg-[#121110] border border-[#2a2725] rounded-xl p-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#cfae80]/60"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold uppercase tracking-wider text-slate-300">Trigger Prompt untuk AI Image Generator</label>
                  <PresetPicker presets={CHARACTER_PRESETS.triggerPrompt} onPick={setFormTriggerPrompt} placeholder="✨ Pilih trigger prompt siap pakai..." />
                  <input
                    type="text"
                    value={formTriggerPrompt}
                    onChange={(e) => setFormTriggerPrompt(e.target.value)}
                    placeholder="Keywords khusus agar AI menjaga konsistensi wajah & baju di adegan..."
                    className="w-full bg-[#121110] border border-[#2a2725] rounded-xl px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#cfae80]/60"
                  />
                </div>

                {/* Item 8: per-character voice identity — leave blank for "Auto" (unchanged storyboard-level tone) */}
                <div className="space-y-3 p-4 rounded-xl border border-[#2a2725] bg-[#121110]/60">
                  <label className="font-bold uppercase tracking-wider text-[#cfae80] block">8. Identitas Suara (Voice Over) Karakter <span className="text-slate-500 normal-case font-normal">(kosongkan semua = Auto)</span></label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="font-semibold text-slate-400">Gender Suara</label>
                      <select
                        value={formVoiceGender}
                        onChange={(e) => setFormVoiceGender(e.target.value)}
                        className="w-full bg-[#1a1918] border border-[#2a2725] rounded-xl px-3.5 py-2.5 text-slate-100 focus:outline-none focus:border-[#cfae80]/60"
                      >
                        <option value="">Auto</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Neutral">Neutral</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="font-semibold text-slate-400">Nada / Tone Suara</label>
                      <PresetPicker presets={CHARACTER_PRESETS.voiceTone} onPick={setFormVoiceTone} placeholder="✨ Pilih nada suara siap pakai..." />
                      <input
                        type="text"
                        value={formVoiceTone}
                        onChange={(e) => setFormVoiceTone(e.target.value)}
                        placeholder="Contoh: hangat dan percaya diri, serak dan lelah..."
                        className="w-full bg-[#1a1918] border border-[#2a2725] rounded-xl px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#cfae80]/60"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="font-semibold text-slate-400">Bahasa Voice Over</label>
                      <PresetPicker presets={CHARACTER_PRESETS.voiceLanguage} onPick={setFormVoiceLanguage} placeholder="✨ Pilih bahasa siap pakai..." />
                      <input
                        type="text"
                        value={formVoiceLanguage}
                        onChange={(e) => setFormVoiceLanguage(e.target.value)}
                        placeholder="Contoh: Bahasa Indonesia (kosongkan = ikut setelan storyboard)"
                        className="w-full bg-[#1a1918] border border-[#2a2725] rounded-xl px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#cfae80]/60"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="font-semibold text-slate-400">Catatan Suara Tambahan</label>
                      <input
                        type="text"
                        value={formVoiceNotes}
                        onChange={(e) => setFormVoiceNotes(e.target.value)}
                        placeholder="Aksen, kecepatan bicara, dsb (opsional)"
                        className="w-full bg-[#1a1918] border border-[#2a2725] rounded-xl px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#cfae80]/60"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold uppercase tracking-wider text-slate-300">Gambar Character Design Sheet (URL / Upload)</label>
                  <div className="flex items-center gap-3">
                    <label className="cursor-pointer px-4 py-2.5 bg-[#121110] border border-[#2a2725] hover:bg-[#201e1c] rounded-xl font-semibold text-slate-300 flex items-center gap-2">
                      <Upload className="w-4 h-4 text-[#cfae80]" />
                      Upload File
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleFileUpload(e, setFormSheetImageUrl)}
                        className="hidden"
                      />
                    </label>
                    <input
                      type="text"
                      value={formSheetImageUrl}
                      onChange={(e) => setFormSheetImageUrl(e.target.value)}
                      placeholder="URL gambar sheet karakter..."
                      className="flex-grow bg-[#121110] border border-[#2a2725] rounded-xl px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#cfae80]/60"
                    />
                  </div>
                </div>
              </div>

              <div className="p-5 border-t border-[#2a2725] bg-[#151413] flex items-center justify-between shrink-0">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 bg-[#cfae80] hover:bg-[#dfbd8e] text-slate-950 font-bold uppercase tracking-wider rounded-xl shadow-md transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Simpan Karakter
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}      {/* MODAL 3: FULL INTERACTIVE CHARACTER DESIGN REFERENCE SHEET VIEWER (LENGKAP) */}
      {showSheetViewer && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-hidden">
          <div className="bg-[#0f0e0d] border border-[#3a3633] rounded-3xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl text-slate-100 animate-scaleUp">
            {/* SHEET HEADER & NAVIGATION */}
            <div className="px-6 py-4 border-b border-[#2a2725] bg-[#181716] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-full bg-[#cfae80]/15 text-[#cfae80] text-[10px] font-bold tracking-widest uppercase border border-[#cfae80]/30">
                  CHARACTER DESIGN REFERENCE SHEET
                </span>
                <span className="text-xs text-slate-400">VERSION 1.0</span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleGenerateSheetForExistingCharacter(showSheetViewer)}
                  disabled={aiRenderingImage}
                  className="px-3.5 py-2 rounded-xl bg-[#cfae80] hover:bg-[#dfbd8e] text-slate-950 font-bold transition-all flex items-center gap-1.5 text-xs shadow-md disabled:opacity-50"
                  title="Render Gambar Poster Reference Sheet AI 8K"
                >
                  {aiRenderingImage ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {showSheetViewer.sheet_image_url ? 'Render Ulang Poster AI' : 'Render Poster Gambar AI'}
                </button>
                {showSheetViewer.sheet_image_url && (
                  <a
                    href={getFullImageUrl(showSheetViewer.sheet_image_url)}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-all flex items-center gap-1.5 text-xs font-semibold"
                  >
                    <Download className="w-4 h-4" />
                    Unduh Sheet
                  </a>
                )}
                <button
                  onClick={() => setShowSheetViewer(null)}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* MAIN REFERENCE SHEET LAYOUT (STUDIO POSTER STYLE) */}
            <div className="p-6 md:p-8 space-y-8 flex-1 overflow-y-auto min-h-0 bg-gradient-to-b from-[#141312] to-[#0a0a09]">
              
              {/* IMAGE POSTER BANNER (IF FULL IMAGE GENERATED) */}
              {showSheetViewer.sheet_image_url ? (
                <div className="relative rounded-2xl overflow-hidden border border-[#3a3633] shadow-2xl bg-black max-h-[500px] flex items-center justify-center group">
                  <img
                    src={getFullImageUrl(showSheetViewer.sheet_image_url)}
                    alt={showSheetViewer.name}
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleGenerateSheetForExistingCharacter(showSheetViewer)}
                      disabled={aiRenderingImage}
                      className="px-3 py-1.5 bg-black/80 hover:bg-black text-[#cfae80] border border-[#cfae80]/40 rounded-xl text-xs font-bold flex items-center gap-1.5 backdrop-blur-md"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Render Ulang Gambar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-6 rounded-2xl border-2 border-dashed border-[#cfae80]/30 bg-[#cfae80]/5 flex flex-col items-center justify-center text-center space-y-4">
                  <Sparkles className="w-8 h-8 text-[#cfae80] animate-pulse" />
                  <div>
                    <h3 className="text-sm font-bold text-white">Gambar Reference Sheet Poster (8K Image) Belum Dirender</h3>
                    <p className="text-xs text-slate-400 max-w-md mt-1">
                      Buat lembar gambar poster sinematik lengkap (termasuk foto Turnaround 360°, Close-up, 5 Ekspresi, & Wardrobe) dalam 1 gambar utuh beresolusi tinggi dengan AI.
                    </p>
                  </div>
                  {/* Reference Photo Status Indicator Badge */}
                  {showSheetViewer.reference_images && showSheetViewer.reference_images.length > 0 && (
                    <div className="w-full max-w-lg bg-[#cfae80]/10 border border-[#cfae80]/30 p-2.5 rounded-xl flex items-center gap-3 text-left">
                      <img src={getFullImageUrl(showSheetViewer.reference_images[0])} alt="Foto Referensi" className="w-10 h-10 rounded-lg object-cover border border-[#cfae80]/50 shrink-0" />
                      <div className="text-left text-xs">
                        <span className="text-[#cfae80] font-bold block">📷 Foto Referensi Asli Terdeteksi</span>
                        <span className="text-slate-350 text-[10px]">Magica akan menggunakan foto ini sebagai acuan (Image-to-Image) untuk mengunci kemiripan wajah & penampilan.</span>
                      </div>
                    </div>
                  )}

                  {/* Provider & Model & API Key Selection inside Modal 3 */}
                  <div className="w-full max-w-lg bg-[#121110]/80 p-3.5 rounded-xl border border-[#3a3633] space-y-2 text-left">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-[#cfae80]">
                      Pilih Engine & Model AI
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-400 font-semibold mb-1 block">Provider:</span>
                        <select
                          value={selectedProvider}
                          onChange={(e) => setSelectedProvider(e.target.value)}
                          className="w-full bg-[#1a1918] border border-[#3a3633] rounded-lg px-2.5 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-[#cfae80]/60 font-medium"
                        >
                          <option value="freebeat">Freebeat AI (Stabil)</option>
                          <option value="magica">Magica AI (8K)</option>
                        </select>
                      </div>
                      {selectedProvider === 'magica' ? (
                        <div>
                          <span className="text-[10px] text-slate-400 font-semibold mb-1 block">Model Magica:</span>
                          <select
                            value={magicaModel}
                            onChange={(e) => setMagicaModel(e.target.value)}
                            className="w-full bg-[#1a1918] border border-[#3a3633] rounded-lg px-2.5 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-[#cfae80]/60 font-medium"
                          >
                            {magicaCatalog?.imageModels?.length > 0 ? (
                              magicaCatalog.imageModels.map((m) => (
                                <option key={m.nodeType} value={m.nodeType}>
                                  {m.name || m.nodeType}
                                </option>
                              ))
                            ) : (
                              <>
                                <option value="nano_fast">Nano Fast (Cepat)</option>
                                <option value="gpt_image_2">GPT Image 2 (Detail)</option>
                                <option value="flux">Flux Realism (8K)</option>
                                <option value="seedance_2_0_fast">Seedance 2.0 Fast</option>
                              </>
                            )}
                          </select>
                        </div>
                      ) : null}

                      {/* API Key Selector */}
                      <div className={selectedProvider !== 'magica' ? 'sm:col-span-2' : ''}>
                        <span className="text-[10px] text-slate-400 font-semibold mb-1 block">
                          Pilih API Key ({selectedProvider === 'magica' ? 'Magica' : 'Freebeat'}):
                        </span>
                        {selectedProvider === 'magica' ? (
                          <select
                            value={magicaKeyId}
                            onChange={(e) => setMagicaKeyId(e.target.value)}
                            className="w-full bg-[#1a1918] border border-[#3a3633] rounded-lg px-2.5 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-[#cfae80]/60 font-medium"
                          >
                            <option value="auto">Pilih Otomatis (Auto-detect)</option>
                            {((magicaCatalog && magicaCatalog.keys) || []).map((k) => {
                              const low = k.balance != null && k.balance < 1000000;
                              return (
                                <option key={k.id} value={k.id} disabled={low}>
                                  {k.label} {k.formatted != null ? `(⚡ ${k.formatted} kredit)` : ''} {low ? '— Saldo tipis' : ''}
                                </option>
                              );
                            })}
                          </select>
                        ) : (
                          <select
                            value={apiKeyId}
                            onChange={(e) => setApiKeyId(e.target.value)}
                            className="w-full bg-[#1a1918] border border-[#3a3633] rounded-lg px-2.5 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-[#cfae80]/60 font-medium"
                          >
                            <option value="auto">Pilih Otomatis (Acak)</option>
                            {apiKeys.map((k) => (
                              <option key={k.id} value={k.id}>
                                {k.name || `Key #${k.id} (${k.key_value ? k.key_value.slice(0, 8) + '...' : ''})`}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleGenerateSheetForExistingCharacter(showSheetViewer)}
                    disabled={aiRenderingImage}
                    className="px-5 py-2.5 bg-[#cfae80] hover:bg-[#dfbd8e] text-slate-950 font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    {aiRenderingImage ? <Loader className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Render Poster Gambar Karakter (AI 8K)
                  </button>
                </div>
              )}

              {/* SECTION GRID 1-6 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* 1. PROFILE & PHYSICAL TRAITS */}
                <div className="bg-[#181716] border border-[#2a2725] rounded-2xl p-5 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-[#cfae80] flex items-center gap-2 border-b border-[#2a2725] pb-2">
                    <span>1. PROFILE</span>
                    <span className="text-[10px] text-slate-500 font-mono">(SIDE VIEW)</span>
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed font-sans">
                    {showSheetViewer.profile_notes || 'Profil fisik, sudut pandang samping, gaya rambut, dan ekspresi khas.'}
                  </p>
                  {(showSheetViewer.gender || showSheetViewer.skin_tone) && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {showSheetViewer.gender && <span className="px-2 py-0.5 rounded bg-white/[0.04] border border-[#3a3633] text-[9.5px] text-slate-300">Gender: {showSheetViewer.gender}</span>}
                      {showSheetViewer.skin_tone && <span className="px-2 py-0.5 rounded bg-white/[0.04] border border-[#3a3633] text-[9.5px] text-slate-300">Kulit: {showSheetViewer.skin_tone}</span>}
                    </div>
                  )}
                </div>

                {/* 2. TURNAROUND 360° VIEW */}
                <div className="bg-[#181716] border border-[#2a2725] rounded-2xl p-5 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-[#cfae80] flex items-center gap-2 border-b border-[#2a2725] pb-2">
                    <span>2. TURNAROUND</span>
                    <span className="text-[10px] text-slate-500 font-mono">(360° VIEW)</span>
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed font-sans">
                    {showSheetViewer.turnaround_notes || 'Tampak Depan (Front), Samping Kiri (Left), Belakang (Back), Samping Kanan (Right).'}
                  </p>
                </div>

                {/* 3. CINEMATIC PORTRAIT */}
                <div className="bg-[#181716] border border-[#2a2725] rounded-2xl p-5 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-[#cfae80] flex items-center gap-2 border-b border-[#2a2725] pb-2">
                    <span>3. CINEMATIC PORTRAIT</span>
                    <span className="text-[10px] text-slate-500 font-mono">(CLOSE UP SHOT)</span>
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed font-sans">
                    Pencahayaan dramatis, detail tekstur wajah close-up, sudut kamera sinematik.
                  </p>
                </div>
              </div>

              {/* 4. HEAD STUDY (EXPRESSIONS) */}
              <div className="bg-[#181716] border border-[#2a2725] rounded-2xl p-6 space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-widest text-[#cfae80] border-b border-[#2a2725] pb-2">
                  4. HEAD STUDY (EXPRESSIONS GRID)
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                  {(Array.isArray(showSheetViewer.expressions) && showSheetViewer.expressions.length > 0 
                    ? showSheetViewer.expressions 
                    : ['01. Happy', '02. Joyful', '03. Serious', '04. Surprised', '05. Playful']
                  ).map((expr, idx) => (
                    <div key={idx} className="bg-[#11100f] border border-[#2a2725] p-3 rounded-xl text-center space-y-1">
                      <div className="w-10 h-10 mx-auto rounded-full bg-[#cfae80]/10 flex items-center justify-center text-[#cfae80] font-bold text-xs">
                        0{idx + 1}
                      </div>
                      <p className="text-[11px] font-semibold text-slate-200 truncate">{expr}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* 5 & 6. WARDROBE BREAKDOWN & PRODUCTION NOTES */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* 5. WARDROBE BREAKDOWN */}
                <div className="bg-[#181716] border border-[#2a2725] rounded-2xl p-6 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-[#cfae80] border-b border-[#2a2725] pb-2">
                    5. WARDROBE BREAKDOWN (CLOTHING & ACCESSORIES)
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {showSheetViewer.wardrobe || 'Rincian kaos, celana, sepatu, tekstur bahan, dan aksesoris khusus.'}
                  </p>
                </div>

                {/* 6. PRODUCTION NOTES & COLOR PALETTE */}
                <div className="bg-[#181716] border border-[#2a2725] rounded-2xl p-6 space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-[#cfae80] border-b border-[#2a2725] pb-2">
                    6. PRODUCTION NOTES & COLOR PALETTE
                  </h4>
                  
                  {showSheetViewer.concept && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Character Concept</span>
                      <p className="text-xs text-slate-300">{showSheetViewer.concept}</p>
                    </div>
                  )}

                  {showSheetViewer.visual_tone && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Visual Tone</span>
                      <p className="text-xs text-[#cfae80] font-mono">{showSheetViewer.visual_tone}</p>
                    </div>
                  )}

                  {Array.isArray(showSheetViewer.color_palette) && showSheetViewer.color_palette.length > 0 && (
                    <div className="space-y-2 pt-2">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Color Palette</span>
                      <div className="flex items-center gap-3 flex-wrap">
                        {showSheetViewer.color_palette.map((hex, idx) => (
                          <div key={idx} className="flex items-center gap-2 bg-[#11100f] px-2.5 py-1.5 rounded-lg border border-[#2a2725]">
                            <div style={{ backgroundColor: hex }} className="w-4 h-4 rounded-full border border-black/40" />
                            <span className="text-[10px] font-mono text-slate-300">{hex}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ITEM 4: RIWAYAT VERSI SHEET IMAGE */}
              {Array.isArray(showSheetViewer.sheet_image_history) && showSheetViewer.sheet_image_history.length > 0 && (
                <div className="bg-[#181716] border border-[#2a2725] rounded-2xl p-6 space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-[#cfae80] border-b border-[#2a2725] pb-2 flex items-center gap-2">
                    <History className="w-3.5 h-3.5" />
                    RIWAYAT VERSI SHEET IMAGE
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {[...showSheetViewer.sheet_image_history].reverse().map((h, idx) => (
                      <div key={idx} className="relative group/hist rounded-xl overflow-hidden border border-[#2a2725] bg-[#11100f] aspect-[3/4]">
                        <img src={getFullImageUrl(h.url)} alt={`Versi ${idx + 1}`} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/70 opacity-0 group-hover/hist:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                          {h.replaced_at && (
                            <span className="text-[9px] text-slate-300 text-center">
                              {new Date(h.replaced_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </span>
                          )}
                          <button
                            onClick={async () => {
                              try {
                                await api.put(`/characters/${showSheetViewer.id}`, { sheet_image_url: h.url });
                                toast.success('Versi sheet image dipulihkan.');
                                setShowSheetViewer(prev => (prev ? { ...prev, sheet_image_url: h.url } : prev));
                                fetchCharacters();
                              } catch (e) {
                                toast.error('Gagal memulihkan versi ini.');
                              }
                            }}
                            className="px-2 py-1 bg-[#cfae80] text-slate-950 rounded-lg text-[9px] font-bold uppercase tracking-wider"
                          >
                            Gunakan Versi Ini
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* FOOTER TITLE BRANDING */}
              <div className="p-6 bg-[#181716] border border-[#2a2725] rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                  <h2 className="text-3xl font-editorial italic text-white tracking-widest uppercase">
                    {showSheetViewer.name}
                  </h2>
                  {showSheetViewer.tagline && (
                    <p className="text-xs text-[#cfae80] italic mt-0.5">{showSheetViewer.tagline}</p>
                  )}
                </div>
                <div className="text-right text-[10px] text-slate-500 font-mono space-y-0.5">
                  <p>STORYMAX CHARACTER DESIGN REFERENCE SHEET</p>
                  <p>VERSION 1.0 • DATE: {new Date(showSheetViewer.created_at || Date.now()).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}</p>
                </div>
              </div>

            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
