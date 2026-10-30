import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClinicalNoteDto } from '@clinic/shared';
import { appointmentKeys, appointmentsApi } from '../../api/appointments';
import { ApiError } from '../../api/client';
import { Alert, Button, Spinner, TextAreaField } from '../forms';

const timestamp = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Clinical notes for one appointment (doctors only). Notes are append-only:
 * a correction is a new note that amends the original, shown beneath it.
 */
export function NotesPanel({
  appointmentId,
  canWrite,
}: {
  appointmentId: string;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const key = appointmentKeys.notes(appointmentId);
  const query = useQuery({ queryKey: key, queryFn: () => appointmentsApi.notes(appointmentId) });
  const [body, setBody] = useState('');
  const [amending, setAmending] = useState<ClinicalNoteDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  if (query.isPending) return <Spinner label="Loading notes" />;
  if (query.isError) return <Alert>We couldn't load the notes. Please try again.</Alert>;

  const notes = query.data;
  const originals = notes.filter((n) => !n.amendsNoteId);
  const amendmentsOf = (id: string) => notes.filter((n) => n.amendsNoteId === id);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const created = await appointmentsApi.addNote(appointmentId, {
        body,
        amendsNoteId: amending?.id,
      });
      queryClient.setQueryData<ClinicalNoteDto[]>(key, (old) => [...(old ?? []), created]);
      setBody('');
      setAmending(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const noteCard = (n: ClinicalNoteDto, amendment = false) => (
    <div className={amendment ? 'mt-2 border-l-4 border-line-strong pl-3' : ''}>
      <p className="text-sm text-ink-muted">
        {amendment && <span className="font-medium">Amendment · </span>}
        {n.authorName} · {timestamp.format(new Date(n.createdAt))}
      </p>
      <p className="whitespace-pre-wrap break-words text-ink">{n.body}</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {originals.length === 0 ? (
        <p className="text-ink">No notes yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {originals.map((n) => (
            <li key={n.id} className="rounded-md border border-line p-3">
              {noteCard(n)}
              {amendmentsOf(n.id).map((a) => (
                <div key={a.id}>{noteCard(a, true)}</div>
              ))}
              {canWrite && (
                <Button
                  variant="link"
                  className="mt-2 min-h-11 text-sm"
                  onClick={() => {
                    setAmending(n);
                    fieldRef.current?.focus();
                  }}
                >
                  Amend this note
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <div className="flex flex-col gap-2">
          {error && <Alert>{error}</Alert>}
          <TextAreaField
            ref={fieldRef}
            label={
              amending
                ? `Amendment to the note from ${timestamp.format(new Date(amending.createdAt))}`
                : 'New note'
            }
            rows={4}
            maxLength={10_000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" loading={saving} disabled={!body.trim()} onClick={save}>
              {amending ? 'Save amendment' : 'Add note'}
            </Button>
            {amending && (
              <Button variant="secondary" className="min-h-11" onClick={() => setAmending(null)}>
                Cancel amendment
              </Button>
            )}
          </div>
          <p className="text-sm text-ink-muted">Saved notes can't be edited or deleted.</p>
        </div>
      )}
    </div>
  );
}
