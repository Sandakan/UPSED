import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Lock, X, RefreshCw, KeyRound, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../lib/auth';

export const LoginModal: React.FC = () => {
  const { t } = useTranslation(['control', 'common']);
  const { status, isLoginModalOpen, closeLoginModal, login, setup } = useAuth();

  const isConfigured = Boolean(status?.configured);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Manage enter/exit animation lifecycle
  const [shouldRender, setShouldRender] = useState(isLoginModalOpen);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isLoginModalOpen) {
      setShouldRender(true);
      setIsClosing(false);
      setErrorMessage(null);
      setPassword('');
      setConfirmPassword('');
      if (status?.username) {
        setUsername(status.username);
      } else {
        setUsername('');
      }
    } else if (shouldRender) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
        setErrorMessage(null);
      }, 180);
      return () => clearTimeout(timer);
    }
  }, [isLoginModalOpen, shouldRender, status?.username]);

  // Handle ESC key to dismiss
  useEffect(() => {
    if (!isLoginModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        closeLoginModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLoginModalOpen, isSubmitting, closeLoginModal]);

  if (!shouldRender) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedUser = username.trim();
    if (!trimmedUser) {
      setErrorMessage(t('control:auth.usernameRequired', 'Username is required'));
      return;
    }

    if (password.length < 8) {
      setErrorMessage(
        t('control:auth.passwordMinLength', 'Password must be at least 8 characters long')
      );
      return;
    }

    if (!isConfigured) {
      if (password !== confirmPassword) {
        setErrorMessage(t('control:auth.passwordMismatch', 'Passwords do not match'));
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (!isConfigured) {
        await setup(trimmedUser, password);
      } else {
        await login(trimmedUser, password);
      }
      closeLoginModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-200 ${
        isClosing ? 'opacity-0 backdrop-blur-none' : 'opacity-100 backdrop-blur-sm'
      }`}
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) closeLoginModal();
      }}
    >
      <div
        className={`w-full max-w-md rounded-2xl border shadow-2xl p-6 transition-all duration-200 border-indigo-500/30 bg-[#0f1117] ${
          isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl border bg-indigo-950/70 border-indigo-800/60 text-indigo-400">
              {isConfigured ? <Lock className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                {isConfigured
                  ? t('control:auth.loginTitle', 'Authentication Required')
                  : t('control:auth.setupTitle', 'Initial Security Setup')}
              </h3>
              <p className="text-xs text-slate-400">
                {isConfigured
                  ? t('control:auth.loginSubtitle', 'Log in to execute protected hardware commands')
                  : t(
                      'control:auth.setupSubtitle',
                      'Create administrator credentials to protect write operations'
                    )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeLoginModal}
            disabled={isSubmitting}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg transition hover:bg-white/[0.05]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Protection Explanatory Banner */}
        <div className="mb-4 p-3 rounded-xl border border-indigo-500/20 bg-indigo-500/[0.05] text-indigo-300 text-xs flex gap-2.5 items-start">
          <KeyRound className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold text-indigo-200">
              {t('control:auth.barrierTitle', 'Hardware Safety Barrier')}
            </p>
            <p className="text-[11px] text-indigo-300/90 leading-relaxed">
              {t(
                'control:auth.barrierDesc',
                'Stage T1 telemetry queries remain available to all users. Diagnostic self-tests, persistent parameter modifications, and live power cuts require authenticated credentials.'
              )}
            </p>
          </div>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs flex gap-2 items-center">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="leading-snug">{errorMessage}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="text-[11px] font-mono text-slate-300 block mb-1">
              {t('control:auth.username', 'Username')}
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              disabled={isSubmitting}
              autoFocus
              className="w-full px-3 py-2 text-xs rounded-xl border border-white/[0.1] bg-white/[0.04] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40 transition font-mono"
            />
          </div>

          <div>
            <label className="text-[11px] font-mono text-slate-300 block mb-1">
              {t('control:auth.password', 'Password')}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={isSubmitting}
                className="w-full px-3 py-2 pr-9 text-xs rounded-xl border border-white/[0.1] bg-white/[0.04] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40 transition font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {!isConfigured && (
              <span className="text-[10px] text-slate-400 mt-1 block">
                {t('control:auth.minLengthHint', 'Minimum 8 characters')}
              </span>
            )}
          </div>

          {!isConfigured && (
            <div>
              <label className="text-[11px] font-mono text-slate-300 block mb-1">
                {t('control:auth.confirmPassword', 'Confirm Password')}
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                disabled={isSubmitting}
                className="w-full px-3 py-2 text-xs rounded-xl border border-white/[0.1] bg-white/[0.04] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40 transition font-mono"
              />
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={closeLoginModal}
              disabled={isSubmitting}
              className="flex-1 py-2 px-3 bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 border border-white/[0.08] text-xs font-semibold rounded-xl transition cursor-pointer disabled:opacity-40"
            >
              {t('common:buttons.cancel', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-lg shadow-indigo-950/50 border border-indigo-400/30 transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
            >
              {isSubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>
                {isConfigured
                  ? t('control:auth.loginBtn', 'Log In')
                  : t('control:auth.setupBtn', 'Create Credentials')}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
