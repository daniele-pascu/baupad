# Anmeldung einrichten: Supabase, Google, Microsoft, Apple

Diese Anleitung beschreibt, was du als Betreiber anlegen musst, damit die Anmeldung in BauPad funktioniert.
Du legst die Konten an, ich verbinde sie danach mit der App. Bitte keine Passwörter oder geheimen Schlüssel
in den Chat schreiben, nur die Werte, die unten als „öffentlich“ markiert sind.

## 1. Supabase (Benutzer, Firmen, Rechte)

Supabase speichert Benutzerkonten, Firmen und Rollen. Der kostenlose Plan reicht zum Start.

1. https://supabase.com öffnen, „Start your project“, Konto mit GitHub oder E-Mail anlegen.
2. „New organization“ anlegen, Name: PAD Software.
3. „New project“ anlegen:
   - Name: baupad
   - Database Password: ein langes Passwort erzeugen lassen und im Passwortmanager speichern (ich brauche es nicht).
   - Region: **Frankfurt (eu-central-1)**, damit die Daten in der EU liegen.
   - Plan: Free.
4. Warten, bis das Projekt fertig ist (etwa zwei Minuten).
5. Links „Project Settings“ → „API“. Dort stehen zwei Werte, die ich brauche:
   - **Project URL** (öffentlich), sieht aus wie `https://abcdefgh.supabase.co`
   - **anon public key** (öffentlich, darf in der App stehen)
   Den „service_role“-Schlüssel niemals weitergeben.
6. Links „Authentication“ → „URL Configuration“:
   - Site URL: `https://pad-software.at`
   - Redirect URLs („Add URL“, je ein Eintrag): `https://pad-software.at/**`, `https://www.pad-software.at/**`,
     `https://daniele-pascu.github.io/baupad/**`, `http://localhost:5173/**`
   Die App kehrt nach Google/Apple/Microsoft und aus E-Mail-Links auf die Seite ohne Hash zurück und
   tauscht dort den Code gegen die Sitzung (PKCE).
7. „Authentication“ → „Providers“ → „Email“: eingeschaltet lassen. „Confirm email“ eingeschaltet lassen
   (neue Benutzer bestätigen ihre Adresse per Link).

Schick mir: Project URL und anon key. (Erledigt am 29.10.2026: Projekt „BauPad“, Region West EU/Irland,
Zugangsdaten in `src/lib/supabase-config.ts`.)

## 1b. Datenbank einrichten (einmalig)

1. Im Supabase-Projekt links **SQL Editor** → **New query**.
2. Den gesamten Inhalt von `docs/supabase/schema.sql` einfügen und **Run** klicken. Unten muss „Success“ stehen.
   Das legt an: Arbeitsbereiche, Profile, Mitgliedschaften, Betreiber-Liste, Zugriffsregeln, den Automatismus
   „Registrierung → eigener Arbeitsbereich mit Admin“, `my_context()` und „Konto löschen“.
3. Betreiber: In der Tabelle `operators` (Table Editor) stehen die E-Mail-Adressen, die die Betreiber-Übersicht
   sehen. Vorbelegt ist danielepascu.a@gmail.com; später office@pad-software.at ergänzen.

Das Skript kann jederzeit erneut ausgeführt werden, Daten bleiben erhalten (zuletzt geändert: Baustellen-Zugriff je Benutzer, Werkzeuge im Kontext). Nach jeder Änderung an
`schema.sql` (steht im Commit-Text) bitte erneut ausführen.

Benutzerverwaltung (Einstellungen → Benutzer & Rollen) beim angemeldeten Admin: Einträge landen in der
Datenbank. Hat die Person schon ein BauPad-Konto, wird sie sofort Mitglied; sonst wird eine Einladung
gespeichert, und die Registrierung mit dieser E-Mail führt automatisch in den Arbeitsbereich des Admins
(kein eigener Arbeitsbereich). Eine Einladungs-E-Mail wird derzeit nicht verschickt (dafür wäre ein
E-Mail-Dienst nötig); der Admin sagt der Person Bescheid.

## 1c. Weitere Anmeldemethoden verbinden (optional)

Damit ein Benutzer unter Konto → „Passwort und Anmeldemethoden“ zusätzlich Google/Microsoft/Apple mit seinem
bestehenden Konto verbinden kann: Supabase → Authentication → Settings (bzw. „Sign In / Providers“) →
**„Allow manual linking“** einschalten. Ohne diese Einstellung meldet die App „noch nicht freigeschaltet“.

## 2. Google-Login

1. https://console.cloud.google.com öffnen, mit dem Google-Konto der Firma anmelden.
2. Oben „Projekt erstellen“: Name „BauPad“.
3. Links „APIs und Dienste“ → „OAuth-Zustimmungsbildschirm“:
   - Nutzertyp: Extern
   - App-Name: BauPad, Support-E-Mail: deine Firmenadresse, Entwicklerkontakt: deine Adresse
   - Logo kann später kommen. Speichern.
   - „Veröffentlichungsstatus“ auf „In Produktion“ stellen, sonst dürfen nur Testnutzer anmelden.
4. „APIs und Dienste“ → „Anmeldedaten“ → „Anmeldedaten erstellen“ → „OAuth-Client-ID“:
   - Anwendungstyp: Webanwendung, Name: BauPad Web
   - Autorisierte Weiterleitungs-URI: `https://<deine-project-url>.supabase.co/auth/v1/callback`
     (die Project URL aus Schritt 1, plus `/auth/v1/callback`)
5. Es erscheinen **Client-ID** und **Clientschlüssel**.
6. In Supabase: „Authentication“ → „Providers“ → „Google“ einschalten, Client-ID und Clientschlüssel eintragen, speichern.

Schick mir: nur die Nachricht, dass Google in Supabase eingeschaltet ist. Die Schlüssel bleiben bei dir.

## 3. Microsoft-Login (Outlook, Hotmail, Microsoft 365)

1. https://entra.microsoft.com öffnen, mit einem Microsoft-Konto anmelden (ein kostenloses reicht).
2. „Anwendungen“ → „App-Registrierungen“ → „Neue Registrierung“:
   - Name: BauPad
   - Unterstützte Kontotypen: „Konten in einem beliebigen Organisationsverzeichnis und persönliche Microsoft-Konten“
   - Umleitungs-URI: Web, `https://<deine-project-url>.supabase.co/auth/v1/callback`
3. Nach dem Anlegen: „Anwendungs-ID (Client)“ notieren.
4. „Zertifikate & Geheimnisse“ → „Neuer geheimer Clientschlüssel“, Laufzeit 24 Monate, den **Wert** sofort kopieren
   (wird nur einmal angezeigt).
5. In Supabase: „Authentication“ → „Providers“ → „Azure“ einschalten, Client-ID und Geheimnis eintragen,
   Azure Tenant: `common`. Speichern.

## 4. Apple-Login (erst mit dem Apple Developer Program)

Braucht das Apple Developer Program (99 US-Dollar im Jahr), das für den App Store ohnehin nötig ist.
Sobald es da ist, richte ich mit dir die „Services ID“ und den Schlüssel ein; das dauert etwa eine halbe Stunde.
Hinweis: Wenn die App im App Store Google-Login anbietet, verlangt Apple auch Apple-Login.

## 5. Was danach passiert

- Ich trage Project URL und anon key in die App ein und schalte die Anmeldung frei.
- Jede Registrierung legt automatisch einen Arbeitsbereich an, die Person ist dessen Admin (Einzelperson = Firma mit einem Benutzer).
- Die Benutzerliste aus den Einstellungen wird beim ersten Anmelden des Admins übernommen, Einladungen gehen per E-Mail hinaus.
- Danach kommt die zentrale Ablage (Hetzner Object Storage) für Fotos und Berichte.

## Kosten

- Supabase Free: 0 €, bis 50.000 monatlich aktive Benutzer, 500 MB Datenbank. Pro-Plan 25 US-Dollar im Monat, wenn nötig.
- Google Cloud OAuth: 0 €.
- Microsoft Entra App-Registrierung: 0 €.
- Apple Developer Program: 99 US-Dollar im Jahr.
