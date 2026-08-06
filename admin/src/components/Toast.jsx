import { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, X, XCircle, Info } from 'lucide-react';

const ToastContext = createContext(null);

const icons = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((items) => items.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback((message, type = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((items) => [...items, { id, message, type }]);
    window.setTimeout(() => dismiss(id), 4200);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ notify, dismiss }}>
      {children}
      <div className="fixed right-4 top-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => {
          const Icon = icons[toast.type] || Info;
          return (
            <div key={toast.id} role={toast.type === 'error' ? 'alert' : 'status'} className="flex items-start gap-3 border px-4 py-3 text-sm shadow-lg" style={{ background: 'var(--card)', borderColor: toast.type === 'error' ? 'var(--error)' : 'var(--border)', color: 'var(--text)' }}>
              <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: toast.type === 'success' ? 'var(--success)' : toast.type === 'error' ? 'var(--error)' : 'var(--primary)' }} />
              <span className="min-w-0 flex-1 break-words">{toast.message}</span>
              <button type="button" className="btn-ghost !p-0.5" aria-label="关闭提示" onClick={() => dismiss(toast.id)}>
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
