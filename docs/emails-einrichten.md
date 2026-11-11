# E-Mails von PAD Software statt von Supabase

Die Anmelde-E-Mails (Passwort zurücksetzen, Registrierung bestätigen, E-Mail-Adresse ändern …) verschickt
Supabase. Ohne eigene Einstellung kommen sie von „Supabase Auth“ (noreply@mail.app.supabase.io), auf Englisch
und mit wenigen Mails pro Stunde. So kommen sie stattdessen von **PAD Software &lt;noreply@pad-software.at&gt;**,
auf Deutsch und mit Logo – über Resend, das schon für das Kontaktformular eingerichtet ist (kostenlos bis
3.000 Mails im Monat, 100 am Tag). Am Code der App ändert sich nichts.

## 1. Resend: Domain prüfen und Schlüssel anlegen (5 Minuten)

1. https://resend.com → **Domains**: `pad-software.at` muss dort mit **Verified** stehen
   (wurde für das Kontaktformular eingerichtet, siehe `docs/kontaktformular.md`).
2. **API Keys** → **Create API Key**:
   - Name: `supabase-auth`
   - Permission: **Sending access**, Domain: `pad-software.at`
   - **Add** → den Schlüssel (`re_…`) einmal kopieren. Nicht in den Chat schreiben.

## 2. Supabase: eigenen Versand einschalten (5 Minuten)

Supabase-Projekt → links **Authentication** → **Emails** → Reiter **SMTP Settings** →
**Enable Custom SMTP** einschalten:

| Feld | Wert |
|---|---|
| Sender email | `noreply@pad-software.at` |
| Sender name | `PAD Software` |
| Host | `smtp.resend.com` |
| Port number | `465` |
| Minimum interval between emails | `60` (Sekunden, Standard lassen) |
| Username | `resend` |
| Password | der Resend-Schlüssel `re_…` aus Schritt 1 |

**Save changes**.

Danach unter **Authentication** → **Rate Limits** den Wert „Rate limit for sending emails“ z. B. auf **60 pro Stunde**
setzen (mit eigenem Versand frei einstellbar; der Standard ist sehr niedrig).

## 3. Supabase: Texte auf Deutsch (10 Minuten)

**Authentication** → **Emails** → Reiter **Templates**. Für jede Vorlage Betreff und Inhalt aus
`docs/supabase/email-vorlagen.html` übernehmen (Abschnitt je Vorlage, Inhalt zwischen den Markierungen
vollständig einfügen) und **Save**:

- **Reset Password** (Passwort zurücksetzen) – die wichtigste
- **Confirm signup** (Registrierung bestätigen)
- **Change Email Address** (neue E-Mail-Adresse bestätigen)
- **Magic Link** (Anmeldelink)
- **Invite user** (Einladung)
- **Reauthentication** (Bestätigungscode)

Die Platzhalter in doppelten geschweiften Klammern (z. B. `{{ .ConfirmationURL }}`) genau so lassen – Supabase
setzt dort den Link bzw. Code ein.

## 4. Testen

In der App abmelden → **Anmelden** → **Passwort vergessen?** → eigene Adresse eingeben. Die Mail muss von
**PAD Software** kommen, auf Deutsch, mit Logo; der Link öffnet „Neues Passwort“ in BauPad.

Kommt nichts an: Spam-Ordner prüfen; in Resend unter **Emails** sieht man jede Mail mit Status. Steht dort nichts,
in Supabase unter **Authentication** → **Logs** nach Fehlern sehen (häufig: Schlüssel falsch kopiert oder Domain
nicht verifiziert).

**Eingerichtet am 11.11.2026** – Absender PAD Software über Resend, deutsche Vorlagen, Test „Passwort vergessen?“ erfolgreich.
