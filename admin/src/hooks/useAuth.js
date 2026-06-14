import { useState, useEffect } from 'react';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        }
      } catch {
        // 未登录
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, []);

  const login = () => {
    window.location.href = `/auth/login?returnUrl=${encodeURIComponent(window.location.pathname)}`;
  };

  const logout = () => {
    window.location.href = '/auth/logout';
  };

  return { user, loading, login, logout };
}
