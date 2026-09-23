import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Calendar, X, ArrowRight } from 'lucide-react';

export interface CustomDurationRange {
  startIso: string;
  endIso: string;
  label: string;
}

export interface DurationPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (range: CustomDurationRange) => void;
  initialDays?: number;
  initialHours?: number;
}

export const DurationPickerModal: React.FC<DurationPickerModalProps> = ({
  isOpen,
  onClose,
  onApply,
  initialDays = 0,
  initialHours = 2,
}) => {
  const { t } = useTranslation(['history', 'common']);
  const [mode, setMode] = useState<'relative' | 'absolute'>('relative');
  const [days, setDays] = useState(initialDays);
  const [hours, setHours] = useState(initialHours);

  // Absolute date picker state (defaulting to last 24 hours in local datetime-local format)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(Date.now() - 24 * 3600 * 1000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });

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

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!shouldRender) return null;

  const handleApply = () => {
    if (mode === 'relative') {
      const safeDays = Math.max(0, Number(days) || 0);
      const safeHours = Math.max(0, Number(hours) || 0);
      const totalHours = safeDays * 24 + safeHours;
      const effectiveHours = totalHours > 0 ? totalHours : 1;

      const now = new Date();
      const start = new Date(now.getTime() - effectiveHours * 3600 * 1000);

      const labelParts: string[] = [];
      if (safeDays > 0) labelParts.push(`${safeDays}d`);
      if (safeHours > 0 || safeDays === 0) labelParts.push(`${safeHours || 1}h`);

      onApply({
        startIso: start.toISOString(),
        endIso: now.toISOString(),
        label: `Past ${labelParts.join(' ')}`,
      });
    } else {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const validStart = isNaN(start.getTime()) ? new Date(Date.now() - 3600 * 1000) : start;
      const validEnd = isNaN(end.getTime()) ? new Date() : end;

      onApply({
        startIso: validStart.toISOString(),
        endIso: validEnd.toISOString(),
        label: 'Custom Range',
      });
    }
    onClose();
  };

  const setShortcut = (d: number, h: number) => {
    setMode('relative');
    setDays(d);
    setHours(h);
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-200 select-none ${
        isClosing ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        className={`relative w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl transition-all duration-200 ${
          isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-3.5 border-b border-white/[0.06]">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                {t('common:duration.customTitle', 'Custom Time Duration')}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('common:duration.customSubtitle', 'Inspect history and graph metrics for specific hours or date ranges')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="flex items-center bg-slate-950/80 border border-slate-800 rounded-xl p-1 mt-4">
          <button
            type="button"
            onClick={() => setMode('relative')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 transition ${
              mode === 'relative'
                ? 'bg-cyan-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{t('common:duration.relativeMode', 'Relative Duration')}</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('absolute')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 transition ${
              mode === 'absolute'
                ? 'bg-cyan-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>{t('common:duration.absoluteMode', 'Date-Time Range')}</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="py-4 space-y-4">
          {mode === 'relative' ? (
            <div className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">
                    {t('common:duration.days', 'Days')}
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="365"
                    value={days}
                    onChange={(e) => setDays(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-cyan-500 transition"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">
                    {t('common:duration.hours', 'Hours')}
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={hours}
                    onChange={(e) => setHours(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-cyan-500 transition"
                  />
                </div>
              </div>

              {/* Quick shortcuts */}
              <div className="space-y-1.5">
                <span className="text-[11px] text-slate-400 font-medium">Quick Shortcuts</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: '2 Hours', d: 0, h: 2 },
                    { label: '12 Hours', d: 0, h: 12 },
                    { label: '2 Days', d: 2, h: 0 },
                    { label: '3 Days', d: 3, h: 0 },
                    { label: '14 Days', d: 14, h: 0 },
                  ].map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      onClick={() => setShortcut(s.d, s.h)}
                      className="px-2.5 py-1 rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] text-slate-300 text-xs transition"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  {t('common:duration.startDateTime', 'Start Date & Time')}
                </label>
                <input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500 transition"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  {t('common:duration.endDateTime', 'End Date & Time')}
                </label>
                <input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500 transition"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end space-x-2 pt-3 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl border border-white/[0.08] text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.05] transition"
          >
            {t('common:buttons.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="px-4 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold text-white shadow-sm flex items-center space-x-1.5 transition"
          >
            <span>{t('common:buttons.apply', 'Apply Duration')}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
