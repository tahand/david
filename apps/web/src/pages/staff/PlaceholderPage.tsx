import { PageHeading } from '../../components/layouts';

/** Temporary landing pages for staff roles until their phases are built. */
export function PlaceholderPage({ title, phase }: { title: string; phase: string }) {
  return (
    <div>
      <PageHeading>{title}</PageHeading>
      <p className="text-slate-800">This area arrives in {phase}.</p>
    </div>
  );
}
