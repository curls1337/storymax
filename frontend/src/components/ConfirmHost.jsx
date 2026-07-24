import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { subscribeConfirm } from '../utils/confirm';

// On-brand confirmation modal host. Mount once (in main.jsx). Renders a styled
// dark + gold dialog whenever confirm() is called, resolving the promise with
// the user's choice. Supports Enter (confirm) / Escape (cancel) and backdrop
// click to cancel. The `danger` flag switches the accent to red for destructive
// actions (delete, bulk delete, etc.).

export default function ConfirmHost() {
  const [req, setReq] = useState(null);

  useEffect(() => subscribeConfirm((r) => setReq(r)), []);

  useEffect(() => {
    if (!req) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      else if (e.key === 'Enter') { e.preventDefault(); close(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  function close(result) {
    setReq((cur) => {
      if (cur && typeof cur.resolve === 'function') cur.resolve(result);
      return null;
    });
  }

  if (!req || typeof document === 'undefined') return null;

  const danger = req.danger;
  const Icon = danger ? AlertTriangle : HelpCircle;

  return createPortal(
    <div
      className="fixed inset-0 z-[100001] flex items-center justify-center p-4"
      style={{ animation: 'storymaxConfirmFade 0.15s ease-out' }}
    >
      <style>{`@keyframes storymaxConfirmFade{from{opacity:0}to{opacity:1}}@keyframes storymaxConfirmPop{from{opacity:0;transform:translateY(10px) scale(0.97)}to{opacity:1;transform:none}}`}</style>
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={() => close(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-sm rounded-2xl border border-[#2a2725] bg-[#1a1918] shadow-2xl shadow-black/60 p-6"
        style={{ animation: 'storymaxConfirmPop 0.2s cubic-bezier(0.16,1,0.3,1)' }}
      >
        <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#cfae80]/40 to-transparent" />
        <div className="flex items-start gap-3.5">
          <div
            className="shrink-0 grid place-items-center w-10 h-10 rounded-full"
            style={{
              backgroundColor: danger ? 'rgba(239,68,68,0.12)' : 'rgba(207,174,128,0.12)',
              color: danger ? '#f87171' : '#cfae80',
            }}
          >
            <Icon size={20} />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h3 className="text-[15px] font-bold text-white leading-snug">{req.title}</h3>
            {req.message ? (
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400 whitespace-pre-line break-words">
                {req.message}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={() => close(false)}
            className="px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider text-slate-300 border border-[#2a2725] hover:bg-white/5 transition-colors cursor-pointer"
          >
            {req.cancelText}
          </button>
          <button
            type="button"
            onClick={() => close(true)}
            autoFocus
            className="px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer shadow-lg"
            style={
              danger
                ? { backgroundColor: '#ef4444', color: '#fff' }
                : { backgroundColor: '#cfae80', color: '#1a1918' }
            }
          >
            {req.confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
