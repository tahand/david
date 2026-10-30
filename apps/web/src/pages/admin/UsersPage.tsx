import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AdminUserDto } from '@clinic/shared';
import { adminApi, adminKeys, type UserFilters } from '../../api/admin';
import { Alert, Button, SelectField, Spinner, TextField } from '../../components/forms';
import { PageHeading } from '../../components/layouts';
import { formatInstant, ROLE_LABELS } from './labels';

/** Account state as badges; shows `fallback` text when nothing needs attention. */
export function StatusBadges({
  user,
  fallback = 'Active',
}: {
  user: AdminUserDto;
  fallback?: string;
}) {
  const badges: { label: string; tone: string }[] = [];
  if (!user.isActive) badges.push({ label: 'Deactivated', tone: 'bg-red-100 text-red-900' });
  if (user.invitePending)
    badges.push({ label: 'Invite pending', tone: 'bg-amber-100 text-amber-950' });
  if (user.lockedUntil) badges.push({ label: 'Locked', tone: 'bg-amber-100 text-amber-950' });
  if (user.role !== 'patient' && !user.mfaEnabled && !user.invitePending) {
    badges.push({ label: 'MFA not set up', tone: 'bg-amber-100 text-amber-950' });
  }
  if (badges.length === 0) return <span className="text-ink">{fallback}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {badges.map((b) => (
        <span key={b.label} className={`rounded px-2 py-0.5 text-xs font-medium ${b.tone}`}>
          {b.label}
        </span>
      ))}
    </span>
  );
}

const ROLE_FILTERS = [
  { value: '', label: 'All roles' },
  ...(['doctor', 'receptionist', 'admin', 'patient'] as const).map((r) => ({
    value: r,
    label: ROLE_LABELS[r],
  })),
];
const STATUS_FILTERS = [
  { value: '', label: 'Any status' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Deactivated' },
];

/** `/admin/users` (SPEC §10): find accounts and add staff. Filters live in the URL. */
export function UsersPage() {
  const [params, setParams] = useSearchParams();
  const filters: UserFilters = {
    q: params.get('q') ?? undefined,
    role: params.get('role') ?? undefined,
    status: params.get('status') ?? undefined,
    page: Math.max(1, Number(params.get('page')) || 1),
  };
  const [draft, setDraft] = useState({
    q: filters.q ?? '',
    role: filters.role ?? '',
    status: filters.status ?? '',
  });

  const query = useQuery({
    queryKey: adminKeys.users(filters),
    queryFn: () => adminApi.users(filters),
    placeholderData: keepPreviousData,
  });

  const go = (next: Omit<UserFilters, 'page'>, page = 1) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    if (page > 1) p.set('page', String(page));
    setParams(p);
  };
  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    go({ q: draft.q.trim(), role: draft.role, status: draft.status });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeading>Users</PageHeading>
        <Link
          to="/admin/users/new"
          className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 py-2.5 font-medium text-on-brand hover:bg-brand-hover"
        >
          Add staff member
        </Link>
      </div>

      <form
        role="search"
        onSubmit={onSearch}
        className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
      >
        <TextField
          label="Search"
          hint="Email address or doctor's name"
          value={draft.q}
          maxLength={100}
          onChange={(e) => setDraft({ ...draft, q: e.target.value })}
        />
        <SelectField
          label="Role"
          options={ROLE_FILTERS}
          value={draft.role}
          onChange={(e) => setDraft({ ...draft, role: e.target.value })}
        />
        <SelectField
          label="Status"
          options={STATUS_FILTERS}
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value })}
        />
        <Button type="submit" className="min-h-11 w-full sm:w-auto">
          Search
        </Button>
      </form>

      {query.isPending ? (
        <Spinner label="Loading users" />
      ) : query.isError ? (
        <Alert>We couldn't load users. Please try again.</Alert>
      ) : query.data.users.length === 0 ? (
        <p className="text-ink" role="status">
          No users match these filters.
        </p>
      ) : (
        <>
          <div className="rounded-lg border border-line bg-card text-sm">
            <div
              aria-hidden="true"
              className="hidden grid-cols-[2fr_1fr_1fr_1.5fr] gap-4 border-b border-line bg-page px-4 py-3 font-semibold text-ink sm:grid"
            >
              <span>Account</span>
              <span>Role</span>
              <span>Last sign-in</span>
              <span>Status</span>
            </div>
            <ul aria-label={`Users, page ${filters.page}`}>
              {query.data.users.map((u) => (
                <li
                  key={u.id}
                  className="grid gap-1 border-b border-line px-4 py-3 last:border-0 sm:grid-cols-[2fr_1fr_1fr_1.5fr] sm:gap-4"
                >
                  <div className="min-w-0">
                    <Link
                      to={`/admin/users/${u.id}`}
                      className="flex min-h-11 items-center font-medium break-all text-link underline sm:min-h-0"
                    >
                      {u.email}
                    </Link>
                    {u.doctor && <p className="text-ink-muted">{u.doctor.displayName}</p>}
                  </div>
                  <p className="text-ink">
                    <span className="text-ink-muted sm:sr-only">Role: </span>
                    {ROLE_LABELS[u.role]}
                  </p>
                  <p className="text-ink">
                    <span className="text-ink-muted sm:sr-only">Last sign-in: </span>
                    {formatInstant(u.lastLoginAt)}
                  </p>
                  <div>
                    <span className="sr-only">Status: </span>
                    <StatusBadges user={u} />
                  </div>
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
              Previous
            </Button>
            <span className="text-sm text-ink">Page {filters.page}</span>
            <Button
              variant="secondary"
              disabled={!query.data.hasMore}
              onClick={() => go(filters, filters.page + 1)}
            >
              Next
            </Button>
          </nav>
        </>
      )}
    </div>
  );
}
