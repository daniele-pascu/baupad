# Android-App (Capacitor)

Die Android-App ist die Web-App aus `dist`, verpackt mit Capacitor. Alles Weitere (Anmeldung, Ablage, Werkzeuge)
läuft unverändert; nur die Fotodokumentation nutzt in der App die echte Kamera des Geräts.

## Aufbau
```
capacitor.config.ts         App-ID at.padsoftware.baupad, Name BauPad, Web-Ordner dist, Startbild
android/                    Android-Projekt (Gradle). Symbole: app/src/main/res/mipmap-*, Startbild: drawable-*
src/lib/native.ts           isNativeApp(), nativeTakePhoto() (echte Kamera)
.github/workflows/android.yml   Build auf GitHub (Android-SDK ist dort vorhanden)
```
In der App gilt: kein Service Worker (Dateien liegen ohnehin lokal), Website-Seiten leiten zur Anmeldung,
Ursprung ist `https://localhost` – deshalb steht er in den CORS-Listen der Supabase-Funktionen und am Bucket.

## Test-APK holen und installieren
1. GitHub → Repository `baupad` → **Actions** → Lauf „Android-App“ (läuft bei jedem Push mit App-Änderungen, oder „Run workflow“).
2. Unten bei **Artifacts** „BauPad-Android-APK“ herunterladen (ZIP) → entpacken → `app-debug.apk`.
3. Datei aufs Android-Handy (z. B. per Google Drive oder USB) → antippen → „Installation aus unbekannten Quellen“ einmalig erlauben.
4. Beim ersten Foto fragt die App nach der Kamera-Berechtigung.

Die Test-APK ist mit einem Entwicklungsschlüssel signiert – nur zum Testen, nicht für den Store.

## Neue Version
- `android/app/build.gradle`: `versionCode` um 1 erhöhen, `versionName` anpassen (z. B. 1.0.1). Der Play Store verlangt je Upload einen höheren versionCode.
- Push auf `main` baut die APK neu.

## Play Store (zum Verkaufsstart)
1. **Konto:** https://play.google.com/console → Entwicklerkonto (25 USD einmalig) mit office@pad-software.at; Identitätsprüfung.
2. **Upload-Schlüssel** (einmalig, lokal am PC mit Java):
   `keytool -genkeypair -v -keystore upload.keystore -alias baupad -keyalg RSA -keysize 2048 -validity 10000`
   Keystore und Passwörter sicher aufbewahren (Passwort-Manager) – nie in den Code, nie in den Chat.
3. **GitHub-Secrets** (Repository → Settings → Secrets and variables → Actions):
   `ANDROID_KEYSTORE_BASE64` (Inhalt von `base64 -w0 upload.keystore`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`baupad`), `ANDROID_KEY_PASSWORD`;
   Variable `ANDROID_RELEASE` = `true`. Dann Actions → „Android-App“ → „Run workflow“ → Artefakt „BauPad-Android-AAB“.
4. **Play Console:** App anlegen (BauPad, Deutsch, App, kostenlos – Abo läuft über die Website), Datenschutzerklärung https://pad-software.at/datenschutz,
   Konto löschen https://pad-software.at/konto-loeschen, Datensicherheit-Formular (Fotos, E-Mail, Name; Übertragung verschlüsselt; Löschung auf Anfrage),
   Store-Eintrag (Symbol 512 px aus `public/icons/icon-512.png`, Funktionsgrafik 1024×500, mind. 2 Screenshots), Inhaltseinstufung, Zielgruppe (Erwachsene),
   interner Test → geschlossener Test → Produktion. AAB hochladen.
5. **Später:** Anmeldung mit Google/Apple/Microsoft in der App braucht Deep Links (Rücksprung in die App) – bis dahin E-Mail + Passwort.

## iPhone (offen)
Gleiche Basis (`npx cap add ios`), Bauen nur auf einem Mac mit Xcode oder über einen Cloud-Build-Dienst; Apple Developer Program 99 USD/Jahr.
