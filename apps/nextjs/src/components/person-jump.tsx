'use client';
import { useRouter } from 'next/navigation';
import { PencilLine } from 'lucide-react';
import { RecordPicker } from './record-picker';
import type { RecordOption } from '@/lib/record-options';
import { copy } from '@/lib/copy';

/** Sends a visitor to a person's page in edit mode, where additions are made in place. */
export function PersonJump({ people }: { people: RecordOption[] }) {
  const router = useRouter();
  return (
    <section className="community-section person-jump" aria-labelledby="person-jump-heading">
      <div className="community-section-heading">
        <PencilLine size={22} aria-hidden="true" />
        <h2 id="person-jump-heading">Adding to someone already in the archive?</h2>
      </div>
      <p className="community-section-note">
        Memories, photographs, places, and corrections are added directly on that person’s page.
        Choose them here, or open their page from the map and press {copy.editPage}.
      </p>
      <RecordPicker
        label="Who is your story about?"
        options={people}
        value={[]}
        onChange={(ids) => {
          if (ids[0]) router.push(`/people/${encodeURIComponent(ids[0])}?edit=1`);
        }}
        placeholder="Search names or alternate names…"
      />
    </section>
  );
}
