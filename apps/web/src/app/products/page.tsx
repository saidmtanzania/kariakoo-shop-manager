import { ProductsView } from '@/components/products/products-view';

export default function ProductsPage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <ProductsView />
    </main>
  );
}
