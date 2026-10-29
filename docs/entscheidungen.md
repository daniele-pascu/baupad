# Entscheidungen (Betreiber)

Festgelegte Grundsätze für BauPad / PAD Software. Bitte hier ergänzen, wenn sich etwas ändert.

## Firma und Produkt (Oktober 2026)
- Firma und Website: **PAD Software** (PAD = Initialen Pascu Andrea Daniele). Domain-Wunsch: pad-software.com / .at.
- Erstes Produkt: **BauPad**. Store-Anbieter ist die Firma, Bundle-Kennung z. B. `com.padsoftware.baupad`.

## Anmeldung (Oktober 2026)
- Anmelden und Registrieren in der App und auf der Website: Google, Apple, Microsoft (Outlook), E-Mail mit Passwort.
- Jede Registrierung legt einen Arbeitsbereich an; die Person ist Admin (Einzelperson = Firma mit einem Benutzer).
- Admin verwaltet Benutzer: E-Mail, Name, Funktion (Admin, Büro, Polier, Arbeiter), Werkzeuge, Paket, aktiv/gesperrt.
- Konto löschen muss in der App möglich sein (Apple-Vorgabe bei Registrierung in der App).
- Dienst: Supabase (Region Frankfurt). Fotos später: Hetzner Object Storage (EU).

## Abrechnung (Oktober 2026)
- **Keine In-App-Käufe** (kein Apple-Abo, kein Google-Abo). Grundlage: Apple-Regel 3.1.3(c) Enterprise Services, Verkauf an Firmen.
- Pakete werden **nur auf der Website** gekauft und verwaltet: **Karte, SEPA-Lastschrift, Rechnung mit Überweisung** (Stripe, alternativ Paddle).
- In der Store-App keine Preise, keine Kauf-Knöpfe, keine Links zum Kauf; nur „Paket wird vom Admin deiner Firma verwaltet“.
- Rechnungen an Firmen mit UID und Umsatzsteuer automatisch; Betreiber-Übersicht mit Firmen, Benutzern, Einnahmen.

## Stores (Oktober 2026)
- Store-Apps als Hülle, die die Web-App von der eigenen Adresse lädt (Updates automatisch, Store-Update nur bei Änderungen an der Hülle).
- Google Play zuerst, Apple danach (Developer Program nötig, damit auch „Mit Apple anmelden“).

## Domains (Oktober 2026)
- Gekauft bei World4You: **pad-software.at** (Website und App) und **baupad.at** (Weiterleitung auf pad-software.at).
- Hosting weiter über GitHub Pages mit eigener Domain; E-Mail über World4You (E-Mail Grow). Einrichtung: `docs/domain-einrichten.md`.
