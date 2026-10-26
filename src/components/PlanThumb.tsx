import { useEffect, useState } from 'react';
import { planThumb } from '../lib/thumbs';
import type { Plan, SourceFile } from '../lib/types';

export function PlanThumb({ plan, file }: { plan: Plan; file: SourceFile | undefined }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!file) return;
    let u: string | null = null;
    let alive = true;
    planThumb(plan, file)
      .then((blob) => {
        if (!alive) return;
        u = URL.createObjectURL(blob);
        setUrl(u);
      })
      .catch((e) => {
        console.warn(e);
        if (alive) setError(true);
      });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [plan.id, plan.crop, plan.rotation, file]);
  return (
    <div className="thumb">
      {url ? <img src={url} alt="" /> : <span className="muted small">{error ? 'Vorschau nicht verfügbar' : 'Vorschau …'}</span>}
    </div>
  );
}
