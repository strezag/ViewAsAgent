import {
  FONT_STEPS,
  clampFontStep,
  fontSizeFor,
  isFirstStep,
  isLastStep,
  type Settings,
  type ThemePreference,
} from '@/lib/settings';

/**
 * Always visible rather than tucked behind a gear.
 *
 * Hiding accessibility controls behind a menu is a familiar anti-pattern: the
 * people who most need larger text are the least likely to go hunting for a
 * settings icon. The row costs about 24px and removes the discovery problem.
 */
export function SettingsBar({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
}) {
  const step = clampFontStep(settings.fontStep);

  const setStep = (next: number) => onChange({ ...settings, fontStep: clampFontStep(next) });
  const setTheme = (theme: ThemePreference) => onChange({ ...settings, theme });

  return (
    // Wraps rather than overflows: at the largest text size the two groups no
    // longer fit on one line in a narrow panel.
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-slate-800 bg-slate-900/40 px-3 py-1">
      <div className="flex items-center gap-1">
        <span className="mr-0.5 text-[0.5625rem] tracking-wide text-slate-500 uppercase">Text</span>
        <StepButton
          label="Decrease text size"
          disabled={isFirstStep(step)}
          onClick={() => setStep(step - 1)}
        >
          A&minus;
        </StepButton>
        <StepButton
          label="Increase text size"
          disabled={isLastStep(step)}
          onClick={() => setStep(step + 1)}
        >
          A+
        </StepButton>
        {/* Showing the value stops the control being a guessing game. */}
        <span
          className="ml-1 font-mono text-[0.5625rem] text-slate-500 tabular-nums"
          aria-live="polite"
        >
          {fontSizeFor(step)}px
        </span>
      </div>

      <div
        role="group"
        aria-label="Colour theme"
        className="flex items-center gap-px rounded border border-slate-800 p-px"
      >
        <ThemeButton current={settings.theme} value="system" onSelect={setTheme}>
          Auto
        </ThemeButton>
        <ThemeButton current={settings.theme} value="light" onSelect={setTheme}>
          Light
        </ThemeButton>
        <ThemeButton current={settings.theme} value="dark" onSelect={setTheme}>
          Dark
        </ThemeButton>
      </div>
    </div>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-slate-700 px-1.5 py-px font-mono text-[0.5625rem] text-slate-300 transition hover:border-slate-600 hover:text-slate-100 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500"
    >
      {children}
    </button>
  );
}

function ThemeButton({
  current,
  value,
  onSelect,
  children,
}: {
  current: ThemePreference;
  value: ThemePreference;
  onSelect: (value: ThemePreference) => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(value)}
      className={`rounded-sm px-1.5 py-px text-[0.5625rem] transition focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500 ${
        active ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'
      }`}
    >
      {children}
    </button>
  );
}

/** Exposed for the settings tests; the bar itself does not need it. */
export const FONT_STEP_COUNT = FONT_STEPS.length;
