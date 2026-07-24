import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { subscribeToasts, dismissToast } from '../utils/toast';

// On-brand toast host. Mount once (in main.jsx). Subscribes to the toast store
// and renders a centered, stacked column of auto-dismissing toasts that match
// the app's dark + gold theme.

const VARIANTS = {
  success: { Icon: CheckCircle2, accent: '#34d399', ring: 'rgba(52,211,153,0.35)' },
  error: { Icon: XCircle, accent: '#f87171', ring: 'rgba(248,113,113,0.35)' },
  info: { Icon: Info, accent: '#cfae80', ring: 'rgba(207,174,128,0.35)' },
};

export default function ToastHost() {
  const [items, setItems] = useState([]);

  useEffect(() => subscribeToasts(setItems), []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed top-0 inset-x-0 z-[100000] flex flex-col items-center gap-2 px-4 pt-[max(1rem,env(safe-area-inset-top))] pointer-events-none">
      <style>{`@keyframes storymaxToastIn{from{opacity:0;transform:translateY(-12px) scale(0.98)}to{opacity:1;transform:none}}`}</style>
      {items.map((t) => {
        const v = VARIANTS[t.type] || VARIANTS.info;
        const { Icon } = v;
        return (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto w-full max-w-sm flex items-start gap-3 rounded-xl border bg-[#181716]/95 backdrop-blur-md shadow-2xl shadow-black/50 pl-3.5 pr-2.5 py-3"
            style={{ borderColor: v.ring, animation: 'storymaxToastIn 0.24s cubic-bezier(0.16,1,0.3,1)' }}
          >
            <Icon size={18} className="mt-0.5 shrink-0" style={{ color: v.accent }} />
            <p className="flex-1 text-[13px] leading-snug text-neutral-100 font-medium whitespace-pre-line break-words">
              {t.message}
            </p>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="shrink-0 text-neutral-500 hover:text-neutral-200 transition-colors p-0.5"
              aria-label="Tutup"
            >
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}
