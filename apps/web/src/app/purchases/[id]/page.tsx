import { Suspense } from 'react';
import { PurchaseDetailRoute } from '@/components/purchases/purchase-detail-view';

export default function PurchasePage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <Suspense>
        <PurchaseDetailRoute />
      </Suspense>
    </main>
  );
}
