import { useState } from "react";

export type Theme = "system" | "light" | "dark";

const KEY = "cat-simulator.theme";
const CHOICES: { value: Theme; label: string }[] = [
  { value: "system", label: "Sistem" },
  { value: "light", label: "Terang" },
  { value: "dark", label: "Gelap" },
];

function savedTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

/** "system" removes the override, so the stylesheet follows the device setting. */
export function applyTheme(theme: Theme): void {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
}

/** Light / dark / follow the device. Remembered on this device only. */
export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(savedTheme);

  const choose = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Storage blocked: the choice still holds until the page is closed.
    }
  };

  return (
    <footer className="theme-footer">
      <div className="segmented" role="radiogroup" aria-label="Tampilan">
        <span className="segmented-label" aria-hidden="true">
          Tampilan
        </span>
        {CHOICES.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={theme === c.value}
            className={theme === c.value ? "active" : undefined}
            onClick={() => choose(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </footer>
  );
}
