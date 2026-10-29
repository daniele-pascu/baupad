import { useEffect, useState } from 'react';
import { getAuth, type Session } from './auth';

/** Angemeldete Person: undefined = wird noch geladen, null = nicht angemeldet */
export function useSession(): Session | null | undefined {
  const [s, setS] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void getAuth()
      .session()
      .then((x) => alive && setS(x))
      .catch(() => alive && setS(null));
    const off = getAuth().onChange((x) => alive && setS(x));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return s;
}
