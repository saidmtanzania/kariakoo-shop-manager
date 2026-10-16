import { Suspense } from 'react';
import { SupplierDetailRoute } from '@/components/purchases/supplier-detail-view';

export default function SupplierPage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <Suspense>
        <SupplierDetailRoute />
      </Suspense>
    </main>
  );
}
