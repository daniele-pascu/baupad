/**
 * Vertrag zur Auftragsverarbeitung (AVV, Art. 28 DSGVO) zwischen der Kundenfirma (Verantwortliche) und PAD Software
 * (Auftragsverarbeiter) für BauPad – dazu Anlage 1 (technische und organisatorische Maßnahmen) und Anlage 2
 * (Unterauftragsverarbeiter). Beschreibt nur, was BauPad tatsächlich tut. Vertragssprache Deutsch (auch auf der
 * englischen Seite). Platzhalter {company}, {address}, {email} kommen aus contact-data.ts.
 *
 * Stand und Änderungen hier pflegen; vor der Verwendung rechtlich prüfen lassen.
 */
export interface AvvSection {
  h: string;
  p?: string[];
  list?: string[];
}

export const AVV_STAND = 'November 2026';

export const AVV_INTRO =
  'Dieser Vertrag gilt für jede Firma, die BauPad mit einem Arbeitsbereich (zentrale Ablage) nutzt. Er wird mit der Freischaltung des Arbeitsbereichs Teil des Nutzungsvertrags. Eine unterschriebene Fassung senden wir auf Anfrage an {email}.';

export const AVV_SECTIONS: AvvSection[] = [
  {
    h: '1. Vertragspartner',
    p: [
      'Verantwortlicher (Auftraggeber): die Firma, die BauPad mit einem eigenen Arbeitsbereich nutzt (im Folgenden „Kunde“), vertreten durch den Admin des Arbeitsbereichs.',
      'Auftragsverarbeiter (Auftragnehmer): {company}{address}{email} (im Folgenden „PAD Software“).',
    ],
  },
  {
    h: '2. Gegenstand und Dauer',
    p: [
      'PAD Software verarbeitet personenbezogene Daten im Auftrag des Kunden, um die Software BauPad bereitzustellen: Speicherung und Abgleich der Inhalte des Arbeitsbereichs zwischen den Geräten der Benutzer des Kunden, Benutzerverwaltung, Sicherungen und Wiederherstellung sowie Unterstützung im Störungsfall.',
      'Der Vertrag gilt, solange der Kunde einen Arbeitsbereich in BauPad hat. Danach gilt Punkt 10 (Löschung und Rückgabe).',
    ],
  },
  {
    h: '3. Art der Daten und betroffene Personen',
    list: [
      'Benutzer des Kunden: Name, E-Mail-Adresse, Telefon (freiwillig), Funktion, freigegebene Tools und Projekte, Zeitpunkte der Anmeldung.',
      'Beschäftigte des Kunden (Personalliste, Einteilung, Zeitaufzeichnung): Name, Personalnummer, Telefon, Qualifikation, Funktion, Einteilung auf Baustellen, Arbeitszeiten, Abwesenheiten (Urlaub, Krankenstand – ohne Diagnosen).',
      'Auftraggeber, Ansprechpartner und Lieferanten des Kunden: Name, Firma, Anschrift, Kontaktdaten, soweit der Kunde sie in Projekten, Berichten, Formularen oder Bestellungen erfasst.',
      'Inhalte der Projekte: Pläne, Aufmaße, Leistungsverzeichnisse mit Preisen, Berichte, Mängel, Formulare, Material und Fotos; Fotos können Personen und Aufnahmezeit zeigen bzw. enthalten (keine Ortsangaben).',
      'Besondere Kategorien nach Art. 9 DSGVO sind nicht vorgesehen. Der Kunde erfasst keine Gesundheitsdaten (z. B. Diagnosen) in BauPad.',
    ],
  },
  {
    h: '4. Weisungen',
    p: [
      'PAD Software verarbeitet die Daten nur auf dokumentierte Weisung des Kunden. Weisungen sind dieser Vertrag und die Bedienung von BauPad durch die Benutzer des Kunden (Anlegen, Ändern, Freigeben, Löschen); weitere Weisungen in Textform an {email}.',
      'Hält PAD Software eine Weisung für rechtswidrig, weist sie den Kunden unverzüglich darauf hin. Eine Verarbeitung für eigene Zwecke von PAD Software findet nicht statt; ausgenommen sind Konto- und Abrechnungsdaten der Vertragsbeziehung selbst.',
    ],
  },
  {
    h: '5. Vertraulichkeit',
    p: ['Alle Personen, die bei PAD Software Zugang zu Daten des Kunden haben könnten, sind zur Vertraulichkeit verpflichtet (Datengeheimnis nach § 6 DSG). Im Regelbetrieb sieht PAD Software die Inhalte des Kunden nicht; ein Zugriff erfolgt nur, wenn es für Störungsbehebung oder Wiederherstellung nötig ist und der Kunde es veranlasst hat.'],
  },
  {
    h: '6. Sicherheit der Verarbeitung',
    p: ['PAD Software trifft die technischen und organisatorischen Maßnahmen nach Art. 32 DSGVO, die in Anlage 1 beschrieben sind. Sie dürfen weiterentwickelt werden, solange das Schutzniveau nicht sinkt.'],
  },
  {
    h: '7. Unterauftragsverarbeiter',
    p: [
      'Der Kunde stimmt den in Anlage 2 genannten Unterauftragsverarbeitern zu. Mit jedem besteht ein Vertrag, der mindestens das Schutzniveau dieses Vertrags gewährleistet.',
      'Über neue oder ersetzte Unterauftragsverarbeiter informiert PAD Software den Kunden mindestens 30 Tage vorher per E-Mail an den Admin. Der Kunde kann aus wichtigem datenschutzrechtlichem Grund widersprechen; ist keine Einigung möglich, kann er den Vertrag ohne Kosten beenden.',
    ],
  },
  {
    h: '8. Übermittlung in Drittländer',
    p: ['Die Inhalte des Arbeitsbereichs werden in der EU gespeichert (Anlage 2). Soweit Unterauftragsverarbeiter mit Sitz in den USA Daten verarbeiten oder darauf zugreifen können, erfolgt dies auf Grundlage des EU-US Data Privacy Framework bzw. der Standardvertragsklauseln der EU-Kommission.'],
  },
  {
    h: '9. Unterstützung des Kunden',
    list: [
      'Rechte der betroffenen Personen (Art. 12–23 DSGVO): Auskunft, Berichtigung und Löschung kann der Kunde in BauPad selbst vornehmen; PAD Software unterstützt auf Anfrage und leitet Anfragen, die direkt bei ihr eingehen, unverzüglich an den Kunden weiter.',
      'Verletzungen des Schutzes personenbezogener Daten meldet PAD Software dem Kunden unverzüglich, möglichst innerhalb von 24 Stunden nach Bekanntwerden, mit den Angaben nach Art. 33 Abs. 3 DSGVO, soweit bekannt.',
      'PAD Software unterstützt den Kunden bei Datenschutz-Folgenabschätzungen und Konsultationen der Aufsichtsbehörde (Art. 35, 36 DSGVO), soweit es die eigene Verarbeitung betrifft.',
    ],
  },
  {
    h: '10. Löschung und Rückgabe',
    p: [
      'Nach Ende des Vertrags kann der Kunde seine Daten innerhalb von 30 Tagen über die Exporte in BauPad (Excel, PDF, ZIP mit Fotos) sichern oder eine Herausgabe in einem gängigen Format verlangen. Danach löscht PAD Software den Arbeitsbereich mit allen Inhalten und Dateien.',
      'In Sicherungen bleiben Daten bis zum Ablauf ihrer Aufbewahrung enthalten (tägliche Stände 30 Tage, Monatsstände zwölf Monate) und werden dann gelöscht; bis dahin sind sie verschlüsselt und nur für eine Wiederherstellung zugänglich. Gesetzliche Aufbewahrungspflichten bleiben unberührt.',
    ],
  },
  {
    h: '11. Nachweise und Kontrollen',
    p: ['PAD Software stellt dem Kunden die zum Nachweis der Pflichten nötigen Informationen zur Verfügung, insbesondere diesen Vertrag mit Anlagen und die Nachweise der Unterauftragsverarbeiter (z. B. Zertifikate). Kontrollen vor Ort sind nach Anmeldung mit angemessener Frist während der Geschäftszeiten möglich; Kosten dafür trägt der Kunde, außer die Kontrolle deckt einen Verstoß auf.'],
  },
  {
    h: '12. Schlussbestimmungen',
    p: [
      'Es gilt österreichisches Recht unter Ausschluss der Verweisungsnormen. Änderungen bedürfen der Textform. Ist eine Bestimmung unwirksam, bleibt der Vertrag im Übrigen wirksam.',
      'Bei Widersprüchen zwischen diesem Vertrag und anderen Vereinbarungen geht dieser Vertrag für den Datenschutz vor.',
    ],
  },
];

/** Anlage 1: technische und organisatorische Maßnahmen (Art. 32 DSGVO) */
export const AVV_TOM: AvvSection[] = [
  {
    h: 'Vertraulichkeit',
    list: [
      'Mandantentrennung: Jede Firma hat einen eigenen Arbeitsbereich; die Datenbank lässt nur Mitglieder dieses Arbeitsbereichs zu (Zugriffsregeln je Zeile), Dateien liegen je Firma in einem eigenen Bereich.',
      'Rechte je Benutzer am Server: Polier und Arbeiter erhalten nur Daten der für sie freigegebenen Projekte und Tools, Preise nur mit eigener Freigabe; Stunden nur im freigegebenen Umfang. Die Prüfung erfolgt am Server, nicht nur in der App.',
      'Anmeldung mit E-Mail und Passwort (gespeichert nur als Prüfwert) oder über Google, Apple bzw. Microsoft; Konten können vom Admin gesperrt werden.',
      'Dateien (Pläne, Fotos, PDFs) sind privat und nur über kurzlebige, signierte Links erreichbar (15 Minuten zum Hochladen, 60 Minuten zum Ansehen); die Zugangsschlüssel zum Speicher kennt nur der Server.',
      'Geräte: optionale App-Sperre mit PIN oder Face ID/Fingerabdruck; nach 10 falschen PINs, beim Abmelden mit „Daten löschen“ und automatisch bei beendetem Zugang zur Firma löscht die App ihre Daten auf dem Gerät.',
      'Rechenzentren der Unterauftragsverarbeiter mit Zutrittskontrolle und Zertifizierung (laut Anbieter: Hetzner ISO/IEC 27001, Supabase SOC 2 Typ 2).',
      'Zugänge von PAD Software zu den Diensten nur persönlich, mit starkem Passwort und Zwei-Faktor-Anmeldung.',
    ],
  },
  {
    h: 'Integrität',
    list: [
      'Übertragung ausschließlich verschlüsselt (HTTPS/TLS) zwischen Gerät, Server und Speicher.',
      'Änderungen werden je Datensatz mit Zeitstempel geführt; gelöschte Einträge werden als gelöscht markiert und an alle Geräte weitergegeben.',
    ],
  },
  {
    h: 'Verfügbarkeit und Belastbarkeit',
    list: [
      'Arbeiten ohne Internet: Inhalte liegen zusätzlich auf den Geräten und werden bei Verbindung abgeglichen.',
      'Tägliche Sicherung der Datenbank: tägliche Stände 30 Tage, Monatsstände zwölf Monate; verschlüsselt (AES-256), getrennt von den laufenden Daten in einem eigenen Speicher und während der Aufbewahrung gegen Löschen und Überschreiben gesperrt.',
      'Wiederherstellung je Firma möglich (Datensätze und Foto-Verzeichnis eines bestimmten Tages).',
    ],
  },
  {
    h: 'Verfahren zur regelmäßigen Überprüfung',
    list: [
      'Automatische Tests der Zugriffsregeln und der Sicherung bei jeder Änderung der Software.',
      'Überprüfung dieser Maßnahmen mindestens einmal jährlich und bei wesentlichen Änderungen.',
      'Datenschutz durch Voreinstellungen: keine Tracking-Cookies, keine Statistik- oder Werbe-Tools, Fotos ohne Ortsangaben.',
    ],
  },
];

/** Anlage 2: Unterauftragsverarbeiter */
export const AVV_SUBPROCESSORS: { name: string; task: string; where: string }[] = [
  { name: 'Supabase Inc., USA', task: 'Datenbank (Datensätze des Arbeitsbereichs, Benutzerkonten, Anmeldung), Server-Funktionen', where: 'Rechenzentrum in der EU (Irland)' },
  { name: 'Hetzner Online GmbH, Deutschland', task: 'Speicher für Dateien (Pläne, Fotos, PDFs) und für die Sicherungen', where: 'Rechenzentren in Deutschland' },
  { name: 'Plus Five Five, Inc. (Resend), USA', task: 'Versand von E-Mails zum Konto (Bestätigung, Passwort) und zum Kontaktformular', where: 'USA (Data Privacy Framework bzw. Standardvertragsklauseln)' },
  { name: 'GitHub Inc., USA', task: 'Auslieferung der Programmdateien der App und der Website (keine Inhalte des Arbeitsbereichs)', where: 'weltweit verteiltes Netz (Data Privacy Framework bzw. Standardvertragsklauseln)' },
];
