import React, { useState } from 'react';
import { Zap, ShieldAlert, KeyRound, UserPlus, LogIn, Sparkles, Loader } from 'lucide-react';
import api from '../utils/api';

export default function Login({ onLoginSuccess }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (isRegister) {
        await api.post('/auth/register', { username, password });
        setMessage('Akun berhasil didaftarkan! Silakan masuk.');
        setIsRegister(false);
        setUsername('');
        setPassword('');
      } else {
        const res = await api.post('/auth/login', { username, password });
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        onLoginSuccess(res.data.user);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Terjadi kesalahan sistem. Silakan coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-darkBg flex items-center justify-center p-4 relative overflow-hidden font-sans select-none">
      {/* Background ambient glowing orbs */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-[#cfae80] opacity-[0.06] rounded-full blur-[160px] pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-[500px] h-[500px] bg-[#8c827a] opacity-[0.03] rounded-full blur-[160px] pointer-events-none"></div>

      <div className="w-full max-w-[430px] bg-[#1a1918]/80 backdrop-blur-md border border-[#2a2725] rounded-3xl p-8 md:p-10 shadow-2xl relative z-10 animate-fadeIn">
        <div className="absolute top-0 left-10 right-10 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/25 to-transparent"></div>

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-1 bg-white/[0.01] border border-[#2a2725] rounded-3xl mb-4 shadow-xl">
            <img src="/logo.png" alt="Storymax Logo" className="w-14 h-14 object-cover rounded-2xl border border-[#f5c242]/30" />
          </div>
          <h1 className="text-4xl font-editorial italic text-white mb-2.5 select-none">
            story<span className="text-[#cfae80] font-normal">max</span>
          </h1>
          <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest leading-relaxed">
            {isRegister ? 'Daftar Akun Baru' : 'AI Storyboard Workspace'}
          </p>
        </div>

        {error && (
          <div className="bg-red-950/20 border border-red-500/25 text-red-250 p-3.5 rounded-2xl text-xs mb-6 flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {message && (
          <div className="bg-green-950/20 border border-green-500/25 text-green-250 p-3.5 rounded-2xl text-xs mb-6 flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 shrink-0 text-[#cfae80] mt-0.5" />
            <span>{message}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-slate-350 text-[10px] font-bold uppercase tracking-widest mb-2">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-black/40 border border-[#2a2725] rounded-2xl px-4 py-3.5 text-white placeholder-slate-700 focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-sm"
              placeholder="Masukkan username"
              required
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-slate-355 text-[10px] font-bold uppercase tracking-widest mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black/40 border border-[#2a2725] rounded-2xl px-4 py-3.5 text-white placeholder-slate-700 focus:outline-none focus:border-[#cfae80] focus:ring-1 focus:ring-[#cfae80]/10 transition-all text-sm"
              placeholder="Masukkan password"
              required
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#cfae80] hover:bg-[#c5a880] text-black font-bold py-3.5 px-4 rounded-2xl transition-all shadow-lg hover:shadow-[#cfae80]/10 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-xs uppercase tracking-widest mt-6"
          >
            {loading ? (
              <Loader className="animate-spin w-4 h-4" />
            ) : isRegister ? (
              <>
                <UserPlus className="w-4 h-4" />
                Daftar Sekarang
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                Masuk Sesi
              </>
            )}
          </button>
        </form>

        <div className="text-center mt-8 pt-4 border-t border-[#2a2725]">
          <button
            onClick={() => {
              setIsRegister(!isRegister);
              setError('');
              setMessage('');
            }}
            className="text-slate-400 hover:text-[#cfae80] text-[10px] font-bold uppercase tracking-wider transition-colors focus:outline-none"
            disabled={loading}
          >
            {isRegister ? 'Sudah punya akun? Masuk' : 'Belum punya akun? Daftar'}
          </button>
        </div>
      </div>
    </div>
  );
}
