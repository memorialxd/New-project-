import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profile: { role: string; full_name: string | null; public_code?: string | null } | null;
  isAdmin: boolean;
  isSupport: boolean;
  signUp: (email: string, password: string, fullName: string, role: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<{ role: string; full_name: string | null; public_code?: string | null } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSupport, setIsSupport] = useState(false);

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('role, full_name, public_code')
      .eq('user_id', userId)
      .maybeSingle();
    setProfile(data ? (data as any) : { role: 'customer', full_name: null });

    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);
    const roleList = (roles ?? []).map((r: any) => r.role);
    setIsAdmin(roleList.includes('admin'));
    setIsSupport(roleList.includes('support'));
  };

  useEffect(() => {
    // onAuthStateChange must NOT be async and must NOT await Supabase calls
    // directly inside the callback — doing so causes a deadlock because the
    // SDK fires the callback synchronously while the auth token is still being
    // committed. Defer any DB work with setTimeout to break the cycle.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          const userId = session.user.id;
          setTimeout(() => {
            fetchProfile(userId).finally(() => setLoading(false));
          }, 0);
        } else {
          setProfile(null);
          setIsAdmin(false);
          setIsSupport(false);
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, fullName: string, role: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });

    if (!error && data.user) {
      await supabase
        .from('profiles')
        .update({ role: role as any })
        .eq('user_id', data.user.id);
      await fetchProfile(data.user.id);
    }

    return { error: error as Error | null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setIsAdmin(false);
    setIsSupport(false);
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, profile, isAdmin, isSupport, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
