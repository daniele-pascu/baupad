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
    eyebrow: 'PAD Software · Software für die Baustelle',
    title: 'BauPad. Die Baustelle in einer App.',
    lead: 'Aufmaß, Arbeitereinteilung, Berichte, Fotos und Mängelplan – am Handy auf der Baustelle, am PC im Büro. Auch ohne Internet.',
    cta: 'BauPad öffnen',
    secondary: 'Werkzeuge ansehen',
    /** Bilder im Kopfbereich (public/site) */
    heroImage: 'fotos-baustelle.jpg',
    heroPhone: 'kamera-iphone.jpg',
    /** Die vier Werkzeuge von BauPad – nur, was es wirklich gibt */
    tools: [
      { id: 'projects' as const, color: '#ff6a13', title: 'Aufmaß & Abrechnung', text: 'Schadstellen und Flächen direkt im Plan erfassen, fertig als Excel und PDF.', image: 'aufmass-editor.jpg', points: ['Messen im Plan oder selbst zeichnen', 'Leistungsverzeichnis und Rechnungen', 'Excel-Aufmaßblatt und Plan-PDF'] },
      { id: 'workers' as const, color: '#2f80ed', title: 'Arbeitereinteilung', text: 'Wer arbeitet wann auf welcher Baustelle – die Woche auf einen Blick.', image: 'arbeiter-woche.jpg', points: ['Zuweisen per Klick oder Ziehen', 'Urlaub, Krankenstand, Doppelbelegung', 'Wochenplan als PDF mit Logo'] },
      { id: 'reports' as const, color: '#a259ff', title: 'Berichte & Formulare', text: 'Regielisten, Bautages- und Wochenberichte wie die gewohnten Formulare.', image: 'berichte-regie-editor.jpg', points: ['Mannschaft wird aus der Einteilung übernommen', 'Je Baustelle getrennte Listen', 'Formular-PDF mit Unterschriftsfeldern'] },
      { id: 'photos' as const, color: '#111111', title: 'Fotodokumentation', text: 'Jedes Foto bei der richtigen Baustelle, Kalenderwoche und am richtigen Tag.', image: 'fotos-baustelle.jpg', points: ['Kamera-Modus mit Baustelle oben', 'Galerie nach Woche und Tag, Zoom und Drehen', 'Foto-PDF und ZIP mit Datum'] },
      { id: 'defects' as const, color: '#d6242b', title: 'Mängelplan', text: 'Mängel, Ausbesserungen und Hinweise im Plan markieren – mit Fotos, als PDF fürs Angebot.', image: 'maengel-plan.jpg', points: ['Plan als PDF oder Foto, ohne Maßstab', 'Pins, Formen und Text in Farben, nummeriert', 'PDF mit Plan, Liste und Fotos'] },
    ],
    /** Beispiel-Exporte auf der Startseite */
    exportsLead: 'Kein Abtippen: Aufmaß, Wochenplan, Regieliste und Fotos kommen fertig als Excel oder PDF an – mit Logo und Firmendaten.',
    exports: [
      { src: 'export-aufmass.jpg', alt: 'Aufmaßblatt als Excel-Tabelle', caption: 'Aufmaßblatt · Excel' },
      { src: 'export-arbeiter-kw.jpg', alt: 'Wochenplan als PDF', caption: 'Wochenplan · PDF' },
      { src: 'export-berichte-regie.jpg', alt: 'Regieliste als Formular-PDF', caption: 'Regieliste · PDF' },
      { src: 'export-fotos.jpg', alt: 'Fotodokumentation als PDF', caption: 'Fotodokumentation · PDF' },
    ],
    /** Handy-Ansichten auf der Startseite */
    devicesLead: 'BauPad läuft im Browser und lässt sich am Handy wie eine App auf den Startbildschirm legen. Einmal geöffnet, funktioniert es auch ohne Empfang.',
    phones: [
      { src: 'tools-iphone.jpg', alt: 'Werkzeugübersicht am iPhone', caption: 'Werkzeuge' },
      { src: 'kamera-iphone.jpg', alt: 'Kamera-Modus am iPhone', caption: 'Kamera-Modus' },
      { src: 'fotos-baustelle-iphone.jpg', alt: 'Fotogalerie am iPhone', caption: 'Fotos je Baustelle' },
      { src: 'berichte-regie-iphone.jpg', alt: 'Regieliste am iPhone', caption: 'Regieliste' },
    ],
    /** Für wen BauPad gemacht ist */
    roles: [
      { title: 'Polier und Partie', text: 'Fotos, Regieliste und Stunden direkt vor Ort – in Minuten erledigt, auch ohne Empfang.' },
      { title: 'Bauleitung', text: 'Aufmaß im Plan, Mannschaft einteilen, Berichte prüfen und als PDF freigeben.' },
      { title: 'Büro', text: 'Excel, PDF und ZIP kommen fertig an – kein Abtippen von Zetteln.' },
    ],
    facts: ['Funktioniert offline', 'Installation ohne App Store', 'iPhone, iPad, Android und PC', 'Daten bleiben auf dem Gerät'],
    /** Fragen und Antworten – nur, was heute stimmt */
    faq: [
      { q: 'Funktioniert BauPad ohne Internet?', a: 'Ja. Nach dem ersten Öffnen läuft BauPad vollständig offline – auch in der Tiefgarage. Alle Daten werden auf dem Gerät gespeichert.' },
      { q: 'Auf welchen Geräten läuft es?', a: 'iPhone, iPad, Android-Handys und -Tablets sowie PC und Mac im Browser. Am Handy lässt sich BauPad wie eine App auf den Home-Bildschirm legen – ohne App Store.' },
      { q: 'Wo liegen meine Daten?', a: 'Derzeit ausschließlich auf deinem Gerät; Sicherungen erstellst du als Datei. Eine gemeinsame Ablage für alle Geräte eines Unternehmens mit Benutzerkonten ist in Vorbereitung.' },
      { q: 'Was kostet BauPad?', a: 'BauPad ist ein Abo für Firmen und Einzelunternehmer, gekauft und verwaltet auf der Website – per Karte, SEPA-Lastschrift oder Rechnung, keine Käufe in der App. Preise und Pakete werden zum Start veröffentlicht; bis dahin läuft die Testphase.' },
      { q: 'Passen die Formulare zu meinen?', a: 'Regieliste und Bautagesbericht sind an gängige Baustellenformulare angelehnt. Firmenname, Anschrift und Logo kommen aus deinen Einstellungen.' },
    ],
    /** Was als Nächstes kommt – ehrlich, ohne Termin */
    roadmap: [
      { title: 'Benutzerkonten und Unternehmen', text: 'Anmeldung mit Rollen für Admin, Polier, Arbeiter und Büro.' },
      { title: 'Gemeinsame Ablage', text: 'Fotos und Berichte zentral für alle Geräte, gespeichert in der EU.' },
      { title: 'App Store und Google Play', text: 'BauPad zusätzlich als App zum Installieren.' },
    ],
    companyTitle: 'Aus der Praxis, für die Praxis',
    companyText:
      'PAD Software entwickelt Werkzeuge für Baufirmen – entstanden auf den Baustellen der Betoninstandsetzung in Wien. ' +
      'BauPad ist unser erstes Produkt. Weitere folgen.',
    companyCta: 'Kontakt aufnehmen',
  },
  /** Detailseiten je Werkzeug: Texte, Bilder (public/site) und Beispiel-Exporte */
  products: {
    projects: {
      slug: 'aufmass',
      tagline: 'Schadstellen und Flächen direkt im Plan erfassen – fertig abgerechnet als Excel und PDF.',
      intro:
        'Plan als PDF oder Foto öffnen oder selbst zeichnen, Maßstab erkennen oder kalibrieren, dann Flächen, Linien, Wände und Freihandformen ' +
        'mit Länge, Breite und Tiefe erfassen. Jede Messung bekommt eine Nummer im Plan und eine Zeile im Aufmaß.',
      groups: [
        { title: 'Messen', items: ['Fläche, Linie, Dreieck, Polygon, Kreis, Freihand und Wand', 'Abzüge und Zuschläge, z. B. Türen und Öffnungen', 'Fünf Messarten mit Bauteilbuchstaben A, B, C', 'Punktfang, Zoom auf Auswahl, Rückgängig und Wiederholen'] },
        { title: 'Pläne', items: ['PDF-Pläne importieren, Maßstab automatisch erkennen', 'Eigene Pläne zeichnen: Raster, Bemaßung, Schraffur, Ebenen', 'Mini-CAD: kopieren, drehen, strecken, trimmen', 'Papierformat A4/A3 für den Druck'] },
        { title: 'Abrechnen', items: ['Leistungsverzeichnis (LV) einlesen, Positionen mit Langtext', 'Aufmaß je Plan oder je Rechnung', 'Rechnungen aufteilen, abgerechnete Pläne gesperrt', 'Excel-Aufmaßblatt und PDF-Plan mit Logo'] },
        { title: 'Sicher', items: ['Alles am Gerät, auch ohne Internet', 'Projektsicherung als ZIP mit allen Plänen', 'Übernahme auf ein anderes Gerät'] },
      ],
      shots: [
        { src: 'aufmass-editor.jpg', alt: 'Plan mit drei markierten Flächen und Aufmaßtabelle', caption: 'Messungen im Plan – rechts die Aufmaßtabelle mit Summen' },
        { src: 'aufmass-projekt.jpg', alt: 'Projektseite mit Projektangaben, Kostenstelle und Planliste', caption: 'Projekt mit Kostenstellen und Plänen' },
      ],
      exports: [
        { src: 'export-aufmass.jpg', alt: 'Aufmaßblatt als Excel-Tabelle', caption: 'Aufmaßblatt (Excel)' },
        { src: 'export-aufmass-plan.jpg', alt: 'Plan mit nummerierten Markierungen als PDF', caption: 'Plan mit Markierungen (PDF)' },
      ],
    },
    workers: {
      slug: 'arbeitereinteilung',
      tagline: 'Wer arbeitet wann auf welcher Baustelle – die Woche auf einen Blick, als PDF für alle.',
      intro:
        'Arbeiter einmal anlegen, Baustellen aus den Projekten übernehmen, dann per Klick oder Ziehen auf die Tage verteilen. ' +
        'Urlaub und Krankenstand werden angezeigt, die Woche lässt sich weiterführen und als PDF mit Firmenlogo ausgeben.',
      groups: [
        { title: 'Planen', items: ['Woche Mo–So je Baustelle', 'Zuweisen per Klick oder Ziehen, Arbeiter bleibt bis zur Änderung', 'Woche in die nächste weiterführen', 'Baustelle abschließen oder pausieren'] },
        { title: 'Abwesenheiten', items: ['Urlaub und Krankenstand von–bis', 'Warnung bei Doppelbelegung', 'Suche nach Arbeiter oder Baustelle'] },
        { title: 'Ausgeben', items: ['Wochenplan A4 quer mit Logo und KW', 'Tagesliste je Baustelle', 'Drucken oder als PDF teilen', 'Sicherung aller Wochen'] },
      ],
      shots: [
        { src: 'arbeiter-woche.jpg', alt: 'Wochenplan mit zwei Baustellen und zugewiesenen Arbeitern', caption: 'Wochenplan je Baustelle' },
        { src: 'arbeiter-woche-iphone.jpg', alt: 'Wochenplan am iPhone', caption: 'Am Handy', phone: true },
      ],
      exports: [{ src: 'export-arbeiter-kw.jpg', alt: 'Wochenplan als PDF im Querformat', caption: 'Wochenplan KW 44 (PDF)' }],
    },
    reports: {
      slug: 'berichte',
      tagline: 'Regielisten, Bautages- und Wochenberichte – ausgefüllt in Minuten, als Formular-PDF.',
      intro:
        'Baustelle, Adresse, Auftraggeber und die eingeteilte Mannschaft werden automatisch übernommen. Stunden, Material, Geräte und ' +
        'Tätigkeiten eintragen, fertig. Das PDF sieht aus wie das gewohnte Formular, mit Logo und Unterschriftsfeldern.',
      groups: [
        { title: 'Regieliste', items: ['Personal mit Arbeitszeiten, Gesamtstunden, davon 50 % / 100 %', 'Material und Geräte mit Menge und Einheit', 'Tätigkeiten und Anmerkungen', 'A4 quer, Unterschrift Auftraggeber / Kontrolle'] },
        { title: 'Bautagesbericht', items: ['Mannschaft laut Einteilung, Anwesenheit bestätigen', 'Wetter, Temperatur, Arbeitszeit', 'Leistungsfortschritt, besondere Vorkommnisse', 'Unterschriftsfelder AN und ÖBA'] },
        { title: 'Wochenbericht', items: ['Übernahme aus den Tagesberichten', 'Mannschaft je Tag aus der Einteilung', 'Ereignisse, Bemerkungen, offene Punkte'] },
        { title: 'Verwalten', items: ['Je Baustelle getrennte Listen', 'Berichte kopieren, Nummern fortlaufend', 'Mehrere Berichte als ein PDF', 'Sicherung und Projektsicherung'] },
      ],
      shots: [
        { src: 'berichte-regie-editor.jpg', alt: 'Regieliste in Bearbeitung mit Personal und Tätigkeiten', caption: 'Regieliste ausfüllen – Mannschaft aus der Einteilung' },
        { src: 'berichte-baustelle.jpg', alt: 'Berichte einer Baustelle in drei Listen', caption: 'Berichte je Baustelle' },
        { src: 'berichte-regie-iphone.jpg', alt: 'Regieliste am iPhone', caption: 'Am Handy', phone: true },
      ],
      exports: [
        { src: 'export-berichte-regie.jpg', alt: 'Regieliste als Formular-PDF', caption: 'Regieliste (PDF)' },
        { src: 'export-berichte-tag.jpg', alt: 'Bautagesbericht als Formular-PDF', caption: 'Bautagesbericht (PDF)' },
      ],
    },
    photos: {
      slug: 'fotos',
      tagline: 'Jedes Foto landet bei der richtigen Baustelle, Kalenderwoche und am richtigen Tag.',
      intro:
        'Kamera-Modus mit großem Auslöser und Baustelle oben, oder Fotos aus der Galerie übernehmen. Aufnahmezeit und Name werden ' +
        'gespeichert, am PC gibt es die Galerie mit Suche, Großansicht, Zoom und Drehen. Ausgabe als Foto-PDF oder ZIP.',
      groups: [
        { title: 'Aufnehmen', items: ['Kamera-Modus: Baustelle wählen, auslösen, fertig', 'Format 4:3, 3:2, 16:9, 1:1 – quer gehalten, quer gespeichert', 'Beschreibung für die nächsten Fotos', 'Galerie-Import mit Aufnahmezeit aus dem Foto'] },
        { title: 'Ordnen', items: ['Baustelle → Kalenderwoche → Tag', 'Ansicht nach Tag, Woche, Monat oder alles', 'Suche nach KW, Datum, Name oder Beschreibung', 'Verschieben zu einer anderen Baustelle'] },
        { title: 'Ansehen', items: ['Großansicht mit Blättern und Zoom', 'Drehen wird sofort gespeichert', 'Beschreibung direkt im Bild bearbeiten'] },
        { title: 'Ausgeben', items: ['Foto-PDF: 1 bis 6 Fotos je Seite, Logo, Angaben wählbar', 'ZIP mit Dateien nach Datum', 'Zentrale Ablage für alle Geräte in Vorbereitung'] },
      ],
      shots: [
        { src: 'fotos-baustelle.jpg', alt: 'Fotogalerie einer Baustelle nach Kalenderwoche und Tag', caption: 'Galerie je Baustelle – nach Woche und Tag' },
        { src: 'fotos-gross.jpg', alt: 'Großansicht eines Fotos mit Angaben', caption: 'Großansicht mit Zoom, Drehen und Beschreibung' },
        { src: 'kamera-iphone.jpg', alt: 'Kamera-Modus am iPhone', caption: 'Kamera-Modus', phone: true },
        { src: 'fotos-baustelle-iphone.jpg', alt: 'Galerie am iPhone', caption: 'Galerie am Handy', phone: true },
      ],
      exports: [{ src: 'export-fotos.jpg', alt: 'Fotodokumentation als PDF mit vier Fotos je Seite', caption: 'Foto-PDF, 4 je Seite' }],
    },
    defects: {
      slug: 'maengelplan',
      tagline: 'Mängel, Ausbesserungen und Hinweise direkt im Plan markieren – die Grundlage für Angebot und Mängelliste.',
      intro:
        'Plan als PDF oder Foto hochladen, ohne Maßstab und ohne Kalibrieren. Dann Pins, Rechtecke, Kreise, Linien, Freihand und Text ' +
        'in Farben setzen. Jede Markierung bekommt eine Nummer, eine Art, Titel, Beschreibung und Fotos. Die Fotos liegen gleichzeitig in der Fotodokumentation.',
      groups: [
        { title: 'Markieren', items: ['Pin, Rechteck, Kreis, Linie, Freihand, Text', 'Fünf Farben, Art: Mangel, Ausbesserung, Hinweis, Erledigt', 'Nummern laufen je Plan automatisch', 'Verschieben, Zoom, Liste mit Filter'] },
        { title: 'Beschreiben', items: ['Titel und Beschreibung je Markierung', 'Fotos aufnehmen, aus der Galerie oder aus der Fotodokumentation', 'Vermerk „Mängelplan Nr. 3“ im Foto'] },
        { title: 'Ausgeben', items: ['PDF: Plan mit Nummern, danach die Liste mit Fotos', 'Logo und Firmendaten im Kopf', 'Je Baustelle beliebig viele Pläne'] },
      ],
      shots: [
        { src: 'maengel-plan.jpg', alt: 'Plan mit Pin, Rechteck und Kreis sowie Liste der Markierungen', caption: 'Plan mit Markierungen – rechts die Liste' },
        { src: 'maengel-plan-iphone.jpg', alt: 'Mängelplan am iPhone', caption: 'Am Handy', phone: true },
      ],
      exports: [{ src: 'export-maengel.jpg', alt: 'Mängelplan als PDF', caption: 'Mängelplan (PDF)' }],
    },
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
