import { useTranslations } from 'next-intl';
import { SystemStatus } from '@/components/system/system-status';

export default function StatusPage() {
  const t = useTranslations('App');
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">{t('name')}</h1>
        <p className="text-muted-foreground mt-1">{t('tagline')}</p>
      </div>
      <SystemStatus />
    </main>
  );
}
