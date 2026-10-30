// Supabase Edge Function „contact“: nimmt das Kontaktformular der Website entgegen,
// prüft die Eingaben, bremst Spam und verschickt die Nachricht per E-Mail über Resend.
// Jede Anfrage wird zusätzlich in der Tabelle contact_messages abgelegt (Sicherung, längstens 12 Monate).
//
// Einrichten (siehe docs/kontaktformular.md):
//   supabase secrets set RESEND_API_KEY=re_…  CONTACT_TO=office@pad-software.at  CONTACT_FROM="PAD Software <kontakt@pad-software.at>"
//   supabase functions deploy contact --no-verify-jwt
//
// Die Funktion läuft in Deno; Typen für Deno stehen beim Deploy zur Verfügung.

type Lang = 'de' | 'en';

interface Payload {
  name?: unknown;
  company?: unknown;
  email?: unknown;
  subject?: unknown;
  message?: unknown;
  lang?: unknown;
  website?: unknown;
  startedAt?: unknown;
}

const ALLOWED_ORIGINS = ['https://pad-software.at', 'https://www.pad-software.at', 'http://localhost:5173', 'http://localhost:4173'];

const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
});

const json = (status: number, body: unknown, origin: string | null) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** einfache Bremse je Absenderadresse und IP: höchstens 5 Nachrichten pro Stunde (im Speicher der Instanz) */
const hits = new Map<string, number[]>();
function limited(key: string): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < 60 * 60 * 1000);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > 5;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (req.method !== 'POST') return json(405, { error: 'method' }, origin);

  let p: Payload;
  try {
    p = (await req.json()) as Payload;
  } catch {
    return json(400, { error: 'json' }, origin);
  }

  // Honigtopf gefüllt oder in unter 3 Sekunden abgeschickt → sehr wahrscheinlich ein Bot (still ablehnen)
  if (str(p.website, 200)) return json(400, { error: 'spam' }, origin);
  const started = typeof p.startedAt === 'number' ? p.startedAt : 0;
  if (started && Date.now() - started < 3000) return json(400, { error: 'spam' }, origin);

  const name = str(p.name, 120);
  const company = str(p.company, 160);
  const email = str(p.email, 200).toLowerCase();
  const subject = str(p.subject, 200);
  const message = str(p.message, 5000);
  const lang: Lang = p.lang === 'en' ? 'en' : 'de';
  if (!name || !EMAIL_RE.test(email) || !subject || message.length < 10) return json(422, { error: 'validation' }, origin);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (limited(email) || limited(ip)) return json(429, { error: 'rate' }, origin);

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const to = Deno.env.get('CONTACT_TO') ?? 'office@pad-software.at';
  const from = Deno.env.get('CONTACT_FROM') ?? 'PAD Software <kontakt@pad-software.at>';
  if (!apiKey) return json(501, { error: 'not-configured' }, origin);

  // Sicherung in der Datenbank (optional: scheitert sie, wird die Mail trotzdem verschickt)
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (url && key) {
      await fetch(`${url}/rest/v1/contact_messages`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ name, company, email, subject, message, lang, ip }),
      });
    }
  } catch {
    /* Sicherung ist nicht Pflicht */
  }

  const text = [`Name: ${name}`, company ? `Unternehmen: ${company}` : '', `E-Mail: ${email}`, `Sprache: ${lang}`, '', message].filter((l) => l !== '').join('\n');
  const html = `<p><strong>Name:</strong> ${esc(name)}<br>${company ? `<strong>Unternehmen:</strong> ${esc(company)}<br>` : ''}<strong>E-Mail:</strong> ${esc(email)}<br><strong>Sprache:</strong> ${lang}</p><p style="white-space:pre-wrap">${esc(message)}</p>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], reply_to: email, subject: `[Website] ${subject}`, text, html }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    console.error('resend', r.status, detail);
    return json(502, { error: 'mail' }, origin);
  }
  return json(200, { ok: true }, origin);
});
