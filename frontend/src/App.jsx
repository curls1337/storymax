import React, { useState, useEffect, useRef } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Generator from './pages/Generator';
import Settings from './pages/Settings';
import AdminPanel from './pages/AdminPanel';
import { Home, Sparkles, Settings as SettingsIcon, ShieldAlert, LogOut, Loader, User, Zap, Menu, X } from 'lucide-react';
import api from './utils/api';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const mainRef = useRef(null);

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

  useEffect(() => {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    window.scrollTo(0, 0);
    if (document.body) document.body.scrollTop = 0;
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [tab]);

  const [pullDistance, setPullDistance] = useState(0);
  const touchStartRef = useRef({ x: 0, y: 0 });
  const isPullingRef = useRef(false);

  useEffect(() => {
    const mainEl = mainRef.current;
    if (!mainEl) return;

    const handleTouchStart = (e) => {
      if (mainEl.scrollTop === 0) {
        touchStartRef.current = {
          x: e.touches[0].screenX,
          y: e.touches[0].screenY
        };
        isPullingRef.current = true;
      }
    };

    const handleTouchMove = (e) => {
      if (!isPullingRef.current) return;
      const currentY = e.touches[0].screenY;
      const currentX = e.touches[0].screenX;
      const distY = currentY - touchStartRef.current.y;
      const distX = currentX - touchStartRef.current.x;

      if (distY > 0 && distY > Math.abs(distX)) {
        setPullDistance(Math.min(90, distY));
        if (e.cancelable) {
          e.preventDefault();
        }
      } else if (distY < 0) {
        isPullingRef.current = false;
        setPullDistance(0);
      }
    };

    const handleTouchEnd = () => {
      if (!isPullingRef.current) return;
      isPullingRef.current = false;
      if (pullDistance > 65) {
        window.location.reload();
      } else {
        setPullDistance(0);
      }
    };

    mainEl.addEventListener('touchstart', handleTouchStart, { passive: true });
    mainEl.addEventListener('touchmove', handleTouchMove, { passive: false });
    mainEl.addEventListener('touchend', handleTouchEnd);

    return () => {
      mainEl.removeEventListener('touchstart', handleTouchStart);
      mainEl.removeEventListener('touchmove', handleTouchMove);
      mainEl.removeEventListener('touchend', handleTouchEnd);
    };
  }, [pullDistance, loading]);

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
    <div className="flex flex-col lg:flex-row h-screen bg-darkBg text-slate-100 overflow-hidden relative font-sans">
      {/* Background ambient glowing orbs */}
      <div className="absolute top-[-10%] right-[-10%] w-[550px] h-[550px] bg-[#cfae80] opacity-[0.05] rounded-full blur-[150px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] left-[-10%] w-[550px] h-[550px] bg-[#8c827a] opacity-[0.03] rounded-full blur-[150px] pointer-events-none"></div>

      {/* MOBILE HEADER */}
      <header className="lg:hidden bg-[#1a1918]/90 border-b border-[#2a2725] flex items-center justify-between px-6 pt-[env(safe-area-inset-top,0.75rem)] pb-3 z-20 backdrop-blur-md shrink-0">
        <h2 className="text-xl font-editorial italic text-white flex items-center gap-2 select-none lowercase">
          <Zap className="w-4 h-4 text-[#cfae80] fill-[#cfae80]/15" />
          <span>story<span className="text-[#cfae80] font-normal">max</span></span>
        </h2>
        <span className="px-2.5 py-0.5 rounded bg-[#cfae80]/10 text-[#cfae80] text-[8px] font-bold tracking-widest uppercase border border-[#cfae80]/20">
          PRO
        </span>
      </header>

      {/* SIDEBAR PANEL (Only on desktop) */}
      <aside className="hidden lg:flex flex-col w-64 bg-[#1a1918] border-r border-[#2a2725] justify-between h-full z-20 shrink-0 bg-[#1a1918]/90">
        <div className="relative">
          {/* Logo Brand */}
          <div className="p-6 border-b border-[#2a2725] flex items-center justify-between">
            <h2 className="text-2xl font-editorial italic text-white flex items-center gap-2 select-none lowercase">
              <Zap className="w-5 h-5 text-[#cfae80] fill-[#cfae80]/15" />
              <span>story<span className="text-[#cfae80] font-normal">max</span></span>
            </h2>
            <span className="px-2.5 py-0.5 rounded bg-[#cfae80]/10 text-[#cfae80] text-[8px] font-bold tracking-widest uppercase border border-[#cfae80]/20">
              PRO
            </span>
          </div>

          {/* Navigation Menus */}
          <nav className="p-5 space-y-3">
            <button
              onClick={() => { setTab('dashboard'); setSidebarOpen(false); }}
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
              onClick={() => { setTab('generator'); setSidebarOpen(false); }}
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
              onClick={() => { setTab('settings'); setSidebarOpen(false); }}
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
                onClick={() => { setTab('admin'); setSidebarOpen(false); }}
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
            onClick={() => { handleLogout(); setSidebarOpen(false); }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 border border-[#2a2725] hover:border-red-500/35 hover:text-red-400 text-slate-400 text-[9px] font-bold uppercase tracking-widest rounded-xl transition-all duration-200 hover:bg-red-950/5"
          >
            <LogOut className="w-3.5 h-3.5" />
            Keluar Sesi
          </button>
        </div>
      </aside>

      <main ref={mainRef} className="flex-grow h-full min-h-0 overflow-y-auto bg-darkBg pb-20 lg:pb-0 relative">
        {/* Pull to refresh indicator */}
        {pullDistance > 0 && (
          <div 
            style={{ transform: `translateY(${pullDistance - 55}px)`, opacity: Math.min(1, pullDistance / 60) }}
            className="absolute top-4 left-1/2 -translate-x-1/2 bg-[#1a1918]/90 border border-[#cfae80]/30 p-2.5 rounded-full z-50 transition-transform duration-75 flex items-center justify-center shadow-2xl backdrop-blur-md"
          >
            <Loader className={`w-4 h-4 text-[#cfae80] ${pullDistance > 65 ? 'animate-spin' : ''}`} />
          </div>
        )}
        <div className="w-full min-h-full flex flex-col justify-start px-4 sm:px-6 md:px-8 py-6 md:py-8">
          {tab === 'dashboard' && <Dashboard setTab={setTab} />}
          {tab === 'generator' && <Generator setTab={setTab} />}
          {tab === 'settings' && <Settings onLogout={handleLogout} />}
          {tab === 'admin' && user.role === 'admin' && <AdminPanel />}
        </div>
      </main>

      {/* MOBILE BOTTOM NAVIGATION BAR */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-[#1a1918]/95 border-t border-[#2a2725] flex items-center justify-around z-50 backdrop-blur-md pt-2.5 pb-[env(safe-area-inset-bottom,0.75rem)] shadow-lg">
        <button 
          onClick={() => setTab('dashboard')} 
          className={`flex flex-col items-center justify-center gap-1 w-16 py-1.5 transition-all duration-200 ${
            tab === 'dashboard' ? 'text-[#cfae80]' : 'text-slate-400'
          }`}
        >
          <Home className="w-4.5 h-4.5" />
          <span className="text-[7.5px] font-bold uppercase tracking-widest mt-0.5">Dash</span>
        </button>
        <button 
          onClick={() => setTab('generator')} 
          className={`flex flex-col items-center justify-center gap-1 w-16 py-1.5 transition-all duration-200 ${
            tab === 'generator' ? 'text-[#cfae80]' : 'text-slate-400'
          }`}
        >
          <Sparkles className="w-4.5 h-4.5" />
          <span className="text-[7.5px] font-bold uppercase tracking-widest mt-0.5">AI Gen</span>
        </button>
        <button 
          onClick={() => setTab('settings')} 
          className={`flex flex-col items-center justify-center gap-1 w-16 py-1.5 transition-all duration-200 ${
            tab === 'settings' ? 'text-[#cfae80]' : 'text-slate-400'
          }`}
        >
          <SettingsIcon className="w-4.5 h-4.5" />
          <span className="text-[7.5px] font-bold uppercase tracking-widest mt-0.5">Setting</span>
        </button>
        {user.role === 'admin' && (
          <button 
            onClick={() => setTab('admin')} 
            className={`flex flex-col items-center justify-center gap-1 w-16 py-1.5 transition-all duration-200 ${
              tab === 'admin' ? 'text-red-400' : 'text-slate-400'
            }`}
          >
            <ShieldAlert className="w-4.5 h-4.5" />
            <span className="text-[7.5px] font-bold uppercase tracking-widest mt-0.5">Admin</span>
          </button>
        )}
      </div>
    </div>
  );
}
