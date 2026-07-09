import { Palette, Server, Type } from 'lucide-react';

import { ACCENTS, THEMES, type ThemePrefs } from '../lib/theme';
import { useMobileStore } from '../state/store';

const FONT_SCALES: { value: number; label: string }[] = [
  { value: 0.9, label: 'S' },
  { value: 1, label: 'M' },
  { value: 1.12, label: 'L' },
  { value: 1.25, label: 'XL' },
];

export function SettingsScreen({
  prefs,
  onChange,
}: {
  prefs: ThemePrefs;
  onChange: (next: ThemePrefs) => void;
}) {
  const servers = useMobileStore((s) => s.servers);
  const statuses = useMobileStore((s) => s.statuses);
  const connectedCount = Object.values(statuses).filter((s) => s.connected).length;

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <h1>Settings</h1>
          <p>Appearance & account</p>
        </div>
      </header>

      <section className="card">
        <div className="card-title">
          <Palette size={18} aria-hidden />
          <span>Theme</span>
        </div>
        <div className="option-grid">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              className={`option-chip ${prefs.theme === theme.id ? 'selected' : ''}`}
              onClick={() => onChange({ ...prefs, theme: theme.id })}
            >
              {theme.label}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          <span className="accent-dot" style={{ background: `oklch(${ACCENTS.find((a) => a.id === prefs.accent)?.oklch})` }} />
          <span>Accent color</span>
        </div>
        <div className="accent-grid">
          {ACCENTS.map((accent) => (
            <button
              key={accent.id}
              type="button"
              aria-label={accent.label}
              className={`accent-swatch ${prefs.accent === accent.id ? 'selected' : ''}`}
              style={{ background: `oklch(${accent.oklch})` }}
              onClick={() => onChange({ ...prefs, accent: accent.id })}
            />
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          <Type size={18} aria-hidden />
          <span>Text size</span>
        </div>
        <div className="option-grid">
          {FONT_SCALES.map((scale) => (
            <button
              key={scale.value}
              type="button"
              className={`option-chip ${Math.abs(prefs.fontScale - scale.value) < 0.01 ? 'selected' : ''}`}
              onClick={() => onChange({ ...prefs, fontScale: scale.value })}
            >
              {scale.label}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          <Server size={18} aria-hidden />
          <span>Account</span>
        </div>
        <div className="info-rows">
          <div className="info-row">
            <span>Connected servers</span>
            <strong>{connectedCount}</strong>
          </div>
          <div className="info-row">
            <span>Saved servers</span>
            <strong>{servers.length}</strong>
          </div>
        </div>
        <p className="footnote">
          Manage sign-in and reconnect on the Servers tab. Session tokens stay in native
          storage and never enter the web view.
        </p>
      </section>

      <p className="app-version">Collab companion · Phase 2</p>
    </div>
  );
}
