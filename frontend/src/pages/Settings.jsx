import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { Lock, LogOut, Loader, KeyRound, ShieldAlert, CheckCircle2, Sparkles, Cloud, Link2 } from 'lucide-react';

export default function Settings({ onLogout }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [preferredProvider, setPreferredProvider] = useState('freebeat');
  const [canUseMagica, setCanUseMagica] = useState(false);
  const [canUseScenario, setCanUseScenario] = useState(true);
  const [providerSaving, setProviderSaving] = useState(false);

  const [googleStatus, setGoogleStatus] = useState(null); // { appConfigured, connected, email, name, picture }
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleExports, setGoogleExports] = useState([]); // history of export spreadsheets

  useEffect(() => {
    api.get('/auth/me')
      .then((res) => {
        setCanUseMagica(!!res.data.can_use_magica);
        setCanUseScenario(res.data.can_use_scenario !== 0);
        setPreferredProvider(res.data.preferred_provider || 'freebeat');
      })
      .catch(() => {});
  }, []);

  const fetchGoogleStatus = async () => {
    try {
      const r = await api.get('/google/oauth/status');
      setGoogleStatus(r.data);
      if (r.data && r.data.connected) {
        try { const e = await api.get('/google/oauth/exports'); setGoogleExports(e.data || []); } catch (er) { setGoogleExports([]); }
      } else {
        setGoogleExports([]);
      }
    } catch (e) { setGoogleStatus(null); }
  };

  useEffect(() => {
    fetchGoogleStatus();
    // Surface the OAuth redirect result (?google=connected|error) then clean the URL.
    try {
      const p = new URLSearchParams(window.location.search);
      const g = p.get('google');
      if (g === 'connected') setMessage('Akun Google berhasil terhubung.');
      else if (g === 'error') setError('Gagal menghubungkan Google: ' + (p.get('reason') || 'error'));
      if (g) {
        p.delete('google'); p.delete('reason');
        const q = p.toString();
        window.history.replaceState({}, document.title, window.location.pathname + (q ? '?' + q : ''));
      }
    } catch (e) {}
  }, []);

  // While any export is still 'processing', poll so the list updates even after the
  // Dashboard tab that started it is closed — the job runs in the background on the server.
  useEffect(() => {
    const hasProcessing = (googleExports || []).some((e) => (e.status || '') === 'processing');
    if (!hasProcessing) return;
    const t = setInterval(fetchGoogleStatus, 4000);
    return () => clearInterval(t);
  }, [googleExports]);

  const handleConnectGoogle = async () => {
    setError(''); setMessage(''); setGoogleBusy(true);
    try { const r = await api.get('/google/oauth/url'); window.location.href = r.data.url; }
    catch (err) { setError(err.response?.data?.message || 'Gagal memulai koneksi Google.'); setGoogleBusy(false); }
  };

  const handleDisconnectGoogle = async () => {
    setError(''); setMessage(''); setGoogleBusy(true);
    try { await api.post('/google/oauth/disconnect'); await fetchGoogleStatus(); setMessage('Akun Google diputus.'); }
    catch (err) { setError('Gagal memutus akun Google.'); }
    finally { setGoogleBusy(false); }
  };

  const handleChangeProvider = async (provider) => {
    if (provider === preferredProvider) return;
    setError(''); setMessage(''); setProviderSaving(true);
    try {
      await api.put('/auth/preferred-provider', { provider });
      setPreferredProvider(provider);
      const name = provider === 'scenario' ? 'Scenario API' : (provider === 'magica' ? 'Magica' : 'Freebeat');
      setMessage('Provider berhasil diubah ke ' + name + '.');
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal mengubah provider.');
    } finally {
      setProviderSaving(false);
    }
  };

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
        {/* Provider Card - Freebeat & Magica hidden, Scenario active */}
        <div className="bg-[#1a1918]/60 border border-[#2a2725] rounded-2xl p-4 md:p-6 relative backdrop-blur-md">
          <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#38bdf8]/25 to-transparent"></div>
          <h3 className="text-[9px] font-bold text-white uppercase tracking-widest mb-1 flex items-center border-b border-[#2a2725] pb-2">
            <Sparkles className="w-3.5 h-3.5 mr-1.5 text-[#38bdf8]" />
            Provider AI Aktif
          </h3>
          <p className="text-slate-400 text-[10px] mt-2 mb-3 leading-relaxed">
            Layanan AI utama saat ini difokuskan pada Scenario AI untuk pembuatan gambar storyboard &amp; video.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-1 gap-3 max-w-sm">
            <div className="p-3.5 rounded-xl border border-[#38bdf8] bg-[#38bdf8]/10 shadow-[0_0_15px_rgba(56,189,248,0.15)] text-left">
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#38bdf8]" />
                Scenario AI
              </div>
              <div className="text-[9px] text-slate-400 mt-0.5">GPT Image / FLUX / Seedance Video</div>
              <div className="text-[8px] text-[#38bdf8] font-bold uppercase tracking-widest mt-2 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Aktif
              </div>
            </div>
          </div>
        </div>

        {/* Google Account Card (per-user cloud export) */}
        <div className="bg-[#1a1918]/60 border border-[#2a2725] rounded-2xl p-4 md:p-6 relative backdrop-blur-md">
          <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#22c55e]/25 to-transparent"></div>
          <h3 className="text-[9px] font-bold text-white uppercase tracking-widest mb-1 flex items-center border-b border-[#2a2725] pb-2">
            <Cloud className="w-3.5 h-3.5 mr-1.5 text-[#22c55e]" />
            Akun Google (Export ke Sheets)
          </h3>
          <p className="text-slate-400 text-[10px] mt-2 mb-3 leading-relaxed">
            Hubungkan akun Google Anda agar bisa export storyboard ke Google Sheets di Drive Anda sendiri, langsung dari Dashboard. Sheet dibuat sebagai editor (bisa diakses via link), bukan private.
          </p>
          {googleStatus && !googleStatus.appConfigured ? (
            <div className="bg-amber-950/20 border border-amber-500/30 text-amber-300 rounded-xl px-3 py-2 text-[10px]">
              Admin belum mengatur OAuth App Google. Silakan hubungi admin dulu.
            </div>
          ) : googleStatus && googleStatus.connected ? (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                {googleStatus.picture
                  ? <img src={googleStatus.picture} alt="" className="w-8 h-8 rounded-full border border-[#2a2725]" />
                  : <div className="w-8 h-8 rounded-full bg-[#22c55e]/20 flex items-center justify-center"><CheckCircle2 className="w-4 h-4 text-[#22c55e]" /></div>}
                <div className="min-w-0">
                  <p className="text-xs text-white font-semibold truncate">{googleStatus.name || 'Akun Google Terhubung'}</p>
                  <p className="text-[10px] text-slate-400 truncate">{googleStatus.email}</p>
                </div>
              </div>
              <button type="button" onClick={handleDisconnectGoogle} disabled={googleBusy} className="border border-red-500/25 bg-red-950/10 hover:bg-red-650 hover:text-white text-red-400 font-bold py-1.5 px-3 rounded-lg text-[9px] uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
                {googleBusy ? <Loader className="animate-spin w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />} Putuskan
              </button>
            </div>
          ) : (
            <button type="button" onClick={handleConnectGoogle} disabled={googleBusy} className="bg-[#22c55e] hover:bg-[#16a34a] text-black font-bold py-2 px-4 rounded-xl text-[10px] uppercase tracking-wider flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-lg">
              {googleBusy ? <Loader className="animate-spin w-3.5 h-3.5" /> : <Cloud className="w-3.5 h-3.5" />} Hubungkan Akun Google
            </button>
          )}

          {googleStatus && googleStatus.connected && (
            <div className="mt-3 border-t border-[#2a2725] pt-3">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-2">Riwayat Export <span className="text-slate-600 normal-case font-normal">— cloud (Buka) &amp; CSV (Download), berjalan di background</span></p>
              {googleExports.length === 0 ? (
                <p className="text-slate-500 text-[10px]">Belum ada. Export dari Dashboard — prosesnya jalan di background & muncul di sini.</p>
              ) : (
                <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                  {googleExports.map((ex) => {
                    const status = ex.status || 'success';
                    const isCloud = ex.type === 'cloud' || (!ex.type && !!ex.spreadsheet_url);
                    const typeLabel = ex.type === 'full' ? 'CSV Full' : (ex.type === 'csv' ? 'CSV' : 'Cloud');
                    return (
                      <div key={ex.id} className="flex items-center justify-between gap-2 bg-black/30 border border-[#2a2725] rounded-lg px-2.5 py-1.5">
                        <div className="min-w-0">
                          <p className="text-[10px] text-slate-200 truncate"><span className="text-[8px] font-bold uppercase tracking-wider text-slate-500 mr-1">[{typeLabel}]</span>{ex.title || 'Export'}</p>
                          <p className="text-[8.5px] text-slate-500 truncate">{(ex.total || ex.item_count || 0)} item{ex.created_at ? ' · ' + ex.created_at : ''}{status === 'failed' && ex.error ? ' · ' + ex.error : ''}</p>
                        </div>
                        <div className="shrink-0">
                          {status === 'processing' ? (
                            <span className="text-[9px] text-[#cfae80] font-bold uppercase tracking-wider flex items-center gap-1"><Loader className="animate-spin w-3 h-3" /> Diproses</span>
                          ) : status === 'failed' ? (
                            <span className="text-[9px] text-red-400 font-bold uppercase tracking-wider">Gagal</span>
                          ) : isCloud ? (
                            ex.spreadsheet_url ? <a href={ex.spreadsheet_url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-[#22c55e] font-bold uppercase tracking-wider hover:underline">Buka</a> : <span className="text-[9px] text-slate-500">—</span>
                          ) : (
                            <a href={`${api.defaults.baseURL}/google/oauth/exports/${ex.id}/download?token=${encodeURIComponent(localStorage.getItem('token') || '')}`} className="text-[9px] text-[#22c55e] font-bold uppercase tracking-wider hover:underline">Download</a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

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
