// Lightweight, dependency-free toast notification store.
//
// A tiny pub/sub module singleton that <ToastHost/> subscribes to. Call
// toast.success / toast.error / toast.info from anywhere to replace the cheap
// native alert() dialogs with on-brand toasts.
//
//   import { toast } from '../utils/toast';
//   toast.success('Tersalin!');
//   toast.error('Gagal menyimpan.');

let toasts = [];
let listeners = [];
let idCounter = 0;

function emit() {
  // hand out a fresh array reference so React state updates trigger a re-render
  const snapshot = toasts.slice();
  listeners.forEach((fn) => fn(snapshot));
}

export function subscribeToasts(fn) {
  listeners.push(fn);
  fn(toasts.slice());
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

export function dismissToast(id) {
  const before = toasts.length;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== before) emit();
}

function show(type, message, opts = {}) {
  const text = String(message == null ? '' : message).trim();
  if (!text) return null;
  const id = ++idCounter;
  const duration =
    opts.duration != null ? opts.duration : type === 'error' ? 5000 : 3200;
  toasts = [...toasts, { id, type, message: text }];
  emit();
  if (duration > 0 && typeof setTimeout === 'function') {
    setTimeout(() => dismissToast(id), duration);
  }
  return id;
}

export const toast = {
  success: (message, opts) => show('success', message, opts),
  error: (message, opts) => show('error', message, opts),
  info: (message, opts) => show('info', message, opts),
};

export default toast;
