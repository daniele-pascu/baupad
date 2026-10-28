import { useId } from 'react';

/**
 * Symbole der Tools-Kacheln: Phosphor Icons (https://phosphoricons.com), MIT-Lizenz,
 * Copyright (c) 2023 Phosphor Icons. Kräftig (bold) im Symbolfeld, fein (thin) groß im Hintergrund.
 * „Aufmaß & Abrechnung“ (Zettel mit Taschenrechner) ist eigens im selben Stil gezeichnet.
 */
export type ToolIconName = 'projects' | 'workers' | 'photos' | 'reports';

const PATHS: Record<Exclude<ToolIconName, 'projects'>, { bold: string; thin: string }> = {
  workers: {
    bold: 'M164.38,181.1a52,52,0,1,0-72.76,0,75.89,75.89,0,0,0-30,28.89,12,12,0,0,0,20.78,12,53,53,0,0,1,91.22,0,12,12,0,1,0,20.78-12A75.89,75.89,0,0,0,164.38,181.1ZM100,144a28,28,0,1,1,28,28A28,28,0,0,1,100,144Zm147.21,9.59a12,12,0,0,1-16.81-2.39c-8.33-11.09-19.85-19.59-29.33-21.64a12,12,0,0,1-1.82-22.91,20,20,0,1,0-24.78-28.3,12,12,0,1,1-21-11.6,44,44,0,1,1,73.28,48.35,92.18,92.18,0,0,1,22.85,21.69A12,12,0,0,1,247.21,153.59Zm-192.28-24c-9.48,2.05-21,10.55-29.33,21.65A12,12,0,0,1,6.41,136.79,92.37,92.37,0,0,1,29.26,115.1a44,44,0,1,1,73.28-48.35,12,12,0,1,1-21,11.6,20,20,0,1,0-24.78,28.3,12,12,0,0,1-1.82,22.91Z',
    thin: 'M237,147.44a4,4,0,0,1-5.48-1.4c-8.33-14-20.93-22-34.56-22a4,4,0,0,1-1.2-.2,36.76,36.76,0,0,1-3.8.2,4,4,0,0,1,0-8,28,28,0,1,0-27.12-35,4,4,0,0,1-7.75-2,36,36,0,1,1,54,39.48c10.81,3.85,20.51,12,27.31,23.48A4,4,0,0,1,237,147.44ZM187.46,214a4,4,0,0,1-1.46,5.46,3.93,3.93,0,0,1-2,.54,4,4,0,0,1-3.46-2,61,61,0,0,0-105.08,0,4,4,0,0,1-6.92-4,68.35,68.35,0,0,1,39.19-31,44,44,0,1,1,40.54,0A68.35,68.35,0,0,1,187.46,214ZM128,180a36,36,0,1,0-36-36A36,36,0,0,0,128,180ZM64,116A28,28,0,1,1,91.12,81a4,4,0,0,0,7.75-2A36,36,0,1,0,45.3,118.75,63.55,63.55,0,0,0,12.8,141.6a4,4,0,0,0,6.4,4.8A55.55,55.55,0,0,1,64,124a4,4,0,0,0,0-8Z',
  },
  photos: {
    bold: 'M208,52H182.42L170,33.34A12,12,0,0,0,160,28H96a12,12,0,0,0-10,5.34L73.57,52H48A28,28,0,0,0,20,80V192a28,28,0,0,0,28,28H208a28,28,0,0,0,28-28V80A28,28,0,0,0,208,52Zm4,140a4,4,0,0,1-4,4H48a4,4,0,0,1-4-4V80a4,4,0,0,1,4-4H80a12,12,0,0,0,10-5.34L102.42,52h51.15L166,70.66A12,12,0,0,0,176,76h32a4,4,0,0,1,4,4ZM128,84a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,84Zm0,72a24,24,0,1,1,24-24A24,24,0,0,1,128,156Z',
    thin: 'M208,60H178.13L163.32,37.78A4,4,0,0,0,160,36H96a4,4,0,0,0-3.32,1.78L77.85,60H48A20,20,0,0,0,28,80V192a20,20,0,0,0,20,20H208a20,20,0,0,0,20-20V80A20,20,0,0,0,208,60Zm12,132a12,12,0,0,1-12,12H48a12,12,0,0,1-12-12V80A12,12,0,0,1,48,68H80a4,4,0,0,0,3.33-1.78L98.13,44h59.72l14.82,22.22A4,4,0,0,0,176,68h32a12,12,0,0,1,12,12ZM128,92a40,40,0,1,0,40,40A40,40,0,0,0,128,92Zm0,72a32,32,0,1,1,32-32A32,32,0,0,1,128,164Z',
  },
  reports: {
    bold: 'M220.49,59.51l-40-40A12,12,0,0,0,172,16H92A20,20,0,0,0,72,36V56H56A20,20,0,0,0,36,76V216a20,20,0,0,0,20,20H164a20,20,0,0,0,20-20V196h20a20,20,0,0,0,20-20V68A12,12,0,0,0,220.49,59.51ZM160,212H60V80h67l33,33Zm40-40H184V108a12,12,0,0,0-3.51-8.49l-40-40A12,12,0,0,0,132,56H96V40h71l33,33Zm-56-28a12,12,0,0,1-12,12H88a12,12,0,0,1,0-24h44A12,12,0,0,1,144,144Zm0,40a12,12,0,0,1-12,12H88a12,12,0,0,1,0-24h44A12,12,0,0,1,144,184Z',
    thin: 'M210.83,69.17l-40-40A4,4,0,0,0,168,28H88A12,12,0,0,0,76,40V60H56A12,12,0,0,0,44,72V216a12,12,0,0,0,12,12H168a12,12,0,0,0,12-12V196h20a12,12,0,0,0,12-12V72A4,4,0,0,0,210.83,69.17ZM172,216a4,4,0,0,1-4,4H56a4,4,0,0,1-4-4V72a4,4,0,0,1,4-4h78.34L172,105.66Zm32-32a4,4,0,0,1-4,4H180V104a4,4,0,0,0-1.17-2.83l-40-40A4,4,0,0,0,136,60H84V40a4,4,0,0,1,4-4h78.34L204,73.66Zm-64-32a4,4,0,0,1-4,4H88a4,4,0,0,1,0-8h48A4,4,0,0,1,140,152Zm0,32a4,4,0,0,1-4,4H88a4,4,0,0,1,0-8h48A4,4,0,0,1,140,184Z',
  },
};

/** Aufmaß & Abrechnung: Aufmaßzettel, davor ein Taschenrechner (der Zettel ist hinter dem Rechner ausgespart) */
function ProjectsIcon({ weight, size, className }: { weight: 'bold' | 'thin'; size: number; className?: string }) {
  const mask = useId();
  const sw = weight === 'bold' ? 16 : 7;
  const calc = <rect x="130" y="104" width="104" height="136" rx="18" />;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <defs>
        <mask id={mask}>
          <rect width="256" height="256" fill="#fff" stroke="none" />
          <g fill="#000" stroke="#000" strokeWidth={sw + 24}>
            {calc}
          </g>
        </mask>
      </defs>
      <g mask={`url(#${mask})`}>
        <path d="M32 16H136L170 50V200a12 12 0 0 1-12 12H32a12 12 0 0 1-12-12V28a12 12 0 0 1 12-12Z" />
        <path d="M136 16V50H170M46 92H142M46 122H110M46 152H90" />
      </g>
      {calc}
      <g fill="currentColor" stroke="none">
        <rect x="148" y="122" width="68" height="30" rx="5" />
        {[158, 182, 206].flatMap((cx) => [180, 207].map((cy) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="8" />))}
      </g>
    </svg>
  );
}

export function ToolIcon({ name, weight = 'bold', size = 24, className }: { name: ToolIconName; weight?: 'bold' | 'thin'; size?: number; className?: string }) {
  if (name === 'projects') return <ProjectsIcon weight={weight} size={size} className={className} />;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d={PATHS[name][weight]} />
    </svg>
  );
}
