import React from 'react';
import { useToaster, toast } from 'react-hot-toast';
import {
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  Info,
  X,
  Zap,
  BatteryWarning,
  Thermometer,
} from 'lucide-react';
import { EventLogRecord, EventSeverity } from '../lib/types';

interface ToastData {
  event: EventLogRecord;
  title: string;
  description: string;
}

export const UpsedToaster: React.FC = () => {
  const { toasts, handlers } = useToaster();
  const { startPause, endPause } = handlers;

  const getSeverityStyle = (severity: EventSeverity) => {
    switch (severity) {
      case 'critical':
        return {
          border: 'border-rose-500/70',
          bg: 'bg-slate-950/95',
          glow: 'shadow-[0_0_30px_-5px_rgba(244,63,94,0.4)]',
          badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
          accent: 'bg-rose-500',
          iconColor: 'text-rose-400',
        };
      case 'warning':
        return {
          border: 'border-amber-500/70',
          bg: 'bg-slate-950/95',
          glow: 'shadow-[0_0_30px_-5px_rgba(245,158,11,0.4)]',
          badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
          accent: 'bg-amber-500',
          iconColor: 'text-amber-400',
        };
      case 'success':
        return {
          border: 'border-emerald-500/70',
          bg: 'bg-slate-950/95',
          glow: 'shadow-[0_0_30px_-5px_rgba(16,185,129,0.4)]',
          badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
          accent: 'bg-emerald-500',
          iconColor: 'text-emerald-400',
        };
      case 'info':
      default:
        return {
          border: 'border-cyan-500/70',
          bg: 'bg-slate-950/95',
          glow: 'shadow-[0_0_30px_-5px_rgba(6,182,212,0.4)]',
          badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
          accent: 'bg-cyan-500',
          iconColor: 'text-cyan-400',
        };
    }
  };

  const getIcon = (type: string, severity: EventSeverity) => {
    if (type.includes('BATTERY')) return <BatteryWarning className="w-5 h-5" />;
    if (type.includes('TEMP')) return <Thermometer className="w-5 h-5" />;
    if (type.includes('UTILITY') || type.includes('LINE')) return <Zap className="w-5 h-5" />;

    switch (severity) {
      case 'critical':
        return <AlertOctagon className="w-5 h-5 animate-pulse" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5" />;
      case 'success':
        return <CheckCircle2 className="w-5 h-5" />;
      case 'info':
      default:
        return <Info className="w-5 h-5" />;
    }
  };

  return (
    <div
      onMouseEnter={startPause}
      onMouseLeave={endPause}
      className="fixed bottom-4 right-4 z-50 flex flex-col space-y-3 max-w-md w-full pointer-events-none px-4 sm:px-0"
    >
      {toasts.map((t) => {
        let data: ToastData | null = null;
        try {
          const raw = typeof t.message === 'function' ? (t.message as any)(t) : t.message;
          if (typeof raw === 'string') {
            data = JSON.parse(raw);
          } else {
            data = raw;
          }
        } catch {
          data = null;
        }

        const event = data?.event;
        const title = data?.title || 'System Notification';
        const description = data?.description || (typeof t.message === 'string' ? t.message : '');
        const severity: EventSeverity = event?.severity || 'info';
        const style = getSeverityStyle(severity);

        return (
          <div
            key={t.id}
            className={`pointer-events-auto transform transition-all duration-300 ease-out ${
              t.visible ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-2 opacity-0 scale-95'
            } relative overflow-hidden rounded-2xl border ${style.border} ${style.bg} ${style.glow} backdrop-blur-xl p-4 text-slate-200 shadow-2xl`}
          >
            {/* Left glowing accent line */}
            <div className={`absolute top-0 left-0 bottom-0 w-1.5 ${style.accent}`} />

            <div className="flex items-start justify-between gap-3 pl-1.5">
              <div className="flex items-start space-x-3 min-w-0">
                <div className={`p-2 rounded-xl bg-slate-900/90 border border-slate-800 shrink-0 ${style.iconColor}`}>
                  {getIcon(event?.event_type || '', severity)}
                </div>

                <div className="min-w-0 space-y-1">
                  <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                    <span className="text-sm font-semibold tracking-tight text-slate-100 truncate">
                      {title}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider border ${style.badge}`}
                    >
                      {severity}
                    </span>
                    {event?.port_name && (
                      <span className="text-[10px] text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded">
                        {event.port_name}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed break-words">
                    {description}
                  </p>

                  <p className="text-[10px] text-slate-400 pt-0.5">
                    {event?.timestamp
                      ? new Date(event.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })
                      : 'Just now'}
                  </p>
                </div>
              </div>

              {/* Close Button */}
              <button
                onClick={() => toast.dismiss(t.id)}
                className="text-slate-400 hover:text-slate-100 p-1 rounded-lg hover:bg-slate-800/60 transition shrink-0"
                aria-label="Dismiss notification"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default UpsedToaster;

