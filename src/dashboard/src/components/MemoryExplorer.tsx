import { useRef, useState, type FormEvent } from "react";
import { AlertTriangle, BookOpen, Brain, Search, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Input } from "./ui/input";
import EmptyState from "./EmptyState";
import { SkeletonText } from "./Skeleton";
import { useTranslation } from "../i18n/LanguageProvider";
import type { TranslationKey } from "../i18n/en";
import {
  type MemoryReadHold,
  type MemoryReadScope,
  type MemoryReadView,
  type MemoryRequestError,
  useMemoryDetail,
  useMemoryRead,
} from "../lib/memory-read";

type MemoryTab = 'memory' | 'adr' | 'debt';

const tabTypes: Readonly<Record<MemoryTab, string>> = {
  memory: 'memory',
  adr: 'adr',
  debt: 'debt',
};

function scopeSummary(scope: MemoryReadScope, t: (key: TranslationKey) => string): string {
  const project = `${t('memory.project')}: ${scope.projectId}`;
  return scope.kind === 'tenant'
    ? `${t('memory.tenant')}: ${scope.tenantId} · ${project}`
    : `${t('memory.local_project')}: ${project}`;
}

function shortRevision(revision: string): string {
  return revision.length <= 22 ? revision : `${revision.slice(0, 19)}…`;
}

function holdExplanationKey(reasonCode: MemoryReadHold['reasonCode']): TranslationKey {
  switch (reasonCode) {
    case 'CURSOR_INVALID':
    case 'CURSOR_STALE':
      return 'memory.hold_cursor';
    case 'REQUIRED_ENTRY_MISSING':
    case 'REQUIRED_REFERENCE_AMBIGUOUS':
      return 'memory.hold_required_missing';
    case 'REQUIRED_ENTRY_OVERSIZE':
    case 'CRITICAL_CONTEXT_UNAVAILABLE':
    case 'CANDIDATE_LIMIT_EXHAUSTED':
    case 'INSUFFICIENT_CONTEXT':
    case 'RENDER_LIMIT_EXCEEDED':
      return 'memory.hold_limits';
    case 'TENANT_SCOPE_UNAVAILABLE':
      return 'memory.hold_scope_unavailable';
    case 'DETAIL_REFERENCE_INVALID':
    case 'DETAIL_CHANGED':
      return 'memory.hold_detail_changed';
    case 'INVALID_REQUEST':
    case 'INVALID_LIMITS':
      return 'memory.hold_invalid_request';
    case 'QUERY_FAILED':
      return 'memory.hold_query_failed';
  }
}

function requestErrorKey(error: MemoryRequestError): TranslationKey {
  switch (error) {
    case 'forbidden': return 'memory.error_forbidden';
    case 'network': return 'memory.error_network';
    case 'request': return 'memory.error_request';
  }
}

function readStatusKey(loading: boolean, error: MemoryRequestError | null, view: MemoryReadView | undefined): TranslationKey {
  if (loading) return 'memory.status_loading';
  if (error !== null) return requestErrorKey(error);
  switch (view?.state) {
    case 'AVAILABLE': return 'memory.status_available';
    case 'ABSENT': return 'memory.status_absent';
    case 'HOLD': return 'memory.status_hold';
    default: return 'memory.status_loading';
  }
}

function absentState(tab: MemoryTab): { readonly title: TranslationKey; readonly icon: typeof Brain | typeof BookOpen | typeof AlertTriangle } {
  switch (tab) {
    case 'adr': return { title: 'memory.absent_adr_title', icon: BookOpen };
    case 'debt': return { title: 'memory.absent_debt_title', icon: AlertTriangle };
    case 'memory': return { title: 'memory.absent_memory_title', icon: Brain };
  }
}

function MemoryHold({ hold, detail = false, onRestart, onRetry }: {
  readonly hold: MemoryReadHold;
  readonly detail?: boolean;
  readonly onRestart?: () => void;
  readonly onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const canRestart = onRestart !== undefined && (hold.reasonCode === 'CURSOR_INVALID' || hold.reasonCode === 'CURSOR_STALE');
  const canRetry = onRetry !== undefined && (hold.reasonCode === 'QUERY_FAILED' || hold.reasonCode === 'INVALID_REQUEST');
  const testId = detail ? 'memory-detail-hold' : 'memory-hold';
  return (
    <section data-testid={testId} className="rounded border border-amber-800 p-3">
      <p className="text-amber-300">{t('memory.hold_title')}: {hold.reasonCode}</p>
      <p className="mt-1 text-sm text-zinc-300">{t(holdExplanationKey(hold.reasonCode))}</p>
      <div data-testid={`${testId}-scope`} className="mt-2 text-xs text-zinc-400">
        {t('memory.scope')}: {hold.scope === null ? t('memory.not_available') : scopeSummary(hold.scope, t)}
      </div>
      {hold.requiredIds.length > 0 && (
        <div data-testid={`${testId}-required-ids`} className="mt-1 text-xs text-zinc-400">
          {t('memory.required_ids')}: {hold.requiredIds.join(', ')}
        </div>
      )}
      {canRestart && (
        <button data-testid="memory-restart-query" type="button" onClick={onRestart} className="mt-2 text-sm text-zinc-200 underline">
          {t('memory.restart_query')}
        </button>
      )}
      {canRetry && (
        <button data-testid="memory-retry" type="button" onClick={onRetry} className="mt-2 text-sm text-zinc-200 underline">
          {t('memory.retry')}
        </button>
      )}
    </section>
  );
}

function MemoryDetail({ detailRef, onClose }: { readonly detailRef: string; readonly onClose: () => void }) {
  const { t } = useTranslation();
  const { data, loading, error } = useMemoryDetail(detailRef);
  if (loading) return <SkeletonText lines={4} />;
  if (error || data?.detail.state === 'HOLD') {
    return (
      <section data-testid="memory-detail-error" className="rounded-md border border-amber-800 bg-zinc-950 p-4">
        {data?.detail.state === 'HOLD'
          ? <MemoryHold hold={data.detail} detail />
          : <p data-testid="memory-detail-error-status" className="text-red-300">{t(requestErrorKey(error!))}</p>}
        <button type="button" onClick={onClose} className="mt-3 text-sm text-zinc-300 underline">{t('memory.close_detail')}</button>
      </section>
    );
  }
  const detail = data?.detail;
  if (!detail || detail.state !== 'AVAILABLE') return null;
  return (
    <section data-testid="memory-detail" className="rounded-md border border-zinc-700 bg-zinc-950 p-4" aria-label={detail.entry.title}>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium text-zinc-100">{detail.entry.title}</h3>
          <dl className="mt-2 grid gap-1 text-sm text-zinc-400">
            <div><dt className="sr-only">{t('memory.id')}</dt><dd>{t('memory.id')}: {detail.entry.id}</dd></div>
            <div><dt className="sr-only">{t('memory.source')}</dt><dd>{t('memory.source')}: {detail.entry.source}</dd></div>
            <div><dt className="sr-only">{t('memory.status')}</dt><dd>{t('memory.status')}: {detail.entry.status}</dd></div>
            <div><dt className="sr-only">{t('memory.sprint')}</dt><dd>{t('memory.sprint')}: {detail.entry.sprint_id ?? t('memory.not_available')}</dd></div>
            <div><dt className="sr-only">{t('memory.updated_at')}</dt><dd>{t('memory.updated_at')}: {detail.entry.updated_at}</dd></div>
          </dl>
        </div>
        <button type="button" onClick={onClose} className="text-sm text-zinc-300 underline">{t('memory.close_detail')}</button>
      </div>
      <pre className="whitespace-pre-wrap break-words text-sm text-zinc-200">{detail.entry.content}</pre>
    </section>
  );
}

export default function MemoryExplorer() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<MemoryTab>('memory');
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [detailRef, setDetailRef] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { data, loading, error, retry } = useMemoryRead({ query, type: tabTypes[tab], cursor });
  const view = data?.view;
  const empty = absentState(tab);
  const returnFocusToSearch = () => searchInputRef.current?.focus();

  const selectTab = (next: MemoryTab) => {
    setTab(next);
    setCursor(undefined);
    setDetailRef(null);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQuery(draft);
    setCursor(undefined);
    setDetailRef(null);
  };
  const restartQuery = () => {
    setCursor(undefined);
    setDetailRef(null);
    returnFocusToSearch();
  };
  const nextPage = () => {
    setCursor(view?.state === 'AVAILABLE' ? view.nextCursor ?? undefined : undefined);
    setDetailRef(null);
    returnFocusToSearch();
  };
  const retryRead = () => {
    retry();
    returnFocusToSearch();
  };
  const closeDetail = () => {
    setDetailRef(null);
    returnFocusToSearch();
  };

  return (
    <div data-testid="memory-explorer" className="space-y-4">
      <Tabs defaultValue="memory" value={tab} onValueChange={(value) => selectTab(value as MemoryTab)}>
        <TabsList aria-label={t('memory.title')}>
          <TabsTrigger value="memory" data-testid="tab-memory"><Brain className="mr-1 h-4 w-4" />{t('memory.tab_memory')}</TabsTrigger>
          <TabsTrigger value="adr" data-testid="tab-adr"><BookOpen className="mr-1 h-4 w-4" />{t('memory.tab_adr')}</TabsTrigger>
          <TabsTrigger value="debt" data-testid="tab-debt"><AlertTriangle className="mr-1 h-4 w-4" />{t('memory.tab_debt')}</TabsTrigger>
        </TabsList>
        {(['memory', 'adr', 'debt'] as const).map((name) => (
          <TabsContent key={name} value={name}>
            <Card className="border-zinc-800 bg-zinc-900">
              <CardHeader className="pb-3">
                <CardTitle data-testid="memory-results-heading" className="text-zinc-100">{name === 'adr' ? t('memory.tab_adr') : name === 'debt' ? t('memory.tab_debt') : t('memory.title')}</CardTitle>
                <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2" data-testid="search-container">
                  <label className="sr-only" htmlFor="memory-search">{t('memory.search_label')}</label>
                  <div className="relative min-w-0 flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                    <Input ref={searchInputRef} id="memory-search" data-testid="search-input" placeholder={t('memory.search_placeholder')} value={draft}
                      onChange={(event) => setDraft(event.target.value)} className="bg-zinc-800 pl-9 pr-10 text-zinc-200" />
                    {draft.length > 0 && <button type="button" aria-label={t('memory.search_clear')} data-testid="search-clear" onClick={() => { setDraft(''); setQuery(''); setCursor(undefined); setDetailRef(null); returnFocusToSearch(); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400"><X className="h-4 w-4" /></button>}
                  </div>
                  <button data-testid="memory-search-submit" type="submit" className="shrink-0 text-sm text-zinc-300 underline">{t('memory.search_submit')}</button>
                </form>
              </CardHeader>
              <CardContent className="space-y-3" aria-busy={loading}>
                <p data-testid="memory-read-live-status" role="status" aria-live="polite" className="sr-only">{t(readStatusKey(loading, error, view))}</p>
                {loading && <div aria-label={t('common.loading')}><SkeletonText lines={5} /></div>}
                {error && <div data-testid="memory-error" className="text-red-300"><p>{t(requestErrorKey(error))}</p>{error !== 'forbidden' && <button data-testid="memory-retry" type="button" onClick={retryRead} className="mt-2 text-sm text-zinc-200 underline">{t('memory.retry')}</button>}</div>}
                {!loading && !error && view !== undefined && view.state !== 'HOLD' && (
                  <div data-testid="memory-read-metadata" className="rounded border border-zinc-800 px-3 py-2 text-xs text-zinc-400">
                    <div>{t('memory.scope')}: {scopeSummary(view.scope, t)}</div>
                    <details>
                      <summary>{t('memory.revision')}: <code>{shortRevision(view.selectionRevisionDigest)}</code></summary>
                      <code className="mt-1 block break-all text-zinc-300">{view.selectionRevisionDigest}</code>
                    </details>
                  </div>
                )}
                {!loading && !error && view?.state === 'HOLD' && (
                  <MemoryHold hold={view} onRestart={restartQuery} onRetry={retryRead} />
                )}
                {!loading && !error && view?.state === 'ABSENT' && <div data-testid="memory-absent"><EmptyState icon={empty.icon} title={t(empty.title)} description={t('memory.absent_desc')} /></div>}
                {!loading && !error && view?.state === 'AVAILABLE' && <>
                  <ul data-testid="memory-content" className="space-y-2">
                    {view.entries.map(({ entry }) => <li key={entry.id} className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                      <h3 className="text-sm font-medium text-zinc-100">{entry.title}</h3>
                      <dl className="mt-1 flex flex-wrap gap-x-3 text-xs text-zinc-400">
                        <div><dt className="sr-only">{t('memory.id')}</dt><dd>{t('memory.id')}: {entry.id}</dd></div>
                        <div><dt className="sr-only">{t('memory.source')}</dt><dd>{t('memory.source')}: {entry.source}</dd></div>
                        <div><dt className="sr-only">{t('memory.status')}</dt><dd>{t('memory.status')}: {entry.status}</dd></div>
                        <div><dt className="sr-only">{t('memory.sprint')}</dt><dd>{t('memory.sprint')}: {entry.sprint_id ?? t('memory.not_available')}</dd></div>
                        <div><dt className="sr-only">{t('memory.updated_at')}</dt><dd>{t('memory.updated_at')}: {entry.updated_at}</dd></div>
                      </dl>
                      <pre className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-300">{entry.content}</pre>
                    </li>)}
                    {view.deferred.map((deferred) => <li key={deferred.detailRef} className="rounded-md border border-zinc-700 p-3 text-sm text-zinc-300">
                      <h3 className="font-medium text-zinc-100">{deferred.candidate.titlePreview}</h3>
                      <dl className="mt-1 flex flex-wrap gap-x-3 text-xs text-zinc-400">
                        <div><dt className="sr-only">{t('memory.id')}</dt><dd>{t('memory.id')}: {deferred.candidate.id}</dd></div>
                        <div><dt className="sr-only">{t('memory.source')}</dt><dd>{t('memory.source')}: {deferred.candidate.source}</dd></div>
                        <div><dt className="sr-only">{t('memory.status')}</dt><dd>{t('memory.status')}: {deferred.candidate.status}</dd></div>
                        <div><dt className="sr-only">{t('memory.sprint')}</dt><dd>{t('memory.sprint')}: {deferred.candidate.sprintId ?? t('memory.not_available')}</dd></div>
                      </dl>
                      <button type="button" onClick={() => setDetailRef(deferred.detailRef)} className="ml-3 underline">{t('memory.open_detail')}</button>
                    </li>)}
                  </ul>
                  {view.deferred.length > 0 && <p className="text-sm text-zinc-400">{t('memory.deferred')}</p>}
                  {view.nextCursor !== null && <button data-testid="memory-next-page" type="button" onClick={nextPage} className="text-sm text-zinc-200 underline">{t('memory.next_page')}</button>}
                </>}
                {detailRef !== null && <MemoryDetail detailRef={detailRef} onClose={closeDetail} />}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
