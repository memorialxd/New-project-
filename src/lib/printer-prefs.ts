// Local printer preferences (per device). Printing uses the browser print dialog,
// so the user picks the actual printer there. We just remember whether to auto-print.

const KEY = 'store-printer-prefs';

export interface PrinterPrefs {
  enabled: boolean;
  autoPrintOnAccept: boolean;
  printerName: string; // Informational only — used as a label in the UI
}

const DEFAULTS: PrinterPrefs = {
  enabled: false,
  autoPrintOnAccept: false,
  printerName: '',
};

export function getPrinterPrefs(): PrinterPrefs {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function setPrinterPrefs(prefs: Partial<PrinterPrefs>) {
  if (typeof window === 'undefined') return;
  const current = getPrinterPrefs();
  const next = { ...current, ...prefs };
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('printer-prefs-changed', { detail: next }));
}
