import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Save, RotateCcw, X, Info } from 'lucide-react';
import { PrimaryButton } from './PrimaryButton';

export interface UnsavedChangesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveAndLeave: () => void | Promise<void>;
  onDiscardAndLeave: () => void;
  isLoading?: boolean;
}

export const UnsavedChangesModal: React.FC<UnsavedChangesModalProps> = ({
  isOpen,
  onClose,
  onSaveAndLeave,
  onDiscardAndLeave,
  isLoading = false,
}) => {
  const { t } = useTranslation(['settings', 'common']);
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
    } else if (shouldRender) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
      }, 180);
      return () => clearTimeout(timer);
    }
  }, [isOpen, shouldRender]);

  // Handle ESC key to dismiss
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-200 ${
        isOpen && !isClosing
          ? 'bg-black/75 backdrop-blur-md opacity-100'
          : 'bg-transparent backdrop-blur-none opacity-0 pointer-events-none'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) {
          onClose();
        }
      }}
    >
      <div
        className={`w-full max-w-lg transform overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/95 text-left align-middle shadow-2xl shadow-black/60 backdrop-blur-xl transition-all duration-200 ${
          isOpen && !isClosing
            ? 'scale-100 translate-y-0 opacity-100'
            : 'scale-95 translate-y-2 opacity-0'
        }`}
      >
        {/* Header with Icon and Close Button matching UPSED standards */}
        <div className="p-5 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/40">
          <div className="flex items-center space-x-3.5">
            <div className="p-2.5 rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-400 shrink-0">
              <AlertCircle className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                {t('settings:navigationGuard.title', 'Unsaved Changes')}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('settings:navigationGuard.subtitle', 'Pending preference modifications')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition disabled:opacity-40 cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-3.5 text-xs text-slate-300 leading-relaxed">
          <p>
            {t(
              'settings:navigationGuard.message',
              'You have unsaved preferences in Settings. Would you like to save them before leaving this page?'
            )}
          </p>

          <div className="p-3 rounded-xl border border-slate-800 bg-slate-900/50 flex items-center space-x-2.5 text-slate-400">
            <Info className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="text-[11px]">
              {t(
                'settings:navigationGuard.infoNote',
                'Discarding will restore all settings and hardware parameters to their last saved state.'
              )}
            </span>
          </div>
        </div>

        {/* Footer Actions: Stay on Left, Discard & Save on Right */}
        <div className="p-4 bg-slate-950/60 border-t border-slate-800/80 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] transition cursor-pointer whitespace-nowrap disabled:opacity-40"
          >
            {t('settings:navigationGuard.cancel', 'Stay on Page')}
          </button>

          <div className="flex items-center space-x-2.5 shrink-0">
            <button
              type="button"
              onClick={onDiscardAndLeave}
              disabled={isLoading}
              className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-white/[0.1] bg-white/[0.04] text-slate-300 hover:text-white hover:bg-white/[0.08] transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              <span>{t('settings:navigationGuard.discardAndLeave', 'Discard & Leave')}</span>
            </button>

            <PrimaryButton
              onClick={onSaveAndLeave}
              isLoading={isLoading}
              icon={<Save className="w-3.5 h-3.5" />}
              size="md"
              className="whitespace-nowrap"
            >
              <span>{t('settings:navigationGuard.saveAndLeave', 'Save & Leave')}</span>
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnsavedChangesModal;
