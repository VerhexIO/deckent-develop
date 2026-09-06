import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DASHBOARD_DIR = join(process.cwd(), "src", "dashboard");

describe("dashboard/pages — HistoryPage", () => {
  const filePath = join(DASHBOARD_DIR, "src/pages/HistoryPage.tsx");

  it("file exists", () => {
    expect(existsSync(filePath)).toBe(true);
  });

  it("imports useApi hook", () => {
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("useApi");
  });

  it("fetches /api/history", () => {
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("/api/history");
  });

  it("imports SprintChart component", () => {
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("SprintChart");
    expect(content).toContain("parseChartData");
  });

  it("renders history table columns via i18n keys", () => {
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("history.sprint_id");
    expect(content).toContain("history.total_tasks");
    expect(content).toContain("history.completed");
    expect(content).toContain("history.nogo");
    expect(content).toContain("history.coverage");
    expect(content).toContain("history.duration");
  });

  it("renders loading state", () => {
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("loading");
    expect(content).toContain("common.loading");
  });

  it("renders error state", () => {
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("error");
    expect(content).toContain("Error:");
  });

  it("renders empty state", () => {
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("history.no_history");
  });

  it("uses Card components", () => {
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("Card");
    expect(content).toContain("CardHeader");
    expect(content).toContain("CardContent");
  });

  it("has dark theme classes", () => {
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("bg-zinc-900");
    expect(content).toContain("border-zinc-800");
    expect(content).toContain("text-zinc-100");
  });

  it("maps over data records", () => {
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("data.map");
  });
});

describe("dashboard/pages — MemoryPage", () => {
  const filePath = join(DASHBOARD_DIR, "src/pages/MemoryPage.tsx");

  it("file exists", () => {
    expect(existsSync(filePath)).toBe(true);
  });

  it("delegates to the shared bounded reader explorer", () => {
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("MemoryExplorer");
    expect(content).toContain("text-zinc-100");
  });
});
