import { Suspense } from 'react';
import { EditPurchaseRoute } from '@/components/purchases/purchase-form';

export default function EditPurchasePage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <Suspense>
        <EditPurchaseRoute />
      </Suspense>
    </main>
  );
}
