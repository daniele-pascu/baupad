/**
 * Texte der öffentlichen BauPad-Seiten.
 *
 * Hier können Texte und Kontaktdaten ohne Programmierkenntnisse geändert werden:
 * nur den Text zwischen den Anführungszeichen anpassen. Leere Kontaktangaben ('')
 * werden auf der Seite als „wird ergänzt“ angezeigt.
 */
export const site = {
  home: {
    title: 'Dein Aufmaß. Direkt im Plan.',
    lead:
      'Mit BauPad erfasst du Schadstellen und Oberflächen direkt im Bauplan. Erstelle Messungen, verwalte deine ' +
      'Projekte und bereite deine Aufmaßdaten übersichtlich für die weitere Bearbeitung auf.',
    cta: 'Zu den Tools',
    /** Kleine Zeile über der Überschrift */
    eyebrow: 'Digitales Aufmaß für die Baustelle',
    secondary: 'Mehr erfahren',
    /** Kurze Übersicht – beschreibt nur Funktionen, die BauPad bereits hat */
    highlights: [
      { icon: 'map', title: 'Im Plan markieren', text: 'PDF oder Foto des Plans öffnen und Schadstellen direkt einzeichnen.' },
      { icon: 'drawPlan', title: 'Pläne zeichnen', text: 'Räume und Flächen maßstäblich skizzieren – mit Fang, Bemaßung und Schraffur.' },
      { icon: 'calibrate', title: 'Automatisch berechnet', text: 'Länge und Breite eingeben oder Fläche direkt aus dem Plan übernehmen.' },
      { icon: 'pdf', title: 'Excel und PDF', text: 'Aufmaß als Excel-Tabelle und Pläne mit Markierungen als PDF exportieren.' },
    ],
    /** Hinweise unter den Funktionen */
    facts: ['Funktioniert offline', 'Daten bleiben auf dem Gerät', 'iPhone, iPad und PC'],
  },
  about: {
    title: 'Über BauPad',
    paragraphs: [
      'BauPad ist eine Anwendung für das digitale Aufmaß auf der Baustelle. Pläne werden als PDF oder Bild ' +
        'geöffnet, Schadstellen und Flächen direkt im Plan markiert und mit ihren Maßen erfasst.',
      'Die Daten werden auf dem Gerät gespeichert, damit auch in Tiefgaragen und Kellern ohne Internetverbindung ' +
        'gearbeitet werden kann. Die Ergebnisse lassen sich als Excel-Tabelle und als PDF-Plan weitergeben.',
      'BauPad wird laufend weiterentwickelt.',
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
  },
  footer: 'BauPad',
};
