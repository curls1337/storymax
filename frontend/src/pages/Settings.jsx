import React, { useState } from 'react';
import api from '../utils/api';
import { Lock, LogOut, Loader, KeyRound, ShieldAlert, CheckCircle2 } from 'lucide-react';

export default function Settings({ onLogout }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (newPassword !== confirmPassword) {
      setError('Password baru dan konfirmasi password tidak cocok.');
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/change-password', { oldPassword, newPassword });
      setMessage('Password Anda berhasil diperbarui!');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal mengubah password. Pastikan password lama benar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-3 md:p-8 max-w-4xl space-y-4 md:space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="bg-[#1a1918]/60 border border-[#2a2725] p-4 md:p-6 rounded-2xl md:rounded-3xl backdrop-blur-md relative">
        <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/25 to-transparent"></div>
        <h1 className="text-xl md:text-3xl font-editorial italic text-white tracking-tight">Pengaturan Akun</h1>
        <p className="text-slate-400 text-[10px] md:text-xs mt-1.5 font-medium tracking-wide">
          Kelola kredensial keamanan akun Anda atau keluar dari sesi aplikasi.
        </p>
      </div>

      <div className="space-y-4 md:space-y-6">
        {/* Password Card */}
        <div className="bg-[#1a1918]/60 border border-[#2a2725] rounded-2xl p-4 md:p-6 relative backdrop-blur-md">
          <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/20 to-transparent"></div>
          
          <h3 className="text-[9px] font-bold text-white uppercase tracking-widest mb-4 flex items-center border-b border-[#2a2725] pb-2">
            <Lock className="w-3.5 h-3.5 mr-1.5 text-[#cfae80]" />
            Ganti Password Keamanan
          </h3>

          {error && (
            <div className="bg-red-950/20 border border-red-500/25 text-red-200 p-3 rounded-xl text-xs mb-4 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {message && (
            <div className="bg-green-950/20 border border-green-500/25 text-green-200 p-3 rounded-xl text-xs mb-4 flex items-start gap-2 animate-pulse">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[#cfae80] mt-0.5" />
              <span>{message}</span>
            </div>
          )}

          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div>
              <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest mb-1">Password Lama</label>
              <input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs"
                placeholder="Masukkan password saat ini"
                required
                disabled={loading}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-350 text-[9px] font-bold uppercase tracking-widest mb-1">Password Baru</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs"
                  placeholder="Password baru minimal 6 karakter"
                  required
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-slate-355 text-[9px] font-bold uppercase tracking-widest mb-1">Konfirmasi Password Baru</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-black/40 border border-[#2a2725] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-xs"
                  placeholder="Ulangi password baru"
                  required
                  disabled={loading}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-2.5 px-4 rounded-xl transition-all shadow-lg hover:shadow-[#cfae80]/10 text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader className="animate-spin w-3.5 h-3.5" />
                  Memperbarui...
                </>
              ) : (
                <>
                  <KeyRound className="w-3.5 h-3.5" />
                  Perbarui Password
                </>
              )}
            </button>
          </form>
        </div>

        {/* Logout Card */}
        <div className="bg-[#1a1918]/60 border border-[#2a2725] rounded-2xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 backdrop-blur-md relative">
          <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-red-500/10 to-transparent"></div>
          <div>
            <h4 className="font-editorial italic text-white text-md">Keluar dari Akun</h4>
            <p className="text-slate-400 text-[10px] mt-1 font-medium tracking-wide">
              Sesi Anda akan segera diakhiri dan dihapus dari perangkat ini.
            </p>
          </div>
          <button
            onClick={onLogout}
            className="border border-red-500/25 bg-red-950/10 hover:bg-red-650 hover:text-white text-red-400 font-bold py-2 px-3.5 rounded-lg transition-all text-[9px] uppercase tracking-wider flex items-center gap-1.5 shadow-md shrink-0 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Keluar Sesi
          </button>
        </div>
      </div>
    </div>
  );
}
