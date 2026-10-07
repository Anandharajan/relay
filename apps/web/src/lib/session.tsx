import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';

export interface Me {
  user: { id: string; email: string; name: string };
  role: 'owner' | 'admin' | 'agent';
  org: {
    id: string;
    name: string;
    plan: string;
    siteKey: string;
    whatsappConnected: boolean;
    settings: {
      botName: string;
      brandColor: string;
      greeting: string;
      allowedOrigins: string[];
      confidenceThreshold: number;
      mode: 'auto' | 'draft';
      idleResolveMinutes: number;
      retentionDays: number;
      consentText: string;
      whatsapp?: { phoneNumberId?: string; verifyToken?: string; enabled?: boolean };
    };
  };
  orgs: { id: string; name: string; role: string }[];
  server: { mode: 'cloud' | 'selfhost'; publicUrl: string; billing: boolean };
}

const Ctx = createContext<{ me: Me | null; loading: boolean; refresh: () => Promise<void> }>({ me: null, loading: true, refresh: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('/api/me'));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return <Ctx.Provider value={{ me, loading, refresh }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
export const canAdmin = (me: Me | null) => me?.role === 'owner' || me?.role === 'admin';
