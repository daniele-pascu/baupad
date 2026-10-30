import { useEffect } from 'react';

/** Seitentitel der App setzen; beim Verlassen wieder „BauPad“ */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title;
    return () => {
      document.title = 'BauPad';
    };
  }, [title]);
}
