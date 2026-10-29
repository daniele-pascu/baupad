# BauPad in Google Play und im App Store

Beide Store-Apps sind Hüllen, die BauPad von https://pad-software.at laden (Entscheidung: Updates kommen
automatisch über die Website, Store-Updates nur bei Änderungen an der Hülle). Keine Käufe in der App.

Vorbereitet im Repository: Web-App-Manifest (Name, Symbole, Kategorien), Datenschutz unter
https://pad-software.at/datenschutz/, Konto-Löschung unter https://pad-software.at/konto-loeschen/,
Konto löschen in der App (Konto → E-Mail und Konto).

## A. Google Play (zuerst)

### 1. Entwicklerkonto (einmalig 25 US-Dollar)
1. https://play.google.com/console/signup → mit dem Google-Konto der Firma anmelden.
2. Kontotyp: **Organisation**, wenn ein Gewerbe/Firma besteht (braucht D-U-N-S-Nummer, kostenlos bei
   Dun & Bradstreet, Dauer bis zu 30 Tage), sonst **Privatperson**. Hinweis: Privatkonten müssen vor der
   Veröffentlichung einen geschlossenen Test mit mindestens 12 Testern über 14 Tage durchlaufen.
3. Identität bestätigen (Ausweis), Gebühr zahlen.

### 2. Android-Paket erzeugen (ohne Android Studio)
1. https://www.pwabuilder.com öffnen, `https://pad-software.at` eingeben, „Start“.
2. „Package for stores“ → **Android**. Einstellungen:
   - Package ID: `com.padsoftware.baupad`
   - App name: BauPad, Launcher name: BauPad
   - Signing key: **Create new** (PWABuilder erzeugt den Schlüssel). Die ZIP enthält `signing.keystore`,
     `signing-key-info.txt` und `assetlinks.json`. Keystore und Passwörter sicher aufbewahren (Passwortmanager),
     ohne sie gibt es keine Updates.
3. ZIP herunterladen. Darin: `app-release-bundle.aab` (für Play), `assetlinks.json`.

### 3. Domain-Verknüpfung (damit die App ohne Browserleiste läuft)
Den Inhalt von `assetlinks.json` aus der ZIP an mich (oder nach `public/.well-known/assetlinks.json` legen).
Nach der Veröffentlichung erreichbar unter https://pad-software.at/.well-known/assetlinks.json.
Wenn Play App Signing aktiv ist (Standard), zusätzlich den SHA-256-Fingerabdruck aus Play Console →
Einrichten → App-Integrität → „App-Signaturschlüssel“ in die Datei aufnehmen (zweiter Eintrag).

### 4. App in der Play Console anlegen
1. „App erstellen“: Name BauPad, Sprache Deutsch, App, kostenlos.
2. Dashboard „App einrichten“ (alles Pflicht):
   - Datenschutzerklärung: `https://pad-software.at/datenschutz/`
   - App-Zugriff: „Alle Funktionen sind ohne besondere Zugangsdaten verfügbar“ → **nein**: Anmeldung nötig.
     Testzugang angeben: eigenes Testkonto (E-Mail + Passwort) anlegen und eintragen.
   - Werbung: keine. Inhaltsfreigabe: Fragebogen (Dienstprogramm, keine sensiblen Inhalte).
   - Zielgruppe: ab 18. News-App: nein. Datensicherheit: siehe unten.
   - Konto löschen: `https://pad-software.at/konto-loeschen/`
   - Kategorie: Business. Kontakt: E-Mail der Firma.
3. Store-Eintrag: Kurzbeschreibung, lange Beschreibung (Texte aus `src/content/site.ts`), Symbol 512×512
   (`public/icons/icon-512.png`), Funktionsgrafik 1024×500, mindestens 2 Handy-Screenshots
   (`public/site/*-iphone.jpg` eignen sich, 1080×2340 empfohlen), optional Tablet-Screenshots.
4. Release: „Testen und veröffentlichen“ → Interner Test → AAB hochladen → Tester (eigene E-Mail) → Link testen.
   Dann geschlossener Test (Privatkonto: 12 Tester, 14 Tage) → Produktion.

### Datensicherheit (Formular)
- Erhoben: E-Mail-Adresse, Name, Telefon (optional), Fotos (nur auf dem Gerät, nicht übertragen – bis zum
  Online-Speicher). Zweck: App-Funktionen, Kontoverwaltung. Verschlüsselt übertragen: ja. Löschung: ja, in der App.
- Keine Weitergabe an Dritte, keine Werbung, keine Standortdaten.

## B. Apple App Store (danach)

Voraussetzungen:
- Apple Developer Program, 99 US-Dollar im Jahr: https://developer.apple.com/programs/enroll/
  (als Organisation mit D-U-N-S-Nummer, als Privatperson mit Apple-ID und Ausweis).
- Ein Mac mit Xcode **oder** ein Build-Dienst in der Cloud (z. B. Codemagic, kostenloses Kontingent), der die
  iOS-App ohne eigenen Mac baut und an App Store Connect übergibt.
- „Mit Apple anmelden“ muss in Supabase eingerichtet sein (Pflicht, sobald Google-Login angeboten wird).

Weg: Capacitor-Projekt (iOS-Hülle mit Kamera-Berechtigung) im Repository, Build über Codemagic, Einreichung in
App Store Connect mit Screenshots (6,7" und 6,5" iPhone, 12,9" iPad), Datenschutz-Labels wie oben, Konto-Löschung.
Apple prüft strenger: Die App muss sich wie eine App anfühlen (Kamera, Offline, kein reines Website-Fenster).
BauPad erfüllt das (Kamera-Modus, Offline-Betrieb, Installation), ein Rest-Risiko bei der Prüfung bleibt.

Ich lege das Capacitor-Projekt an, sobald das Developer Program freigeschaltet ist.
