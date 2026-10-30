import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { patientKeys, patientsApi } from '../../api/patients';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Button, Spinner, TextField } from '../../components/forms';
import { PageHeading } from '../../components/layouts';
import { formatDate } from '../../lib/format';

function ResultField({ label, value }: { label: string; value: string | null }) {
  return (
    <p className="text-slate-900">
      <span className="text-slate-700 sm:sr-only">{label}: </span>
      {value ?? '—'}
    </p>
  );
}

/** Staff patient search (SPEC §10): name, date of birth, postcode or phone. */
export function PatientsPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [draft, setDraft] = useState(search);
  const canCreate = me?.user.role === 'receptionist' || me?.user.role === 'admin';

  const query = useQuery({
    queryKey: patientKeys.search(search, page),
    queryFn: () => patientsApi.search(search, page),
    placeholderData: keepPreviousData,
  });

  const go = (q: string, p: number) => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (p > 1) next.set('page', String(p));
    setParams(next);
  };
  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    go(draft.trim(), 1);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeading>Patients</PageHeading>
        {canCreate && (
          <Link
            to="/patients/new"
            className="rounded-md bg-brand-700 px-4 py-2.5 font-medium text-white hover:bg-brand-600"
          >
            Add patient
          </Link>
        )}
      </div>
      {me?.user.role === 'doctor' && (
        <p className="text-slate-800">You can see patients who have an appointment with you.</p>
      )}

      <form role="search" onSubmit={onSearch} className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <TextField
            label="Search patients"
            hint="Name, date of birth (e.g. 31/01/1990), postcode or phone number"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={100}
          />
        </div>
        <Button type="submit" className="w-full sm:w-auto">
          Search
        </Button>
      </form>

      {query.isPending ? (
        <Spinner label="Searching" />
      ) : query.isError ? (
        <Alert>We couldn't load patients. Please try again.</Alert>
      ) : query.data.patients.length === 0 ? (
        <p className="text-slate-800" role="status">
          {search ? `No patients match "${search}".` : 'No patients yet.'}
        </p>
      ) : (
        <>
          {/* One list for every screen size: stacked cards on phones, a
              table-like grid from `sm` up. Field labels are visible on phones
              and screen-reader-only on wider screens. */}
          <div className="rounded-lg border border-slate-200 bg-white text-sm">
            <div
              aria-hidden="true"
              className="hidden grid-cols-[2fr_1fr_1fr_1fr] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 font-semibold text-slate-900 sm:grid"
            >
              <span>Name</span>
              <span>Date of birth</span>
              <span>Postcode</span>
              <span>Mobile</span>
            </div>
            <ul
              aria-label={`${search ? `Patients matching "${search}"` : 'Patients'}, page ${page}`}
            >
              {query.data.patients.map((p) => (
                <li
                  key={p.id}
                  className="grid gap-1 border-b border-slate-100 px-4 py-3 last:border-0 sm:grid-cols-[2fr_1fr_1fr_1fr] sm:gap-4"
                >
                  <Link
                    to={`/patients/${p.id}`}
                    className="flex min-h-11 items-center font-medium text-brand-700 underline sm:min-h-0"
                  >
                    {p.lastName}, {p.firstName}
                    {p.preferredName && ` (${p.preferredName})`}
                  </Link>
                  <ResultField label="Date of birth" value={formatDate(p.dateOfBirth)} />
                  <ResultField label="Postcode" value={p.postcode} />
                  <ResultField label="Mobile" value={p.phoneMobile} />
                </li>
              ))}
            </ul>
          </div>
          <nav aria-label="Pagination" className="flex items-center gap-3">
            <Button variant="secondary" disabled={page <= 1} onClick={() => go(search, page - 1)}>
              Previous
            </Button>
            <span className="text-sm text-slate-800">Page {page}</span>
            <Button
              variant="secondary"
              disabled={!query.data.hasMore}
              onClick={() => go(search, page + 1)}
            >
              Next
            </Button>
          </nav>
        </>
      )}
    </div>
  );
}
