import { useEffect, useState } from 'react';
import { getAuth, type Session } from './auth';

/** zuletzt bekannte Anmeldung – neue Seiten kennen die Person sofort (kein Zwischenzustand „wird geladen“) */
let lastKnown: Session | null | undefined;

/** Angemeldete Person: undefined = wird noch geladen, null = nicht angemeldet */
export function useSession(): Session | null | undefined {
  const [s, setS] = useState<Session | null | undefined>(lastKnown);
  useEffect(() => {
    let alive = true;
    const set = (x: Session | null) => {
      lastKnown = x;
      if (alive) setS(x);
    };
    void getAuth()
      .session()
      .then(set)
      .catch(() => alive && setS(null));
    const off = getAuth().onChange(set);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return s;
}
