/**
 * Öffentliche Zugangsdaten des Supabase-Projekts „BauPad“ (Organisation PAD Software, Region EU/Irland).
 * Beide Werte dürfen in der App stehen: Die Project URL ist die Adresse des Dienstes, der Publishable Key
 * erlaubt nur, was die Zugriffsregeln (Row Level Security) in der Datenbank freigeben.
 * Der geheime Schlüssel (service_role / secret) gehört NIE hierher.
 */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://knaskwuhjixxpnqjfqpx.supabase.co';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_XfypEdkp9A-MK0B29NPiGA_SStJXHg4';
