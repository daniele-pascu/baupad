/** Zugriff auf die Datenbankfunktionen (RPC) des angemeldeten Benutzers – gesetzt von auth-init */
import type { AuthClientLike } from './auth-supabase';

let client: AuthClientLike | null = null;
export const setRemoteClient = (c: AuthClientLike | null) => {
  client = c;
};
export const remoteConnected = () => client !== null;

/** ruft eine Datenbankfunktion; Fehler kommen als Error mit der Meldung der Datenbank */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (!client) throw new Error('Nicht mit dem Dienst verbunden.');
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message.replace(/^.*?:\s*/, ''));
  return data as T;
}
