/**
 * Reliable clipboard copy with timeout guard and hidden-textarea fallback so
 * copy buttons work consistently across standard and restricted/headless browsers.
 */
export async function copyText(text: string): Promise<boolean> {
  const value = String(text ?? '');
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      const ok = await Promise.race<boolean>([
        navigator.clipboard.writeText(value).then(() => true, () => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
      ]);
      if (ok) return true;
    } catch {
      // fall through to execCommand fallback
    }
  }
  if (typeof document === 'undefined' || !document.body) return false;
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-9999px';
  ta.style.left = '-9999px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  try {
    ta.focus();
    ta.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    if (ta.parentNode) document.body.removeChild(ta);
  }
}
