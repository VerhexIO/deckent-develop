import MemoryExplorer from "../components/MemoryExplorer";
import { useTranslation } from "../i18n/LanguageProvider";

/** Dashboard memory is an observe-only bounded projection of the shared reader. */
export default function MemoryPage() {
  const { t } = useTranslation();
  return (
    <main className="space-y-6" data-testid="memory-page">
      <h1 className="text-2xl font-bold text-zinc-100">{t('memory.title')}</h1>
      <MemoryExplorer />
    </main>
  );
}
