// Dependency-free, promise-based confirmation dialog.
//
// Replaces the cheap native window.confirm() with an on-brand modal rendered by
// <ConfirmHost/>. Because it returns a Promise<boolean>, call sites must await it:
//
//   if (!(await confirm({ title: 'Hapus?', message: '...', danger: true }))) return;
//
// Options: { title, message, confirmText, cancelText, danger }

let listener = null;

export function subscribeConfirm(fn) {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function confirm(opts = {}) {
  return new Promise((resolve) => {
    const request = {
      title: opts.title || 'Konfirmasi',
      message: opts.message || '',
      confirmText: opts.confirmText || 'Ya, lanjutkan',
      cancelText: opts.cancelText || 'Batal',
      danger: !!opts.danger,
      resolve,
    };
    if (listener) {
      listener(request);
    } else if (typeof window !== 'undefined' && window.confirm) {
      // Fallback if the host isn't mounted yet — keeps the flow working.
      resolve(window.confirm(opts.message || opts.title || ''));
    } else {
      resolve(false);
    }
  });
}

export default confirm;
