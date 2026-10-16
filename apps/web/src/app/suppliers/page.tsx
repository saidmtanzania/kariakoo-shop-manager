import { Suspense } from 'react';
import { SuppliersView } from '@/components/purchases/suppliers-view';

export default function SuppliersPage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <Suspense>
        <SuppliersView />
      </Suspense>
    </main>
  );
}
