export type MemoryExportLanguage = 'en' | 'tr';

export interface MemoryExportLabels {
  summaryTitle: string;
  decisionsTitle: string;
  activeArchitectureDecisions: string;
  noArchitectureDecisions: string;
  recentLearnings: string;
  legacyEpochLearnings: string;
  unattributedLearnings: string;
  noLearnings: string;
  sprintLearnings: string;
  memoryDetailsTitle: string;
  sprintLearningHeading: string;
  details: string;
  fullDetails: string;
  boundedViewNotice: string;
  memoryIndex: string;
  viewBudgetFloorExceeded: string;
  id: string;
  title: string;
  status: string;
  sprintId: string;
  activeTechnicalDebt: string;
  noActiveTechnicalDebt: string;
  activePatterns: string;
  noActivePatterns: string;
  technicalDebtTitle: string;
  resolvedTechnicalDebt: string;
  noTechnicalDebt: string;
  priority: string;
  totalEntriesGenerated: string;
  repeatedPattern: string;
}

export type MemoryExportGetMessage = (
  key: string,
  language: string,
  vars?: Record<string, string>,
) => string;

/** Pure presentation-boundary adapter. Core never imports the CLI catalog. */
export function buildMemoryExportLabels(
  getMessage: MemoryExportGetMessage,
  language: MemoryExportLanguage = 'en',
): MemoryExportLabels {
  const message = (key: string) => getMessage(`memory_export.${key}`, language);
  return Object.freeze({
    summaryTitle: message('summary_title'),
    decisionsTitle: message('decisions_title'),
    activeArchitectureDecisions: message('active_architecture_decisions'),
    noArchitectureDecisions: message('no_architecture_decisions'),
    recentLearnings: message('recent_learnings'),
    legacyEpochLearnings: message('legacy_epoch_learnings'),
    unattributedLearnings: message('unattributed_learnings'),
    noLearnings: message('no_learnings'),
    sprintLearnings: message('sprint_learnings'),
    memoryDetailsTitle: message('memory_details_title'),
    sprintLearningHeading: message('sprint_learning_heading'),
    details: message('details'),
    fullDetails: message('full_details'),
    boundedViewNotice: message('bounded_view_notice'),
    memoryIndex: message('memory_index'),
    viewBudgetFloorExceeded: message('view_budget_floor_exceeded'),
    id: message('id'),
    title: message('title'),
    status: message('status'),
    sprintId: message('sprint_id'),
    activeTechnicalDebt: message('active_technical_debt'),
    noActiveTechnicalDebt: message('no_active_technical_debt'),
    activePatterns: message('active_patterns'),
    noActivePatterns: message('no_active_patterns'),
    technicalDebtTitle: message('technical_debt_title'),
    resolvedTechnicalDebt: message('resolved_technical_debt'),
    noTechnicalDebt: message('no_technical_debt'),
    priority: message('priority'),
    totalEntriesGenerated: message('total_entries_generated'),
    repeatedPattern: message('repeated_pattern'),
  });
}
