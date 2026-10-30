import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { adminApi, adminKeys, type AuditFilters } from '../../api/admin';
import { ApiError } from '../../api/client';
import { Alert, Button, Spinner, TextField } from '../../components/forms';
import { PageHeading } from '../../components/layouts';
import { formatInstant } from './labels';

const FILTER_KEYS = ['actor', 'entity', 'action', 'from', 'to'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

/** Links an entity to its admin page where one exists. */
function EntityRef({ type, id }: { type: string | null; id: string | null }) {
  if (!type && !id) return <span className="text-ink-muted">—</span>;
  const href =
    type === 'user' && id
      ? `/admin/users/${id}`
      : type === 'patient' && id
        ? `/patients/${id}`
        : null;
  const label = `${type ?? 'entity'}${id ? ` ${id.slice(0, 8)}…` : ''}`;
  return href ? (
    <Link to={href} className="text-link underline" title={id ?? undefined}>
      {label}
    </Link>
  ) : (
    <span title={id ?? undefined}>{label}</span>
  );
}

/**
 * `/admin/audit-logs` (SPEC §9). Read-only view of the append-only trail.
 * Metadata holds IDs and field names only, so it's safe to show as-is.
 */
export function AuditLogPage() {
  const [params, setParams] = useSearchParams();
  const filters: AuditFilters = {
    ...Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? undefined])),
    page: Math.max(1, Number(params.get('page')) || 1),
  };
  const [draft, setDraft] = useState<Record<FilterKey, string>>(
    Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<
      FilterKey,
      string
    >,
  );

  const query = useQuery({
    queryKey: adminKeys.audit(filters),
    queryFn: () => adminApi.auditLogs(filters),
    placeholderData: keepPreviousData,
  });

  const go = (values: Partial<Record<FilterKey, string | undefined>>, page = 1) => {
    const p = new URLSearchParams();
    for (const k of FILTER_KEYS) if (values[k]) p.set(k, values[k]!.trim());
    if (page > 1) p.set('page', String(page));
    setParams(p);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    go(draft);
  };
  const field = (k: FilterKey, label: string, hint?: string, type = 'text') => (
    <TextField
      label={label}
      hint={hint}
      type={type}
      value={draft[k]}
      maxLength={254}
      onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeading>Audit log</PageHeading>
      <form
        role="search"
        onSubmit={onSubmit}
        className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          {field('actor', 'Who', 'Email address or user ID')}
          {field('entity', 'Record', 'Record ID, or a type such as patient')}
          {field('action', 'Action', 'e.g. patient.view, or auth. for all sign-in events')}
          {field('from', 'From', undefined, 'date')}
          {field('to', 'To', undefined, 'date')}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit">Filter</Button>
          <Button
            variant="secondary"
            onClick={() => {
              setDraft(
                Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])) as Record<FilterKey, string>,
              );
              go({});
            }}
          >
            Clear filters
          </Button>
        </div>
      </form>

      {query.isPending ? (
        <Spinner label="Loading audit log" />
      ) : query.isError ? (
        <Alert>
          {query.error instanceof ApiError && query.error.code === 'VALIDATION_ERROR'
            ? (query.error.details[0]?.message ?? query.error.message)
            : "We couldn't load the audit log. Please try again."}
        </Alert>
      ) : query.data.entries.length === 0 ? (
        <p className="text-ink" role="status">
          No entries match these filters.
        </p>
      ) : (
        <>
          <div className="rounded-lg border border-line bg-card text-sm">
            <div
              aria-hidden="true"
              className="hidden grid-cols-[1.2fr_1.5fr_1.5fr_1.2fr_1fr] gap-4 border-b border-line bg-page px-4 py-3 font-semibold text-ink md:grid"
            >
              <span>When</span>
              <span>Action</span>
              <span>Who</span>
              <span>Record</span>
              <span>IP</span>
            </div>
            <ul aria-label={`Audit entries, page ${filters.page}`}>
              {query.data.entries.map((e) => (
                <li
                  key={e.id}
                  className="grid gap-1 border-b border-line px-4 py-3 last:border-0 md:grid-cols-[1.2fr_1.5fr_1.5fr_1.2fr_1fr] md:gap-4"
                >
                  <span className="text-ink-muted">{formatInstant(e.createdAt)}</span>
                  <span className="font-mono text-ink break-all">{e.action}</span>
                  <span className="text-ink break-all">
                    <span className="text-ink-muted md:sr-only">Who: </span>
                    {e.actorEmail ?? (e.actorUserId ? e.actorUserId.slice(0, 8) : 'System')}
                  </span>
                  <span className="text-ink">
                    <span className="text-ink-muted md:sr-only">Record: </span>
                    <EntityRef type={e.entityType} id={e.entityId} />
                  </span>
                  <span className="text-ink-muted break-all">{e.ip ?? '—'}</span>
                  {e.metadata != null && (
                    <details className="md:col-span-5">
                      <summary className="cursor-pointer text-link">Details</summary>
                      <pre className="mt-1 overflow-x-auto rounded bg-page p-2 text-xs text-ink">
                        {JSON.stringify(e.metadata, null, 2)}
                      </pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <nav aria-label="Pagination" className="flex items-center gap-3">
            <Button
              variant="secondary"
              disabled={filters.page <= 1}
              onClick={() => go(filters, filters.page - 1)}
            >
              Newer
            </Button>
            <span className="text-sm text-ink">Page {filters.page}</span>
            <Button
              variant="secondary"
              disabled={!query.data.hasMore}
              onClick={() => go(filters, filters.page + 1)}
            >
              Older
            </Button>
          </nav>
        </>
      )}
    </div>
  );
}
