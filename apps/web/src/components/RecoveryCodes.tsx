import { useState } from 'react';
import { Alert, Button, Checkbox } from './forms';

/**
 * Shows recovery codes once. They are offered as a file download (built in
 * memory) rather than ever being written to browser storage.
 */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = `Clinic Appointments — recovery codes\nEach code can be used once.\n\n${codes.join('\n')}\n`;

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="warning" title="Save your recovery codes now">
        If you lose your phone, each of these codes lets you sign in once. They won't be shown
        again.
      </Alert>
      <ol
        aria-label="Recovery codes"
        className="grid grid-cols-2 gap-2 rounded-md bg-slate-100 p-4 font-mono text-slate-900"
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={download}>
          Download
        </Button>
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard?.writeText(text);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <Checkbox
        label="I have saved my recovery codes somewhere safe"
        checked={saved}
        onChange={(e) => setSaved(e.target.checked)}
      />
      <Button disabled={!saved} onClick={onDone}>
        Continue
      </Button>
    </div>
  );
}
