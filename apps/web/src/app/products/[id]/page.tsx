import { Suspense } from 'react';
import { ProductDetailRoute } from '@/components/products/product-detail-view';

export default function ProductPage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <Suspense>
        <ProductDetailRoute />
      </Suspense>
    </main>
  );
}
