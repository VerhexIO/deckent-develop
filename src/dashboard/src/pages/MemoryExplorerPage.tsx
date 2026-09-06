import MemoryExplorer from "../components/MemoryExplorer";
import { useTranslation } from "../i18n/LanguageProvider";

/** Deep-linkable observation route; it shares the same bounded reader and tabs as `/memory`. */
export default function MemoryExplorerPage() {
  const { t } = useTranslation();
  return (
    <main data-testid="memory-explorer-page" className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">{t('nav.memory_explorer')}</h1>
      </header>
      <MemoryExplorer />
    </main>
  );
}
