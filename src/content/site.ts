/**
 * Texte der öffentlichen Seiten (PAD Software als Firma, BauPad als erstes Produkt).
 *
 * Hier können Texte und Kontaktdaten ohne Programmierkenntnisse geändert werden:
 * nur den Text zwischen den Anführungszeichen anpassen. Leere Kontaktangaben ('')
 * werden auf der Seite als „wird ergänzt“ angezeigt.
 */
export const site = {
  company: 'PAD Software',
  product: 'BauPad',
  home: {
    /** Kleine Zeile über der Überschrift */
    eyebrow: 'PAD Software · Software für die Baustelle',
    title: 'Die Baustelle. In einer App.',
    lead:
      'BauPad vereint Aufmaß und Abrechnung, Arbeitereinteilung, Berichte und Fotodokumentation – ' +
      'auf Handy, Tablet und PC, auch ohne Internet in der Tiefgarage.',
    cta: 'BauPad öffnen',
    secondary: 'Funktionen ansehen',
    /** Die vier Werkzeuge von BauPad – nur, was es wirklich gibt */
    tools: [
      {
        id: 'projects' as const,
        color: '#ff6a13',
        title: 'Aufmaß & Abrechnung',
        text: 'Pläne öffnen oder zeichnen, Schadstellen und Flächen direkt im Plan erfassen.',
        points: ['Messungen mit Abzügen, Bauteilen und Leistungen', 'Aufmaß als Excel, Pläne als PDF', 'Rechnungen je Projekt aufteilen'],
      },
      {
        id: 'workers' as const,
        color: '#2f80ed',
        title: 'Arbeitereinteilung',
        text: 'Wochenplanung: Wer arbeitet wann auf welcher Baustelle.',
        points: ['Zuweisen per Klick, Urlaub und Krankenstand', 'Wochen weiterführen', 'Einteilung als PDF mit Firmenlogo'],
      },
      {
        id: 'reports' as const,
        color: '#a259ff',
        title: 'Berichte & Formulare',
        text: 'Regielisten, Bautagesberichte und Wochenberichte wie die gewohnten Formulare.',
        points: ['Baustelle und Mannschaft werden übernommen', 'Formular-PDF mit Logo und Unterschriftsfeldern', 'Mehrere Berichte als ein PDF'],
      },
      {
        id: 'photos' as const,
        color: '#111111',
        title: 'Fotodokumentation',
        text: 'Fotos je Baustelle, Kalenderwoche und Tag – mit eigenem Kamera-Modus.',
        points: ['Aufnahme direkt der Baustelle zuordnen', 'Galerie mit Suche, Zoom und Drehen', 'Foto-PDF und ZIP mit Datum'],
      },
    ],
    /** So läuft ein Tag mit BauPad */
    steps: [
      { title: 'Baustelle anlegen', text: 'Projekt mit Nummer, Adresse und Auftraggeber – einmal erfasst, überall übernommen.' },
      { title: 'Auf der Baustelle arbeiten', text: 'Messen, einteilen, fotografieren, Regieliste ausfüllen – auch ohne Empfang.' },
      { title: 'Ins Büro liefern', text: 'Excel, PDF und ZIP mit einem Tipp erstellen, teilen oder drucken.' },
    ],
    /** Hinweise unter den Funktionen */
    facts: ['Funktioniert offline', 'Installation ohne App Store', 'iPhone, iPad, Android und PC', 'Daten bleiben auf dem Gerät'],
    companyTitle: 'Aus der Praxis, für die Praxis',
    companyText:
      'PAD Software entwickelt Werkzeuge für Baufirmen – entstanden auf den Baustellen der Betoninstandsetzung in Wien. ' +
      'BauPad ist unser erstes Produkt. Weitere folgen.',
    companyCta: 'Kontakt aufnehmen',
  },
  about: {
    title: 'Über uns',
    paragraphs: [
      'PAD Software ist ein junges Softwareunternehmen aus Wien. Wir bauen Werkzeuge für Baufirmen, die auf der Baustelle ' +
        'wirklich funktionieren: schnell, klar und auch ohne Internetverbindung.',
      'BauPad ist unser erstes Produkt. Es vereint Aufmaß und Abrechnung, Arbeitereinteilung, Berichte und Formulare sowie ' +
        'die Fotodokumentation in einer App – für Handy, Tablet und PC. Die Ergebnisse gehen als Excel, PDF oder ZIP ins Büro.',
      'Die Daten werden derzeit auf dem Gerät gespeichert. Eine gemeinsame Ablage für alle Geräte eines Unternehmens mit ' +
        'Benutzerkonten und Rollen ist in Vorbereitung.',
      'BauPad wird laufend weiterentwickelt – Anregungen aus der Praxis sind willkommen.',
    ],
  },
  contact: {
    title: 'Kontakt',
    intro: 'Du hast Fragen oder Anregungen zu BauPad? Wir freuen uns über deine Nachricht.',
    // Platzhalter – bitte ergänzen
    company: '',
    person: '',
    email: '',
    phone: '',
    address: '',
    /** Umsatzsteuer-ID und Firmenbuchnummer (Impressum) */
    uid: '',
    register: '',
  },
  footer: 'PAD Software · BauPad',
};
