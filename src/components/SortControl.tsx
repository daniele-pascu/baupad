import { Icon } from './Icon';
import type { ListSort } from '../lib/list-sort';

/**
 * Sortierung – in allen Werkzeugen gleich: links die Art („Sortieren nach …“), rechts daneben ein eigener Pfeil
 * ↑ aufsteigend / ↓ absteigend. Bei einer neuen Art beginnen Datumsangaben (`newestFirst`) mit dem neuesten.
 */
export function SortControl<K extends string>({
  value,
  labels,
  onChange,
  newestFirst = [],
  testId,
  label = 'Sortieren nach',
}: {
  value: ListSort<K>;
  labels: Record<K, string>;
  onChange(s: ListSort<K>): void;
  newestFirst?: K[];
  testId: string;
  label?: string;
}) {
  const asc = value.dir === 'asc';
  return (
    <span className="sort-control" data-testid={`${testId}-control`}>
      <label>
        <span className="sort-label muted small">{label}</span>
        <select
          value={value.key}
          onChange={(e) => {
            const key = e.target.value as K;
            onChange({ key, dir: newestFirst.includes(key) ? 'desc' : 'asc' });
          }}
          aria-label={label}
          data-testid={testId}
        >
          {(Object.keys(labels) as K[]).map((k) => (
            <option key={k} value={k}>
              {labels[k]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="icon-btn sort-dir"
        onClick={() => onChange({ ...value, dir: asc ? 'desc' : 'asc' })}
        aria-label={asc ? 'Aufsteigend – tippen für absteigend' : 'Absteigend – tippen für aufsteigend'}
        title={asc ? 'Aufsteigend' : 'Absteigend'}
        data-testid={`${testId}-dir`}
        data-dir={value.dir}
      >
        <Icon name={asc ? 'up' : 'down'} size={20} />
      </button>
    </span>
  );
}
