import { forwardRef, useId } from 'react';

/**
 * Single-field 6-digit one-time code input (SPEC §5.2). Calls `onComplete`
 * when the sixth digit is entered so the form can auto-submit.
 */
export const CodeInput = forwardRef<
  HTMLInputElement,
  {
    label: string;
    value: string;
    onChange: (value: string) => void;
    onComplete?: (value: string) => void;
    error?: string;
    disabled?: boolean;
  }
>(function CodeInput({ label, value, onChange, onComplete, error, disabled }, ref) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-900">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        value={value}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`w-40 rounded-md border px-3 py-2 text-center font-mono text-2xl tracking-[0.4em] text-slate-900 ${
          error ? 'border-red-700' : 'border-slate-500'
        }`}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
          onChange(digits);
          if (digits.length === 6) onComplete?.(digits);
        }}
      />
      {error && (
        <p id={errorId} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
});
