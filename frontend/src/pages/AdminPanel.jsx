import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import api from '../utils/api';
import { Users, Key, Plus, Trash2, ShieldAlert, Eye, EyeOff, Loader, Check, X, ShieldCheck, Terminal, UserPlus, Database, Sparkles } from 'lucide-react';

export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);

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

  const loadData = async () => {
    setLoading(true);
    await Promise.all([fetchUsers(), fetchKeys(), fetchAiSettings()]);
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
