import { useState } from 'react';
import { formatArea } from '../lib/numbers';
import { Modal } from './Modal';
import { customDialog } from './ui';

/** Häufige Raumnamen (Vorschläge, frei änderbar) */
export const ROOM_NAMES = ['Wohnen', 'Essen', 'Küche', 'Wohnküche', 'Schlafen', 'Zimmer', 'Kind', 'Bad', 'WC', 'Vorraum', 'Gang', 'Abstellraum', 'Garderobe', 'Büro', 'Technik', 'Heizraum', 'Keller', 'Waschraum', 'Stiegenhaus', 'Garage', 'Lager', 'Balkon', 'Terrasse', 'Loggia'];

export interface RoomInput {
  name: string;
  note: string;
}

function RoomView({ area, init, close }: { area: number | null; init: RoomInput; close(v: RoomInput | null): void }) {
  const [name, setName] = useState(init.name);
  const [note, setNote] = useState(init.note);
  const ok = () => name.trim() && close({ name: name.trim(), note: note.trim() });
  return (
    <Modal
      title="Raumstempel"
      onClose={() => close(null)}
      testId="room-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={() => close(null)}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={ok} disabled={!name.trim()} data-testid="room-ok">
            Übernehmen
          </button>
        </>
      }
    >
      <p className="room-area-info" data-testid="room-dialog-area">
        Fläche: <strong>{area === null ? '–' : `${formatArea(area)} m²`}</strong> <span className="muted small">(automatisch aus den Wänden bzw. Linien)</span>
      </p>
      <label className="field">
        <span>Raumname</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ok()}
          list="room-names"
          placeholder="z. B. Wohnen, Küche, Bad"
          data-autofocus
          data-testid="room-name-input"
        />
        <datalist id="room-names">
          {ROOM_NAMES.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </label>
      <label className="field">
        <span>Zusatz (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} placeholder="z. B. Fliesen, RH 2,60" data-testid="room-note-input" />
      </label>
    </Modal>
  );
}

export const roomDialog = (area: number | null, init: RoomInput = { name: '', note: '' }) => customDialog<RoomInput>((close) => <RoomView area={area} init={init} close={close} />);
