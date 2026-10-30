import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { DEFAULT_THEME, isThemeId, type ThemeId } from '@clinic/shared';
import { useClinicInfo } from '../components/layouts';

/** Applies a theme by setting data-theme on <html>, where tokens.css computes the derived colours. */
export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
}

/**
 * Keeps <html data-theme> in step with the clinic's theme setting. Adding
 * `?theme=<id>` to any URL previews another theme until the page reloads
 * (held in memory only: web storage is off limits, SPEC §10).
 */
export function useClinicTheme(): ThemeId {
  const clinic = useClinicInfo();
  const [params] = useSearchParams();
  const [preview, setPreview] = useState<ThemeId | null>(null);

  const requested = params.get('theme');
  useEffect(() => {
    if (isThemeId(requested)) setPreview(requested);
  }, [requested]);

  const clinicTheme = clinic.data?.theme;
  const theme = preview ?? (isThemeId(clinicTheme) ? clinicTheme : DEFAULT_THEME);
  useEffect(() => applyTheme(theme), [theme]);
  return theme;
}
