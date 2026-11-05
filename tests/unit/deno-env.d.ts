// Für den Typ-Check der Supabase-Funktionen in den Unit-Tests (in Supabase stellt Deno das selbst bereit)
declare const Deno: { env: { get(name: string): string | undefined }; serve(h: (req: Request) => Promise<Response>): void };
