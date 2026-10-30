import {
  forwardRef,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'link';
  loading?: boolean;
};

const BUTTON_STYLES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-brand-700 text-white hover:bg-brand-600 disabled:bg-slate-400 px-4 py-2.5 rounded-md font-medium',
  secondary:
    'border border-slate-400 bg-white text-slate-900 hover:bg-slate-50 disabled:text-slate-500 px-4 py-2.5 rounded-md font-medium',
  danger:
    'bg-red-700 text-white hover:bg-red-800 disabled:bg-slate-400 px-4 py-2.5 rounded-md font-medium',
  link: 'text-brand-700 underline underline-offset-2 hover:text-brand-600 p-0',
};

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  children,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 ${BUTTON_STYLES[variant]} ${className}`}
      {...rest}
    >
      {loading && <Spinner label="Please wait" />}
      {children}
    </button>
  );
}

export function Alert({
  tone = 'error',
  title,
  children,
}: {
  tone?: 'error' | 'success' | 'info' | 'warning';
  title?: string;
  children: ReactNode;
}) {
  const styles = {
    error: 'border-red-700 bg-red-50 text-red-900',
    success: 'border-green-700 bg-green-50 text-green-900',
    info: 'border-brand-700 bg-sky-50 text-slate-900',
    warning: 'border-amber-700 bg-amber-50 text-amber-950',
  }[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-md border-l-4 px-4 py-3 text-sm ${styles}`}
    >
      {title && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
};

export const TextField = forwardRef<HTMLInputElement, FieldProps>(function TextField(
  { label, error, hint, id, className = '', ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-900">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-slate-700">
          {hint}
        </p>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        className={`rounded-md border px-3 py-2 text-base text-slate-900 ${
          error ? 'border-red-700' : 'border-slate-500'
        } ${className}`}
        {...rest}
      />
      {error && (
        <p id={errorId} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
});

export const PasswordField = forwardRef<HTMLInputElement, Omit<FieldProps, 'type'>>(
  function PasswordField(props, ref) {
    const [visible, setVisible] = useState(false);
    const autoId = useId();
    const id = props.id ?? autoId;
    return (
      <div className="relative">
        <TextField
          ref={ref}
          {...props}
          id={id}
          type={visible ? 'text' : 'password'}
          className="pr-20"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-controls={id}
          aria-pressed={visible}
          className="absolute right-2 top-[1.85rem] rounded px-2 py-1 text-sm font-medium text-brand-700 underline"
        >
          {visible ? 'Hide' : 'Show'}
          <span className="sr-only"> password</span>
        </button>
      </div>
    );
  },
);

export const Checkbox = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; error?: string }
>(function Checkbox({ label, error, id, ...rest }, ref) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-2">
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className="mt-1 h-4 w-4"
          {...rest}
        />
        <label htmlFor={inputId} className="text-sm text-slate-900">
          {label}
        </label>
      </div>
      {error && (
        <p id={errorId} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
});
