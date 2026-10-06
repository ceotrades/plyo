import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';

type AuthContextType = {
  session: Session | null;
  isLoading: boolean;
  hasProfile: boolean | null; // null = still checking
  setHasProfile: (v: boolean) => void;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  isLoading: true,
  hasProfile: null,
  setHasProfile: () => {},
});

async function profileExists(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_profile')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setHasProfile(session ? await profileExists(session.user.id) : false);
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
      if (event === 'SIGNED_IN') {
        setHasProfile(await profileExists(session!.user.id));
      } else if (event === 'SIGNED_OUT') {
        setHasProfile(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ session, isLoading, hasProfile, setHasProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useSession() {
  return useContext(AuthContext);
}
