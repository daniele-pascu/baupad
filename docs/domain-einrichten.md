# Domain einrichten: pad-software.at und baupad.at

Die Website und die App werden weiter über GitHub Pages ausgeliefert, nur unter der eigenen Adresse.
Reihenfolge: zuerst DNS bei World4You, dann Daten sichern, zuletzt die Domain bei GitHub eintragen.

## 1. DNS bei World4You (pad-software.at)

World4You → „Meine Domains“ → pad-software.at → „DNS-Verwaltung“ (bzw. „Nameserver / DNS-Einträge“).

**Vorhandene MX-Einträge nicht löschen**, sonst geht die E-Mail nicht mehr. Nur A- und CNAME-Einträge anpassen.

Bestehende A-Einträge für die Domain selbst (Host leer oder `@`) entfernen und diese vier anlegen:

| Typ | Host | Wert |
|---|---|---|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |

Dazu ein CNAME für `www`:

| Typ | Host | Wert |
|---|---|---|
| CNAME | www | daniele-pascu.github.io |

Falls World4You für `www` bereits einen A-Eintrag hat, diesen vorher löschen (CNAME und A dürfen für denselben Host nicht beide existieren).
Die Umstellung dauert üblicherweise 10 Minuten bis einige Stunden.

Prüfen (am PC in der Eingabeaufforderung): `nslookup pad-software.at` muss eine der vier 185.199.-Adressen zeigen.

## 2. Vorhandene Daten auf den Geräten sichern

Die App speichert Projekte, Fotos und Berichte im Browser-Speicher **pro Adresse**. Nach dem Wechsel auf
pad-software.at startet die App leer, die Daten unter daniele-pascu.github.io bleiben dort, sind aber nicht mehr
erreichbar, weil GitHub die alte Adresse auf die neue weiterleitet.

Deshalb vor Schritt 3 auf jedem Gerät, auf dem Daten liegen:

- Projekte: Startseite → pro Projekt „Sicherung“ (Datei speichern).
- Arbeitereinteilung: Einstellungen → Sicherung exportieren.
- Berichte: Berichte → Sicherung exportieren.
- Fotos: pro Baustelle „Alle als ZIP“.

Nach dem Wechsel: App unter der neuen Adresse öffnen, Sicherungen importieren, Fotos über „Fotos auswählen“
wieder hochladen. Testdaten können auch einfach verfallen.

Die installierte App (Startbildschirm) zeigt danach noch auf die alte Adresse. Alte App entfernen und von
https://pad-software.at neu installieren.

## 3. Domain bei GitHub eintragen

GitHub → Repository `baupad` → Settings → Pages:

1. „Custom domain“: `pad-software.at` eintragen, „Save“.
2. GitHub prüft die DNS-Einträge (grüner Haken). Dauert nach der DNS-Umstellung wenige Minuten, in seltenen Fällen bis zu einem Tag.
3. Sobald das Zertifikat ausgestellt ist, „Enforce HTTPS“ anhaken.

Danach ist alles unter https://pad-software.at erreichbar, www.pad-software.at leitet dorthin weiter,
die alte GitHub-Adresse ebenfalls.

Empfehlung zusätzlich: Settings → Pages → „Verified domains“ im GitHub-Profil (Settings → Pages → Add a domain) eintragen,
damit niemand anders die Domain auf GitHub Pages nutzen kann.

## 4. baupad.at

GitHub Pages erlaubt nur eine Domain pro Repository. baupad.at wird deshalb bei World4You weitergeleitet:

World4You → baupad.at → „Weiterleitung“ (Domain-Forwarding) → Ziel `https://pad-software.at/`, Typ „permanent (301)“,
„mit Pfad“ falls angeboten. www.baupad.at gleich behandeln.

Später, wenn die App eine eigene Adresse bekommen soll (z. B. app.baupad.at), legen wir dafür einen zweiten Pages-Auftritt an.

## 5. Was ich danach anpasse

- Supabase Site URL und Redirect URLs auf https://pad-software.at (siehe `anmeldung-einrichten.md`).
- Kontakt, Impressum und Datenschutz: Website-Adresse und Firmendaten eintragen.
- Später: SPF- und DKIM-Einträge für Mails von Supabase und Stripe (TXT-Einträge, ich liefere die Werte).

## Kosten

Keine. GitHub Pages inklusive Zertifikat ist kostenlos, Domains laufen bei World4You.
