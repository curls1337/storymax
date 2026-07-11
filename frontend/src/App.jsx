import React, { useState, useEffect } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Generator from './pages/Generator';
import Settings from './pages/Settings';
import AdminPanel from './pages/AdminPanel';
import { Home, Sparkles, Settings as SettingsIcon, ShieldAlert, LogOut, Loader, User, Zap } from 'lucide-react';
import api from './utils/api';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);

  const fetchProfile = async () => {
    try {
      const res = await api.get('/auth/me');
      setUser(res.data);
      localStorage.setItem('user', JSON.stringify(res.data));
    } catch (err) {
      console.error('Sesi tidak valid, keluar...');
      handleLogout();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchProfile();
    } else {
      setLoading(false);
    }
  }, [token]);

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    setToken(localStorage.getItem('token'));
    setTab('dashboard');
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setTab('dashboard');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-darkBg flex items-center justify-center relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-royalPurple opacity-20 rounded-full blur-[120px] animate-pulseGlow"></div>
        <div className="flex flex-col items-center gap-4 relative z-10">
          <Loader className="animate-spin text-royalPurple w-12 h-12" />
          <span className="text-gray-400 text-sm font-semibold tracking-wide">Memuat Sesi...</span>
        </div>
      </div>
    );
  }

  // Auth Guard
  if (!token || !user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="flex h-screen bg-darkBg text-slate-100 overflow-hidden relative font-sans">
      {/* Background ambient glowing orbs */}
      <div className="absolute top-[-10%] right-[-10%] w-[550px] h-[550px] bg-[#cfae80] opacity-[0.05] rounded-full blur-[150px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] left-[-10%] w-[550px] h-[550px] bg-[#8c827a] opacity-[0.03] rounded-full blur-[150px] pointer-events-none"></div>

      {/* SIDEBAR PANEL */}
      <aside className="w-64 bg-[#1a1918]/90 border-r border-[#2a2725] flex flex-col justify-between h-full shrink-0 relative z-20 backdrop-blur-md overflow-y-auto">
        <div>
          {/* Logo Brand */}
          <div className="p-6 border-b border-[#2a2725] flex items-center justify-between">
            <h2 className="text-2xl font-editorial italic text-white flex items-center gap-2 select-none lowercase">
              <Zap className="w-5 h-5 text-[#cfae80] fill-[#cfae80]/15" />
              <span>story<span className="text-[#cfae80] font-normal">max</span></span>
            </h2>
            <span className="px-2 py-0.5 rounded bg-[#cfae80]/10 text-[#cfae80] text-[8px] font-bold tracking-widest uppercase border border-[#cfae80]/20">
              PRO
            </span>
          </div>

          {/* Navigation Menus */}
          <nav className="p-5 space-y-3">
            <button
              onClick={() => setTab('dashboard')}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-lg text-[10px] font-semibold tracking-widest uppercase transition-all duration-350 border ${
                tab === 'dashboard'
                  ? 'text-white bg-[#cfae80]/5 border-[#cfae80]/30'
                  : 'text-slate-400 hover:text-white border-transparent hover:bg-white/[0.01]'
              }`}
            >
              <span className="flex items-center gap-3">
                <Home className="w-3.5 h-3.5 text-[#cfae80]" />
                Dashboard
              </span>
              {tab === 'dashboard' && <div className="w-1.5 h-1.5 rounded-full bg-[#cfae80] shadow-sm shadow-[#cfae80]"></div>}
            </button>

            <button
              onClick={() => setTab('generator')}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-lg text-[10px] font-semibold tracking-widest uppercase transition-all duration-350 border ${
                tab === 'generator'
                  ? 'text-white bg-[#cfae80]/5 border-[#cfae80]/30'
                  : 'text-slate-400 hover:text-white border-transparent hover:bg-white/[0.01]'
              }`}
            >
              <span className="flex items-center gap-3">
                <Sparkles className="w-3.5 h-3.5 text-[#cfae80]" />
                AI Generator
              </span>
              {tab === 'generator' && <div className="w-1.5 h-1.5 rounded-full bg-[#cfae80] shadow-sm shadow-[#cfae80]"></div>}
            </button>

            <button
              onClick={() => setTab('settings')}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-lg text-[10px] font-semibold tracking-widest uppercase transition-all duration-350 border ${
                tab === 'settings'
                  ? 'text-white bg-[#cfae80]/5 border-[#cfae80]/30'
                  : 'text-slate-400 hover:text-white border-transparent hover:bg-white/[0.01]'
              }`}
            >
              <span className="flex items-center gap-3">
                <SettingsIcon className="w-3.5 h-3.5 text-[#cfae80]" />
                Pengaturan
              </span>
              {tab === 'settings' && <div className="w-1.5 h-1.5 rounded-full bg-[#cfae80] shadow-sm shadow-[#cfae80]"></div>}
            </button>

            {/* Admin Panel Link */}
            {user.role === 'admin' && (
              <button
                onClick={() => setTab('admin')}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-lg text-[10px] font-semibold tracking-widest uppercase transition-all duration-350 border relative ${
                  tab === 'admin'
                    ? 'text-white bg-red-950/10 border-red-500/30'
                    : 'border-transparent text-red-400/80 hover:bg-red-950/5 hover:text-red-300'
                }`}
              >
                <span className="flex items-center gap-3">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Panel Admin
                </span>
                {tab === 'admin' && <div className="w-1.5 h-1.5 rounded-full bg-red-400"></div>}
              </button>
            )}
          </nav>
        </div>

        {/* Footer Profile Info */}
        <div className="p-5 border-t border-[#2a2725] bg-[#1a1918]/60">
          <div className="flex items-center gap-3 mb-4 p-2 rounded-xl bg-white/[0.01] border border-[#2a2725]">
            <div className="bg-[#cfae80]/15 p-2 rounded-lg text-[#cfae80] border border-[#cfae80]/20">
              <User className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0 flex-grow">
              <p className="font-editorial italic text-sm text-slate-100 truncate">{user.username}</p>
              <p className="text-[8px] text-[#cfae80] font-bold uppercase tracking-widest">
                {user.role}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 border border-[#2a2725] hover:border-red-500/35 hover:text-red-400 text-slate-400 text-[9px] font-bold uppercase tracking-widest rounded-xl transition-all duration-200 hover:bg-red-950/5"
          >
            <LogOut className="w-3.5 h-3.5" />
            Keluar Sesi
          </button>
        </div>
      </aside>

      {/* MAIN VIEW AREA */}
      <main className="flex-grow overflow-y-auto bg-darkBg relative z-10">
        <div className="w-full min-h-full flex flex-col justify-start px-6 md:px-8">
          {tab === 'dashboard' && <Dashboard setTab={setTab} />}
          {tab === 'generator' && <Generator />}
          {tab === 'settings' && <Settings onLogout={handleLogout} />}
          {tab === 'admin' && user.role === 'admin' && <AdminPanel />}
        </div>
      </main>
    </div>
  );
}
