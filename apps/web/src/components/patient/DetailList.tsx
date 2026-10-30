import type { ReactNode } from 'react';

export type DetailItem = [label: string, value: ReactNode];

const isEmpty = (v: ReactNode) => v === null || v === undefined || v === '';

/** Read-only label/value list; empty values read "Not recorded". */
export function DetailList({ items }: { items: DetailItem[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-sm font-medium text-slate-700">{label}</dt>
          <dd className={isEmpty(value) ? 'text-slate-600 italic' : 'text-slate-900'}>
            {isEmpty(value) ? 'Not recorded' : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
