import { useState } from 'react';
import type { LengthUnit } from '@mineplan/shared';

/** Preferred length unit for measurements, remembered per device. */
export function useLengthUnit(): [LengthUnit, (u: LengthUnit) => void] {
  const [u, setU] = useState<LengthUnit>(() => {
    try { return (localStorage.getItem('mineplan-unit') as LengthUnit) || 'm'; } catch { return 'm'; }
  });
  return [u, (v) => { setU(v); try { localStorage.setItem('mineplan-unit', v); } catch { /* ignore */ } }];
}

export function downloadText(text: string, name: string, mime = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
