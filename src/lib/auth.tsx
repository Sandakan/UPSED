import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AuthStatus } from './types';
import { api } from './tauri';

export interface AuthContextType {
  status: AuthStatus | null;
  isLoading: boolean;
  refreshStatus: () => Promise<void>;
  verifyOs: (reason?: string) => Promise<boolean>;
  setup: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (oldPw: string, newPw: string) => Promise<void>;
  reset: () => Promise<void>;
  isLoginModalOpen: boolean;
  loginModalError: string | null;
  openLoginModal: (pendingAction?: () => void | Promise<void>, initialError?: string) => void;
  closeLoginModal: () => void;
  requireAuth: (action: () => void | Promise<void>, reason?: string) => Promise<void>;
  requireFreshAuth: (action: () => void | Promise<void>, reason?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(false);
  const [loginModalError, setLoginModalError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void | Promise<void>) | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await api.authStatus();
      setStatus(res);
    } catch (err) {
      console.error('Failed to query auth status:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 30_000); // 30s background sync
    return () => clearInterval(interval);
  }, [refreshStatus]);

  // Window focus auto-refresh (to detect expiration when returning from idle)
  useEffect(() => {
    const handleFocus = () => {
      refreshStatus();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refreshStatus]);

  const verifyOs = async (reason?: string): Promise<boolean> => {
    try {
      const res = await api.authVerifyOs(reason);
      setStatus(res);
      if (res.authenticated && pendingAction) {
        const act = pendingAction;
        setPendingAction(null);
        await act();
      }
      return Boolean(res.authenticated);
    } catch (err) {
      console.warn('OS verification cancelled or failed:', err);
      await refreshStatus();
      return false;
    }
  };

  const setup = async (username: string, password: string) => {
    await api.authSetup(username, password);
    await refreshStatus();
    if (pendingAction) {
      const act = pendingAction;
      setPendingAction(null);
      await act();
    }
  };

  const login = async (username: string, password: string) => {
    await api.authLogin(username, password);
    await refreshStatus();
    if (pendingAction) {
      const act = pendingAction;
      setPendingAction(null);
      await act();
    }
  };

  const logout = async () => {
    await api.authLogout();
    await refreshStatus();
  };

  const changePassword = async (oldPw: string, newPw: string) => {
    await api.authChangePassword(oldPw, newPw);
    await refreshStatus();
  };

  const reset = async () => {
    await api.authReset();
    await refreshStatus();
  };

  const openLoginModal = (action?: () => void | Promise<void>, initialError?: string) => {
    if (action) {
      setPendingAction(() => action);
    }
    setLoginModalError(initialError || null);
    setIsLoginModalOpen(true);
  };

  const closeLoginModal = () => {
    setIsLoginModalOpen(false);
    setLoginModalError(null);
    setPendingAction(null);
  };

  const requireAuth = async (action: () => void | Promise<void>, reason?: string) => {
    let currentStatus = status;
    if (!currentStatus) {
      try {
        currentStatus = await api.authStatus();
        setStatus(currentStatus);
      } catch (e) {
        console.warn('Failed to load auth status before requiring auth:', e);
      }
    }

    if (currentStatus?.authenticated) {
      await action();
    } else if (currentStatus?.os_auth_available) {
      // First try the native OS biometric/PIN/password prompt directly
      const success = await verifyOs(reason);
      if (success) {
        await action();
      } else {
        // On fail or cancel, show modal stating native verification failed with Try Again or password
        const failMsg = `${currentStatus.provider_name} verification was cancelled or failed. You can try again or use your app passcode.`;
        openLoginModal(action, failMsg);
      }
    } else {
      openLoginModal(action);
    }
  };

  const requireFreshAuth = async (action: () => void | Promise<void>, reason?: string) => {
    let currentStatus = status;
    if (!currentStatus) {
      try {
        currentStatus = await api.authStatus();
        setStatus(currentStatus);
      } catch (e) {
        console.warn('Failed to load auth status before requiring fresh auth:', e);
      }
    }

    if (currentStatus?.os_auth_available) {
      const ok = await verifyOs(reason);
      if (ok) {
        await action();
      } else {
        const failMsg = `${currentStatus.provider_name} verification was cancelled or failed. You can try again or enter credentials.`;
        openLoginModal(action, failMsg);
      }
    } else if (currentStatus?.authenticated) {
      await action();
    } else {
      openLoginModal(action);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        status,
        isLoading,
        refreshStatus,
        verifyOs,
        setup,
        login,
        logout,
        changePassword,
        reset,
        isLoginModalOpen,
        loginModalError,
        openLoginModal,
        closeLoginModal,
        requireAuth,
        requireFreshAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
