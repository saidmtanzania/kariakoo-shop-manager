import { InventoryView } from '@/components/inventory/inventory-view';

export default function InventoryPage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <InventoryView />
    </main>
  );
}
