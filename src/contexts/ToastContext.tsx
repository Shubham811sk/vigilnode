import React, { createContext, useCallback, useContext, useState } from 'react';

type ToastType = 'success' | 'error' | 'info' | 'warn';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
  confirmAction: (opts: ConfirmOptions) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<{
    opts: ConfirmOptions;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-4), { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const confirmAction = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ opts, resolve });
    });
  }, []);

  const handleConfirmClose = (result: boolean) => {
    if (confirmState) {
      confirmState.resolve(result);
      setConfirmState(null);
    }
  };

  return (
    <ToastContext.Provider value={{ showToast, confirmAction }}>
      {children}

      {/* Toast Stack */}
      <div className="fixed bottom-20 lg:bottom-5 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((t) => {
          const styleMap: Record<ToastType, string> = {
            success: 'bg-[#0b1c30] border-[#4edea3]/60 text-[#4edea3]',
            error: 'bg-[#0b1c30] border-[#ff5451]/70 text-[#ffb4ab]',
            warn: 'bg-[#0b1c30] border-amber-400/70 text-amber-300',
            info: 'bg-[#0b1c30] border-[#adc6ff]/60 text-[#adc6ff]',
          };
          const iconMap: Record<ToastType, string> = {
            success: 'check_circle',
            error: 'error',
            warn: 'warning',
            info: 'info',
          };
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg border shadow-2xl font-mono text-xs backdrop-blur-md ${styleMap[t.type]}`}
            >
              <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">{iconMap[t.type]}</span>
              <span className="leading-snug flex-1 text-[#d3e4fe]">{t.message}</span>
              <button
                type="button"
                onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}
                className="text-[#8c909f] hover:text-[#d3e4fe]"
                aria-label="Dismiss notification"
              >
                <span className="material-symbols-outlined text-[15px]">close</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Confirmation Modal */}
      {confirmState && (
        <div
          className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-[#0b1c30] border border-[#26364a] rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  confirmState.opts.danger
                    ? 'bg-[#93000a]/40 text-[#ffb4ab] border border-[#ff5451]/40'
                    : 'bg-[#4d8eff]/20 text-[#adc6ff] border border-[#adc6ff]/30'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">
                  {confirmState.opts.danger ? 'warning' : 'help'}
                </span>
              </div>
              <div>
                <h3 className="text-base font-semibold text-[#d3e4fe]">{confirmState.opts.title}</h3>
                <p className="text-xs text-[#c2c6d6] mt-1 leading-relaxed">{confirmState.opts.message}</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1b2b3f]">
              <button
                type="button"
                onClick={() => handleConfirmClose(false)}
                className="px-3.5 py-2 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] text-xs font-medium text-[#c2c6d6] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleConfirmClose(true)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  confirmState.opts.danger
                    ? 'bg-[#93000a] hover:bg-[#ff5451] text-white'
                    : 'bg-[#4d8eff] hover:bg-[#adc6ff] text-[#00285d]'
                }`}
              >
                {confirmState.opts.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
