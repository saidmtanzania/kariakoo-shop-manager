import { Suspense } from 'react';
import { PurchasesView } from '@/components/purchases/purchases-view';

export default function PurchasesPage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <Suspense>
        <PurchasesView />
      </Suspense>
    </main>
  );
}
