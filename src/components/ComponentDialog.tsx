import { useState } from 'react';
import { COLORS } from '../lib/types';
import { Modal } from './Modal';

/** Nächster freier Buchstabe: A … Z, danach AA, AB … */
export function nextLetter(existing: string[]): string {
  const used = new Set(existing.map((l) => l.toUpperCase()));
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const a of letters) if (!used.has(a)) return a;
  for (const a of letters) for (const b of letters) if (!used.has(a + b)) return a + b;
  return '';
}

export interface ComponentValues {
  letter: string;
  name: string;
  color: string;
}

interface Props {
  mode: 'new' | 'edit';
  initial: ComponentValues;
  /** Buchstaben der anderen Bauteile dieses Plans (für die Eindeutigkeitsprüfung) */
  usedLetters: string[];
  /** Anzahl zugeordneter Messungen (nur Anzeige) */
  measurements?: number;
  onSave: (v: ComponentValues) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

/** Bauteilkennzeichnung (z. B. „A – Wand“) anlegen oder bearbeiten. */
export function ComponentDialog({ mode, initial, usedLetters, measurements, onSave, onCancel, onDelete }: Props) {
  const [v, setV] = useState<ComponentValues>(initial);
  const [show, setShow] = useState(false);
  const letter = v.letter.trim().toUpperCase();
  const error = !letter
    ? 'Bitte einen Buchstaben eingeben.'
    : !/^[A-ZÄÖÜ0-9]{1,3}$/.test(letter)
      ? 'Bitte 1 bis 3 Buchstaben oder Ziffern eingeben (z. B. A, B, C1).'
      : usedLetters.some((l) => l.toUpperCase() === letter)
        ? `„${letter}“ ist in diesem Plan bereits vergeben.`
        : null;
  const submit = () => {
    setShow(true);
    if (!error) onSave({ letter, name: v.name.trim(), color: v.color });
  };
  return (
    <Modal
      title={mode === 'new' ? 'Bauteil kennzeichnen' : `Bauteil ${initial.letter} bearbeiten`}
      onClose={onCancel}
      persistent
      testId="component-dialog"
      footer={
        <>
          {onDelete && (
            <button type="button" className="btn btn-danger-text mr-auto" onClick={onDelete} data-testid="component-delete">
              Löschen
            </button>
          )}
          <button type="button" className="btn" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} data-testid="component-save">
            Speichern
          </button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="field">
          <span>Buchstabe *</span>
          <input
            value={v.letter}
            onChange={(e) => setV({ ...v, letter: e.target.value.toUpperCase() })}
            maxLength={3}
            autoCapitalize="characters"
            autoComplete="off"
            enterKeyHint="next"
            aria-invalid={show && !!error}
            data-testid="component-letter"
          />
          {show && error && <small className="error">{error}</small>}
        </label>
        <label className="field">
          <span>Bezeichnung</span>
          <input
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
            placeholder="z. B. Wand, Decke, Stütze"
            autoComplete="off"
            enterKeyHint="done"
            data-autofocus
            data-testid="component-name"
          />
        </label>
        <fieldset className="option-row span-2">
          <legend>Farbe</legend>
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`swatch${v.color === c.value ? ' active' : ''}`}
              style={{ background: c.value }}
              onClick={() => setV({ ...v, color: c.value })}
              aria-label={c.name}
              aria-pressed={v.color === c.value}
              title={c.name}
            />
          ))}
        </fieldset>
        {mode === 'edit' && measurements !== undefined && (
          <p className="muted small span-2">{measurements} Messung(en) sind diesem Bauteil zugeordnet.</p>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
