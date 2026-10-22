import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AuthStatus } from './types';
import { api } from './tauri';

export interface AuthContextType {
  status: AuthStatus | null;
  isLoading: boolean;
  refreshStatus: () => Promise<void>;
  setup: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (oldPw: string, newPw: string) => Promise<void>;
  reset: () => Promise<void>;
  isLoginModalOpen: boolean;
  openLoginModal: (pendingAction?: () => void | Promise<void>) => void;
  closeLoginModal: () => void;
  requireAuth: (action: () => void | Promise<void>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(false);
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

  const openLoginModal = (action?: () => void | Promise<void>) => {
    if (action) {
      setPendingAction(() => action);
    }
    setIsLoginModalOpen(true);
  };

  const closeLoginModal = () => {
    setIsLoginModalOpen(false);
    setPendingAction(null);
  };

  const requireAuth = (action: () => void | Promise<void>) => {
    if (status?.authenticated) {
      action();
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
        setup,
        login,
        logout,
        changePassword,
        reset,
        isLoginModalOpen,
        openLoginModal,
        closeLoginModal,
        requireAuth,
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
