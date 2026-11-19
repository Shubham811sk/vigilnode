import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch, getStoredToken, setStoredToken } from '../lib/api';

export type UserRole = 'ADMIN' | 'READ_ONLY_MAINTAINER';

export interface CurrentUser {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  title: string;
  is_active: boolean;
  last_login_at?: string | null;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await apiFetch<CurrentUser>('/auth/me');
      setUser(me);
    } catch {
      setStoredToken('');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch<{ access_token: string; user: CurrentUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setStoredToken(res.access_token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    setStoredToken('');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAdmin: user?.role === 'ADMIN',
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
