import { Suspense } from 'react';
import { NewPurchaseView } from '@/components/purchases/purchase-form';

export default function NewPurchasePage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <Suspense>
        <NewPurchaseView />
      </Suspense>
    </main>
  );
}
