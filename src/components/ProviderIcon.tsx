import type { AuthProviderId } from '../lib/auth';

/** Einfache Symbole der Anmeldeanbieter (eigene Zeichnung, keine Markenlogos als Datei) */
export function ProviderIcon({ id, size = 20 }: { id: AuthProviderId; size?: number }) {
  if (id === 'google')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.7h5.4c-.2 1.2-.9 2.3-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" fill="#4285F4" />
        <path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6C4.8 19.8 8.2 22 12 22z" fill="#34A853" />
        <path d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1C2.4 8.8 2 10.4 2 12s.4 3.2 1.1 4.6L6.4 14z" fill="#FBBC05" />
        <path d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8C17 3 14.7 2 12 2 8.2 2 4.8 4.2 3.1 7.4L6.4 10c.8-2.3 3-4.1 5.6-4.1z" fill="#EA4335" />
      </svg>
    );
  if (id === 'apple')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.8-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.8 3-.8s1.8.8 3 .7c1.3 0 2-1.1 2.8-2.3.9-1.3 1.2-2.6 1.3-2.6-.1 0-2.5-1-2.5-3.7zM14.1 5.8c.6-.8 1.1-1.9.9-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1.1.1 2.1-.5 2.8-1.3z" />
      </svg>
    );
  if (id === 'microsoft')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="8.5" height="8.5" fill="#F25022" />
        <rect x="12.5" y="3" width="8.5" height="8.5" fill="#7FBA00" />
        <rect x="3" y="12.5" width="8.5" height="8.5" fill="#00A4EF" />
        <rect x="12.5" y="12.5" width="8.5" height="8.5" fill="#FFB900" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}
