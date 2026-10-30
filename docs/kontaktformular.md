# Kontaktformular einrichten (Supabase-Funktion + Resend)

Die Website hat ein Kontaktformular (Name, Unternehmen, E-Mail, Betreff, Nachricht). GitHub Pages kann keine
E-Mails verschicken, deshalb nimmt eine kleine Funktion im bestehenden Supabase-Projekt die Nachricht entgegen
und verschickt sie über den E-Mail-Dienst Resend an office@pad-software.at. Zusätzlich wird jede Nachricht in der
Tabelle `contact_messages` gesichert (längstens 12 Monate).

Solange die Funktion nicht eingerichtet ist, zeigt das Formular nach dem Absenden ehrlich: „Der Versand ist noch
nicht eingerichtet. Bitte direkt an office@pad-software.at schreiben.“ Es wird nie ein Erfolg vorgetäuscht.

Kosten: Resend ist bis 3.000 E-Mails im Monat kostenlos, Supabase-Funktionen sind im Free-Plan enthalten.

## 1. Resend-Konto und Domain (etwa 15 Minuten)

1. https://resend.com → „Sign up“ mit office@pad-software.at (oder deiner Gmail-Adresse).
2. Links „Domains“ → „Add Domain“: `pad-software.at`, Region **EU (Ireland)** wählen.
3. Resend zeigt DNS-Einträge (ein TXT für SPF, ein TXT/CNAME für DKIM, optional MX für Rückläufer).
   Diese bei World4You unter „DNS“ für pad-software.at eintragen – Name und Wert genau so wie angezeigt.
   Hinweis: Die bestehenden MX-Einträge für dein Postfach **nicht** ändern.
4. Zurück in Resend auf „Verify“. Das kann bis zu einer Stunde dauern, meist geht es in Minuten.
5. Links „API Keys“ → „Create API Key“: Name „BauPad Kontaktformular“, Permission „Sending access“,
   Domain pad-software.at. Den Schlüssel (beginnt mit `re_`) sofort kopieren – er wird nur einmal angezeigt.
   **Nicht in den Chat schreiben.**

## 2. Tabelle anlegen (1 Minute)

Supabase → SQL Editor → New query → Inhalt von `docs/supabase/contact.sql` einfügen → Run.

## 3. Funktion veröffentlichen

Variante A, im Browser (ohne Installation):
1. Supabase → „Edge Functions“ → „Deploy a new function“ → „Via Editor“.
2. Name: `contact`. Den Inhalt von `supabase/functions/contact/index.ts` in den Editor einfügen → „Deploy“.
3. In den Einstellungen der Funktion **„Verify JWT“ ausschalten** (das Formular wird ohne Anmeldung benutzt).
4. „Edge Functions“ → „Secrets“ → hinzufügen:
   - `RESEND_API_KEY` = der Schlüssel aus Schritt 1
   - `CONTACT_TO` = `office@pad-software.at`
   - `CONTACT_FROM` = `PAD Software <kontakt@pad-software.at>` (die Adresse muss zur verifizierten Domain gehören)

Variante B, mit der Supabase-CLI am PC:
```
npx supabase login
npx supabase link --project-ref knaskwuhjixxpnqjfqpx
npx supabase secrets set RESEND_API_KEY=re_… CONTACT_TO=office@pad-software.at "CONTACT_FROM=PAD Software <kontakt@pad-software.at>"
npx supabase functions deploy contact --no-verify-jwt
```

## 4. Prüfen

1. https://pad-software.at/kontakt öffnen, Formular ausfüllen, absenden.
2. Es muss die Danke-Seite erscheinen und die Nachricht in office@pad-software.at ankommen (Antworten geht
   direkt an die Absenderadresse, sie steht als Reply-To drin).
3. In Supabase → Table Editor → `contact_messages` steht die Nachricht ebenfalls.

## Spam-Schutz und Datenschutz

- Unsichtbares Honigtopf-Feld, Mindestdauer 3 Sekunden bis zum Absenden, höchstens 5 Nachrichten je Stunde
  und Absender bzw. IP-Adresse, Längenbegrenzung aller Felder.
- Verarbeitet werden nur die Formularfelder, Sprache und die IP-Adresse (für die Bremse); die
  Datenschutzerklärung beschreibt das unter „Kontaktformular“ (Supabase EU/Irland, Resend für den Versand).
- Nachrichten in `contact_messages` nach 12 Monaten löschen: `select public.cleanup_contact_messages();`
