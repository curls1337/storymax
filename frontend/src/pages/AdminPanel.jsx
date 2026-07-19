import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import api from '../utils/api';
import { Users, Key, Plus, Trash2, ShieldAlert, Eye, EyeOff, Loader, Check, X, ShieldCheck, Terminal, UserPlus, Database, Sparkles, FolderOpen, HardDrive, DownloadCloud } from 'lucide-react';

export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [keys, setKeys] = useState([]);
  const [files, setFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [sortBy, setSortBy] = useState('date_desc');
  const [loading, setLoading] = useState(true);

  const getFullFileUrl = (filePath) => {
    if (!filePath) return '';
    const base = import.meta.env.VITE_API_URL || '/api';
    const cleanBase = base.replace(/\/api\/?$/, '');
    return `${cleanBase}${filePath.startsWith('/') ? filePath : '/' + filePath}`;
  };

  // Modals & States
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('user');

  const [showAddKeyModal, setShowAddKeyModal] = useState(false);
  const [newKeyVal, setNewKeyVal] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('');

  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkData, setBulkData] = useState('');

  const [showEditUserModal, setShowEditUserModal] = useState(false);
  const [editUserId, setEditUserId] = useState(null);
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editRole, setEditRole] = useState('user');

  // AI settings state
  const [aiEndpoint, setAiEndpoint] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('gemini-3-flash');
  const [aiTestLoading, setAiTestLoading] = useState(false);
  const [aiSaveLoading, setAiSaveLoading] = useState(false);

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const fetchUsers = async () => {
    try {
      const res = await api.get('/admin/users');
      setUsers(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchKeys = async () => {
    try {
      const res = await api.get('/admin/keys');
      setKeys(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchAiSettings = async () => {
    try {
      const res = await api.get('/admin/ai-settings');
      setAiEndpoint(res.data.endpoint || '');
      setAiApiKey(res.data.api_key || '');
      setAiModel(res.data.model || 'gemini-3-flash');
    } catch (err) {
      console.error('Gagal mengambil pengaturan AI:', err);
    }
  };

  const fetchFiles = async () => {
    try {
      const res = await api.get('/admin/files');
      setFiles(res.data);
      setSelectedFiles([]);
    } catch (err) {
      console.error('Gagal mengambil file penyimpanan:', err);
    }
  };

  const handleDeleteFile = async (filePath) => {
    if (!window.confirm('Yakin ingin menghapus file ini secara permanen dari server penyimpanan?')) return;
    setError('');
    setMessage('');
    try {
      await api.delete('/admin/files', { data: { filePath } });
      setMessage('File berhasil dihapus dari server.');
      fetchFiles();
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menghapus file.');
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedFiles.length === 0) return;
    if (!window.confirm(`Yakin ingin menghapus ${selectedFiles.length} file terpilih secara permanen dari server penyimpanan?`)) return;
    setError('');
    setMessage('');
    try {
      await api.delete('/admin/files', { data: { filePaths: selectedFiles } });
      setMessage(`${selectedFiles.length} file berhasil dihapus dari server.`);
      setSelectedFiles([]);
      fetchFiles();
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menghapus file terpilih.');
    }
  };

  const loadData = async () => {
    setLoading(true);
    await Promise.all([fetchUsers(), fetchKeys(), fetchAiSettings(), fetchFiles()]);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.post('/admin/users', { username: newUsername, password: newPassword, role: newRole });
      setMessage('User berhasil dibuat!');
      setShowAddUserModal(false);
      setNewUsername('');
      setNewPassword('');
      setNewRole('user');
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal membuat user.');
    }
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.put(`/admin/users/${editUserId}`, {
        username: editUsername,
        role: editRole,
        password: editPassword || undefined
      });
      setMessage('User berhasil diperbarui!');
      setShowEditUserModal(false);
      setEditPassword('');
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal memperbarui user.');
    }
  };

  const handleDeleteUser = async (id) => {
    if (!window.confirm('Yakin ingin menghapus user ini? Semua riwayat storyboard milik user ini akan ikut terhapus.')) return;
    try {
      await api.delete(`/admin/users/${id}`);
      setMessage('User berhasil dihapus.');
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menghapus user.');
    }
  };

  const handleAddKey = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.post('/admin/keys', { key_value: newKeyVal, label: newKeyLabel });
      setMessage('API Key berhasil ditambahkan!');
      setShowAddKeyModal(false);
      setNewKeyVal('');
      setNewKeyLabel('');
      fetchKeys();
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menambahkan API Key.');
    }
  };

  const handleAddKeysBulk = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.post('/admin/keys/bulk', { bulk_data: bulkData });
      setMessage('Bulk API Keys berhasil ditambahkan!');
      setShowBulkModal(false);
      setBulkData('');
      fetchKeys();
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal melakukan bulk import.');
    }
  };

  const handleToggleKey = async (id, currentStatus) => {
    setError('');
    setMessage('');
    try {
      const nextStatus = currentStatus === 1 ? 0 : 1;
      await api.put(`/admin/keys/${id}/toggle`, { is_active: nextStatus });
      fetchKeys();
    } catch (err) {
      setError('Gagal mengubah status API Key.');
    }
  };

  const handleDeleteKey = async (id) => {
    if (!window.confirm('Yakin ingin menghapus API Key ini?')) return;
    try {
      await api.delete(`/admin/keys/${id}`);
      setMessage('API Key berhasil dihapus.');
      fetchKeys();
    } catch (err) {
      setError('Gagal menghapus API Key.');
    }
  };

  const handleSaveAiSettings = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setAiSaveLoading(true);
    try {
      await api.put('/admin/ai-settings', { endpoint: aiEndpoint, api_key: aiApiKey, model: aiModel });
      setMessage('Pengaturan AI berhasil disimpan!');
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menyimpan pengaturan AI.');
    } finally {
      setAiSaveLoading(false);
    }
  };

  const handleTestAiSettings = async () => {
    setError('');
    setMessage('');
    setAiTestLoading(true);
    try {
      const res = await api.post('/admin/ai-settings/test', { endpoint: aiEndpoint, api_key: aiApiKey, model: aiModel });
      setMessage(res.data.message || 'Koneksi AI berhasil terautentikasi (200 OK).');
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || 'Koneksi ke Endpoint AI gagal.');
    } finally {
      setAiTestLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-grow flex flex-col items-center justify-center py-24">
        <Loader className="animate-spin text-[#cfae80] w-8 h-8 mb-4" />
        <span className="text-slate-400 text-[10px] font-bold tracking-widest uppercase">Memuat panel admin...</span>
      </div>
    );
  }

  return (
    <div className="p-3 md:p-8 space-y-4 md:space-y-6 animate-fadeIn font-sans relative">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-[#2a2725] pb-4">
        <div>
          <h1 className="text-xl md:text-3xl font-editorial italic text-white tracking-tight flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-[#cfae80]" />
            Panel Kontrol Admin
          </h1>
          <p className="text-slate-400 text-[10px] md:text-xs mt-1.5 font-medium tracking-wide">
            Kelola pengguna aplikasi, kolam lisensi API Key Freebeat, dan konfigurasi AI eksternal.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/20 border border-red-500/25 text-red-300 p-4 rounded-2xl text-xs">
          {error}
        </div>
      )}

      {message && (
        <div className="bg-green-950/20 border border-green-500/25 text-green-300 p-4 rounded-2xl text-xs">
          {message}
        </div>
      )}

      {/* Tabs Layout */}
      <div className="flex border-b border-[#2a2725] overflow-x-auto scrollbar-none">
        <button
          onClick={() => { setActiveTab('users'); setError(''); setMessage(''); }}
          className={`py-2.5 px-3.5 flex items-center font-bold text-[9px] uppercase tracking-wider border-b-2 transition-all shrink-0 relative ${
            activeTab === 'users'
              ? 'border-[#cfae80] text-white'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Users className="w-3.5 h-3.5 mr-1.5" />
          Manajemen User ({users.length})
        </button>
        <button
          onClick={() => { setActiveTab('keys'); setError(''); setMessage(''); }}
          className={`py-2.5 px-3.5 flex items-center font-bold text-[9px] uppercase tracking-wider border-b-2 transition-all shrink-0 relative ${
            activeTab === 'keys'
              ? 'border-[#cfae80] text-white'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Key className="w-3.5 h-3.5 mr-1.5" />
          Kolam API Key ({keys.length})
        </button>
        <button
          onClick={() => { setActiveTab('ai-settings'); setError(''); setMessage(''); }}
          className={`py-2.5 px-3.5 flex items-center font-bold text-[9px] uppercase tracking-wider border-b-2 transition-all shrink-0 relative ${
            activeTab === 'ai-settings'
              ? 'border-[#cfae80] text-white'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 mr-1.5" />
          Pengaturan AI
        </button>
        <button
          onClick={() => { setActiveTab('files'); setError(''); setMessage(''); }}
          className={`py-2.5 px-3.5 flex items-center font-bold text-[9px] uppercase tracking-wider border-b-2 transition-all shrink-0 relative ${
            activeTab === 'files'
              ? 'border-[#cfae80] text-white'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
          File Manager ({files.length})
        </button>
      </div>

      {/* Content Area */}
      {activeTab === 'users' && (
        <div className="bg-[#1a1918]/60 border border-[#2a2725] rounded-2xl p-4 md:p-6 relative backdrop-blur-md">
          <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/25 to-transparent"></div>
          
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-[9px] font-bold text-white uppercase tracking-widest">Daftar Pengguna Aktif</h3>
            <button
              onClick={() => setShowAddUserModal(true)}
              className="bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-1.5 px-3 rounded-lg flex items-center transition-all shadow-lg text-[9px] uppercase tracking-wider cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Tambah User
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#2a2725] text-slate-400 text-[8.5px] font-bold uppercase tracking-wider">
                  <th className="py-2.5 px-3">ID</th>
                  <th className="py-2.5 px-3">Username</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Kredit Terpakai</th>
                  <th className="py-2.5 px-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222435] text-xs font-medium">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-white/[0.01] transition-colors">
                    <td className="py-2.5 px-3 text-slate-550 font-mono text-[11px]">{u.id}</td>
                    <td className="py-2.5 px-3 font-editorial italic text-white text-sm">{u.username}</td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-[8px] font-bold tracking-wider uppercase ${
                        u.role === 'admin' 
                          ? 'bg-red-950/20 text-red-350 border border-red-500/20' 
                          : 'bg-[#cfae80]/15 text-[#cfae80] border border-[#cfae80]/20'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[#cfae80] font-bold text-[11px]">
                      ⚡ {u.total_credits || 0}
                    </td>
                    <td className="py-2.5 px-3 text-right space-x-1.5 whitespace-nowrap">
                      <button
                        onClick={() => {
                          setEditUserId(u.id);
                          setEditUsername(u.username);
                          setEditRole(u.role);
                          setEditPassword('');
                          setShowEditUserModal(true);
                        }}
                        className="bg-[#cfae80] text-black hover:bg-[#c5a880] py-1 px-2 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteUser(u.id)}
                        className="bg-red-950/15 border border-red-500/20 hover:bg-red-650 hover:text-white text-red-400 py-1 px-2 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}      {activeTab === 'keys' && (
        <div className="bg-[#1a1918]/60 border border-[#2a2725] rounded-2xl p-4 md:p-6 relative backdrop-blur-md">
          <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/25 to-transparent"></div>
          
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-[9px] font-bold text-white uppercase tracking-widest">Kolam Kunci Lisensi Freebeat</h3>
            <div className="flex gap-1.5">
              <button
                onClick={() => setShowBulkModal(true)}
                className="bg-black/40 border border-[#2a2725] hover:bg-slate-850 text-slate-350 font-bold py-1.5 px-3 rounded-lg flex items-center transition-all text-[9px] uppercase tracking-wider cursor-pointer"
              >
                <Database className="w-3.5 h-3.5 mr-1 text-[#cfae80]" />
                Bulk Import
              </button>
              <button
                onClick={() => setShowAddKeyModal(true)}
                className="bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-1.5 px-3 rounded-lg flex items-center transition-all shadow-lg text-[9px] uppercase tracking-wider cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Tambah Key
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#2a2725] text-slate-400 text-[8.5px] font-bold uppercase tracking-wider">
                  <th className="py-2.5 px-3">Label</th>
                  <th className="py-2.5 px-3">Nilai Kunci</th>
                  <th className="py-2.5 px-3">Kredit Terpakai</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222435] text-xs font-medium">
                {keys.map((k) => (
                  <tr key={k.id} className="hover:bg-white/[0.01] transition-colors">
                    <td className="py-2.5 px-3 font-editorial italic text-white text-sm">{k.label}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-550 text-[11px]">{k.key_value.substring(0, 16)}••••••••</td>
                    <td className="py-2.5 px-3 font-mono text-[#cfae80] font-bold text-[11px]">
                      ⚡ {k.total_credits || 0}
                    </td>
                    <td className="py-2.5 px-3">
                      <button
                        onClick={() => handleToggleKey(k.id, k.is_active)}
                        className={`px-2 py-0.5 rounded text-[8px] font-bold tracking-wider uppercase border transition-all cursor-pointer ${
                          k.is_active === 1
                            ? 'bg-green-950/20 text-green-300 border-green-500/20 hover:bg-green-600 hover:text-white'
                            : 'bg-slate-900/40 text-slate-500 border-slate-800 hover:bg-slate-700 hover:text-white'
                        }`}
                      >
                        {k.is_active === 1 ? 'Aktif' : 'Nonaktif'}
                      </button>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => handleDeleteKey(k.id)}
                        className="bg-red-950/15 border border-red-500/20 hover:bg-red-650 hover:text-white text-red-400 py-1 px-2 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'ai-settings' && (
        <div className="bg-[#1a1918]/60 border border-[#2a2725] rounded-2xl p-4 md:p-6 relative backdrop-blur-md">
          <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/25 to-transparent"></div>
          
          <div className="mb-4 border-b border-[#2a2725] pb-3">
            <h3 className="text-sm font-editorial italic text-white mb-1">Pengaturan AI Provider</h3>
            <p className="text-slate-400 text-[8.5px] uppercase tracking-wider font-semibold">Konfigurasikan endpoint dan kunci akses untuk AI Prompt Assistant</p>
          </div>

          <form onSubmit={handleSaveAiSettings} className="space-y-4 max-w-2xl">
            <div>
              <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest mb-1">Model AI Antigravity</label>
              <select 
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-white text-xs font-semibold focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all"
              >
                <option value="gemini-3-flash">Gemini 3 Flash (Default/Cepat)</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                <option value="gemini-3.1-pro-high">Gemini 3.1 Pro High (Pintar/Akurat)</option>
                <option value="gemini-2.5-flash-thinking">Gemini 2.5 Flash Thinking (Penalaran Mendalam)</option>
                <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                <option value="gpt-oss-120b-medium">GPT OSS 120B Medium</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-355 text-[9px] font-bold uppercase tracking-widest mb-1">Local Proxy Endpoint</label>
              <input 
                type="text" 
                value={aiEndpoint}
                onChange={(e) => setAiEndpoint(e.target.value)}
                placeholder="http://localhost:8045/v1"
                className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-white placeholder-slate-700 focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest mb-1">Proxy API Key</label>
              <input 
                type="password" 
                value={aiApiKey}
                onChange={(e) => setAiApiKey(e.target.value)}
                placeholder="Masukkan API Key Proxy..."
                className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-white placeholder-slate-700 focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs font-mono"
                required
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t border-[#2a2725]">
              <button
                type="button"
                onClick={handleTestAiSettings}
                disabled={aiTestLoading || !aiEndpoint || !aiApiKey}
                className="bg-[#131211] hover:bg-[#1a1918] text-[#cfae80] font-bold py-2 px-3.5 rounded-lg transition-all border border-[#2a2725] text-[9px] uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {aiTestLoading ? <Loader className="animate-spin w-3.5 h-3.5" /> : 'Check Auth (Generic Test)'}
              </button>
              
              <button
                type="submit"
                disabled={aiSaveLoading}
                className="bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-2 px-3.5 rounded-lg transition-all text-[9px] uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {aiSaveLoading ? <Loader className="animate-spin w-3.5 h-3.5" /> : 'Simpan Pengaturan AI'}
              </button>
            </div>
          </form>
        </div>
      )}

      {activeTab === 'files' && (
        <div className="bg-[#1a1918]/60 border border-[#2a2725] rounded-2xl p-4 md:p-6 relative backdrop-blur-md">
          <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/25 to-transparent"></div>
          
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4 border-b border-[#2a2725]/60 pb-3">
            <div>
              <h3 className="text-[10px] font-bold text-white uppercase tracking-widest flex items-center gap-1.5">
                <HardDrive className="w-4 h-4 text-[#cfae80]" />
                Manajemen File Penyimpanan Server
              </h3>
              <p className="text-[8.5px] text-slate-400 font-semibold uppercase tracking-wider mt-1">
                Total File: {files.length} • Total Ukuran: {(files.reduce((acc, f) => acc + f.sizeBytes, 0) / (1024 * 1024)).toFixed(2)} MB
              </p>
            </div>
            
            <div className="flex flex-wrap gap-2 w-full md:w-auto justify-end items-center">
              {/* Limit selector */}
              <div className="flex items-center gap-1.5 bg-black/40 border border-[#2a2725] px-2.5 py-1.5 rounded-lg select-none">
                <span className="text-[7.5px] font-bold text-slate-400 uppercase tracking-widest">Show:</span>
                <select
                  value={itemsPerPage}
                  onChange={(e) => { setItemsPerPage(parseInt(e.target.value)); setCurrentPage(1); }}
                  className="bg-transparent text-white text-[9px] font-bold focus:outline-none cursor-pointer"
                >
                  <option value="10" className="bg-[#1a1918]">10</option>
                  <option value="20" className="bg-[#1a1918]">20</option>
                  <option value="30" className="bg-[#1a1918]">30</option>
                  <option value="50" className="bg-[#1a1918]">50</option>
                  <option value="100" className="bg-[#1a1918]">100</option>
                  <option value="200" className="bg-[#1a1918]">200</option>
                </select>
              </div>

              {/* Sort selector */}
              <div className="flex items-center gap-1.5 bg-black/40 border border-[#2a2725] px-2.5 py-1.5 rounded-lg select-none">
                <span className="text-[7.5px] font-bold text-slate-400 uppercase tracking-widest">Urut:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="bg-transparent text-white text-[9px] font-bold focus:outline-none cursor-pointer"
                >
                  <option value="date_desc" className="bg-[#1a1918]">Terbaru</option>
                  <option value="date_asc" className="bg-[#1a1918]">Terlama</option>
                  <option value="size_desc" className="bg-[#1a1918]">Ukuran Terbesar</option>
                  <option value="size_asc" className="bg-[#1a1918]">Ukuran Terkecil</option>
                  <option value="name_asc" className="bg-[#1a1918]">Nama A-Z</option>
                  <option value="name_desc" className="bg-[#1a1918]">Nama Z-A</option>
                  <option value="download_desc" className="bg-[#1a1918]">Terbanyak Terunduh</option>
                </select>
              </div>

              {/* Select All Global */}
              <button
                type="button"
                onClick={() => {
                  if (selectedFiles.length === files.length) {
                    setSelectedFiles([]);
                  } else {
                    setSelectedFiles(files.map(f => f.path));
                  }
                }}
                className="bg-black/40 border border-[#2a2725] hover:bg-[#cfae80] hover:text-black text-slate-350 font-bold py-1.5 px-3 rounded-lg flex items-center transition-all text-[8.5px] uppercase tracking-wider cursor-pointer select-none"
              >
                {selectedFiles.length === files.length ? 'Batal Centang' : `Centang Semua (${files.length})`}
              </button>

              {selectedFiles.length > 0 && (
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  className="bg-red-950/20 hover:bg-red-650 border border-red-500/25 hover:text-white text-red-400 font-bold py-1.5 px-3 rounded-lg flex items-center transition-all text-[8.5px] uppercase tracking-wider cursor-pointer gap-1.5 select-none"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Hapus Terpilih ({selectedFiles.length})
                </button>
              )}
              <button
                type="button"
                onClick={fetchFiles}
                className="bg-black/40 border border-[#2a2725] hover:bg-[#cfae80] hover:text-black text-slate-350 font-bold py-1.5 px-3 rounded-lg flex items-center transition-all text-[8.5px] uppercase tracking-wider cursor-pointer gap-1 select-none"
              >
                🔄 Refresh List
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            {(() => {
              // Apply local sorting
              const sortedFiles = [...files].sort((a, b) => {
                if (sortBy === 'date_desc') return new Date(b.createdAt) - new Date(a.createdAt);
                if (sortBy === 'date_asc') return new Date(a.createdAt) - new Date(b.createdAt);
                if (sortBy === 'size_desc') return b.sizeBytes - a.sizeBytes;
                if (sortBy === 'size_asc') return a.sizeBytes - b.sizeBytes;
                if (sortBy === 'name_asc') return a.name.localeCompare(b.name);
                if (sortBy === 'name_desc') return b.name.localeCompare(a.name);
                if (sortBy === 'download_desc') return b.downloadCount - a.downloadCount;
                return 0;
              });

              const totalPages = Math.ceil(sortedFiles.length / itemsPerPage);
              const paginatedFiles = sortedFiles.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
              const isAllSelected = paginatedFiles.length > 0 && paginatedFiles.every(f => selectedFiles.includes(f.path));
              
              const toggleSelectAll = () => {
                if (isAllSelected) {
                  const pagePaths = paginatedFiles.map(f => f.path);
                  setSelectedFiles(prev => prev.filter(p => !pagePaths.includes(p)));
                } else {
                  const pagePaths = paginatedFiles.map(f => f.path);
                  setSelectedFiles(prev => [...new Set([...prev, ...pagePaths])]);
                }
              };

              const toggleSelectFile = (path) => {
                setSelectedFiles(prev => 
                  prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]
                );
              };

              return (
                <>
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#2a2725] text-slate-400 text-[8.5px] font-bold uppercase tracking-wider">
                        <th className="py-2.5 px-3 w-8">
                          <input 
                            type="checkbox" 
                            checked={isAllSelected}
                            onChange={toggleSelectAll}
                            className="rounded border-[#2a2725] bg-black text-[#cfae80] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer"
                          />
                        </th>
                        <th className="py-2.5 px-3 w-16 text-center">Pratinjau</th>
                        <th className="py-2.5 px-3">Nama File / Tipe</th>
                        <th className="py-2.5 px-3">Path URL</th>
                        <th className="py-2.5 px-3">Ukuran</th>
                        <th className="py-2.5 px-3">Status Unduhan</th>
                        <th className="py-2.5 px-3">Dibuat Pada</th>
                        <th className="py-2.5 px-3 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#222435] text-xs font-medium">
                      {paginatedFiles.length === 0 ? (
                        <tr>
                          <td colSpan="8" className="py-8 text-center text-slate-500 italic text-[10px] uppercase tracking-wider">
                            Tidak ada file penyimpanan yang terdeteksi
                          </td>
                        </tr>
                      ) : (
                        paginatedFiles.map((f, idx) => {
                          const isVideo = f.name.toLowerCase().endsWith('.mp4');
                          const isMerged = f.name.toLowerCase().startsWith('merged_');
                          const fileTypeBadge = isMerged 
                            ? 'bg-purple-950/20 text-purple-300 border border-purple-500/20'
                            : isVideo 
                            ? 'bg-[#cfae80]/15 text-[#cfae80] border border-[#cfae80]/20'
                            : 'bg-blue-950/20 text-blue-300 border border-blue-500/20';

                          return (
                            <tr key={f.path} className="hover:bg-white/[0.01] transition-colors">
                              {/* Checkbox */}
                              <td className="py-2.5 px-3">
                                <input 
                                  type="checkbox" 
                                  checked={selectedFiles.includes(f.path)}
                                  onChange={() => toggleSelectFile(f.path)}
                                  className="rounded border-[#2a2725] bg-black text-[#cfae80] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer"
                                />
                              </td>
                              
                              {/* Preview / Thumbnail */}
                              <td className="py-2.5 px-3 text-center">
                                <div className="relative w-12 h-12 bg-black/60 rounded-xl overflow-hidden border border-[#2a2725] group flex items-center justify-center shrink-0 shadow-lg mx-auto">
                                  {isVideo ? (
                                    <video 
                                      src={getFullFileUrl(f.path)} 
                                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                                      muted 
                                      preload="metadata"
                                      playsInline
                                    />
                                  ) : (
                                    <img 
                                      src={getFullFileUrl(f.path)} 
                                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110" 
                                      alt="preview"
                                      onError={(e) => { e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%23cfae80" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>' }}
                                    />
                                  )}
                                </div>
                              </td>

                              {/* Details */}
                              <td className="py-2.5 px-3">
                                <div className="flex flex-col gap-0.5 max-w-[200px]">
                                  <span className="text-white text-xs font-semibold break-all leading-tight">{f.name}</span>
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className={`px-1.5 py-0.5 rounded text-[7px] font-bold tracking-wider uppercase ${fileTypeBadge}`}>
                                      {isMerged ? 'Merged Video' : isVideo ? 'Video Clip' : 'Image/Asset'}
                                    </span>
                                  </div>
                                </div>
                              </td>

                              <td className="py-2.5 px-3 font-mono text-[10px] text-slate-400 break-all select-all">
                                {f.path}
                              </td>

                              <td className="py-2.5 px-3 font-mono text-white text-[11px] font-bold whitespace-nowrap">
                                {f.sizeMb}
                              </td>

                              <td className="py-2.5 px-3">
                                {f.isDownloaded ? (
                                  <span className="inline-flex items-center gap-1 bg-green-950/20 text-green-300 border border-green-500/20 px-2 py-0.5 rounded text-[8px] font-bold tracking-wider uppercase">
                                    <Check className="w-2.5 h-2.5" /> Terunduh ({f.downloadCount}x)
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 bg-slate-900/40 text-slate-500 border border-slate-800 px-2 py-0.5 rounded text-[8px] font-bold tracking-wider uppercase">
                                    Belum Diunduh
                                  </span>
                                )}
                              </td>

                              <td className="py-2.5 px-3 font-mono text-[10px] text-slate-400 whitespace-nowrap">
                                {new Date(f.createdAt).toLocaleString('id-ID', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </td>

                              <td className="py-2.5 px-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteFile(f.path)}
                                  className="bg-red-950/15 border border-red-500/20 hover:bg-red-650 hover:text-white text-red-400 py-1.5 px-2.5 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer inline-flex items-center gap-1"
                                >
                                  <Trash2 className="w-2.5 h-2.5" /> Hapus
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>

                  {/* Pagination Section */}
                  {totalPages > 1 && (
                    <div className="flex flex-wrap justify-center items-center gap-1.5 pt-4 border-t border-[#2a2725]/60 mt-4">
                      <button
                        type="button"
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        className="px-2.5 py-1.5 text-[9px] bg-black/40 hover:bg-[#cfae80] hover:text-black border border-[#2a2725] rounded-xl text-slate-350 disabled:opacity-20 font-bold transition-all cursor-pointer uppercase tracking-wider"
                      >
                        Sebelumnya
                      </button>
                      
                      {Array.from({ length: totalPages }).map((_, idx) => {
                        const pageNum = idx + 1;
                        return (
                          <button
                            type="button"
                            key={pageNum}
                            onClick={() => setCurrentPage(pageNum)}
                            className={`w-7 h-7 text-[9px] font-bold border rounded-xl transition-all cursor-pointer ${
                              currentPage === pageNum
                                ? 'bg-[#cfae80] text-black border-[#cfae80]'
                                : 'bg-black/40 hover:bg-[#cfae80]/10 text-slate-400 border-[#2a2725]'
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}

                      <button
                        type="button"
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                        className="px-2.5 py-1.5 text-[9px] bg-black/40 hover:bg-[#cfae80] hover:text-black border border-[#2a2725] rounded-xl text-slate-350 disabled:opacity-20 font-bold transition-all cursor-pointer uppercase tracking-wider"
                      >
                        Berikutnya
                      </button>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* --- ADD USER MODAL --- */}
      {showAddUserModal && createPortal(
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-start md:items-center justify-center p-4 py-8 md:py-8 z-50 overflow-y-auto animate-fadeIn"
          onClick={() => setShowAddUserModal(false)}
        >
          <div 
            className="relative max-w-md w-full bg-[#1a1918] border border-[#2a2725] rounded-3xl p-8 shadow-2xl my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/25 to-transparent"></div>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-md font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-[#cfae80]" />
                Tambah Anggota Baru
              </h3>
              <button onClick={() => setShowAddUserModal(false)} className="text-slate-400 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-slate-350 text-[10px] font-bold uppercase tracking-widest mb-2">Username</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full bg-black/40 border border-[#2a2725] rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-sm"
                  placeholder="Masukkan nama pengguna"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-350 text-[10px] font-bold uppercase tracking-widest mb-2">Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-black/40 border border-[#2a2725] rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-sm"
                  placeholder="Masukkan sandi masuk"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-350 text-[10px] font-bold uppercase tracking-widest mb-2">Hak Akses</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="w-full bg-black/40 border border-[#2a2725] rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-[#cfae80] transition-all text-xs"
                >
                  <option value="user">User Biasa</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div className="flex gap-3 justify-end pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="bg-black/40 border border-[#2a2725] hover:bg-slate-850 text-slate-300 py-3 px-5 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-3 px-6 rounded-2xl transition-all shadow-lg text-xs uppercase tracking-widest"
                >
                  Buat User
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* --- EDIT USER MODAL --- */}
      {showEditUserModal && createPortal(
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-start md:items-center justify-center p-4 py-8 md:py-8 z-50 overflow-y-auto animate-fadeIn"
          onClick={() => setShowEditUserModal(false)}
        >
          <div 
            className="relative max-w-md w-full bg-[#1a1918] border border-[#2a2725] rounded-3xl p-8 shadow-2xl my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/25 to-transparent"></div>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-md font-bold text-white uppercase tracking-wider">Perbarui Data Anggota</h3>
              <button onClick={() => setShowEditUserModal(false)} className="text-slate-400 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateUser} className="space-y-4">
              <div>
                <label className="block text-slate-350 text-[10px] font-bold uppercase tracking-widest mb-2">Username</label>
                <input
                  type="text"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  className="w-full bg-black/40 border border-[#2a2725] rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-350 text-[10px] font-bold uppercase tracking-widest mb-2">Password Baru (Opsional)</label>
                <input
                  type="password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  className="w-full bg-black/40 border border-[#2a2725] rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-sm"
                  placeholder="Isi jika ingin mengganti password"
                />
              </div>

              <div>
                <label className="block text-slate-355 text-[10px] font-bold uppercase tracking-widest mb-2">Hak Akses</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="w-full bg-black/40 border border-[#2a2725] rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-[#cfae80] transition-all text-xs"
                >
                  <option value="user">User Biasa</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div className="flex gap-3 justify-end pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditUserModal(false)}
                  className="bg-black/40 border border-[#2a2725] hover:bg-slate-850 text-slate-300 py-3 px-5 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-3 px-6 rounded-2xl transition-all shadow-lg text-xs uppercase tracking-widest"
                >
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* --- ADD API KEY MODAL --- */}
      {showAddKeyModal && createPortal(
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-start md:items-center justify-center p-4 py-8 md:py-8 z-50 overflow-y-auto animate-fadeIn"
          onClick={() => setShowAddKeyModal(false)}
        >
          <div 
            className="relative max-w-md w-full bg-[#1a1918] border border-[#2a2725] rounded-3xl p-8 shadow-2xl my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/25 to-transparent"></div>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-md font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Key className="w-5 h-5 text-[#cfae80]" />
                Tambah API Key
              </h3>
              <button onClick={() => setShowAddKeyModal(false)} className="text-slate-400 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddKey} className="space-y-4">
              <div>
                <label className="block text-slate-350 text-[10px] font-bold uppercase tracking-widest mb-2">Label Key</label>
                <input
                  type="text"
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  className="w-full bg-black/40 border border-[#2a2725] rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-sm"
                  placeholder="Masukkan label (misal: Key 1)"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-350 text-[10px] font-bold uppercase tracking-widest mb-2">Nilai API Key Freebeat</label>
                <input
                  type="password"
                  value={newKeyVal}
                  onChange={(e) => setNewKeyVal(e.target.value)}
                  className="w-full bg-black/40 border border-[#2a2725] rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-sm font-mono"
                  placeholder="Masukkan nilai token Freebeat..."
                  required
                />
              </div>

              <div className="flex gap-3 justify-end pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddKeyModal(false)}
                  className="bg-black/40 border border-[#2a2725] hover:bg-slate-850 text-slate-300 py-3 px-5 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-3 px-6 rounded-2xl transition-all shadow-lg text-xs uppercase tracking-widest"
                >
                  Tambah Key
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* --- BULK IMPORT MODAL --- */}
      {showBulkModal && createPortal(
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-start md:items-center justify-center p-4 py-8 md:py-8 z-50 overflow-y-auto animate-fadeIn"
          onClick={() => setShowBulkModal(false)}
        >
          <div 
            className="relative max-w-lg w-full bg-[#1a1918] border border-[#2a2725] rounded-3xl p-8 shadow-2xl my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/25 to-transparent"></div>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-md font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Database className="w-5 h-5 text-[#cfae80]" />
                Bulk Import API Keys
              </h3>
              <button onClick={() => setShowBulkModal(false)} className="text-slate-400 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddKeysBulk} className="space-y-4">
              <div>
                <label className="block text-slate-350 text-[10px] font-bold uppercase tracking-widest mb-2">
                  Masukkan Data Lisensi (1 key per baris atau format CSV label,key_value)
                </label>
                <textarea
                  value={bulkData}
                  onChange={(e) => setBulkData(e.target.value)}
                  rows={8}
                  className="w-full bg-black/40 border border-[#2a2725] rounded-2xl px-4 py-3 text-white placeholder-slate-700 focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs font-mono resize-none"
                  placeholder="Contoh format:&#10;Key 1,freebeat_api_key_value_1&#10;Key 2,freebeat_api_key_value_2"
                  required
                />
              </div>

              <div className="flex gap-3 justify-end pt-4">
                <button
                  type="button"
                  onClick={() => setShowBulkModal(false)}
                  className="bg-black/40 border border-[#2a2725] hover:bg-slate-850 text-slate-300 py-3 px-5 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-3 px-6 rounded-2xl transition-all shadow-lg text-xs uppercase tracking-widest"
                >
                  Mulai Import
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
