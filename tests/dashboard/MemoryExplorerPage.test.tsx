// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LanguageProvider } from "../../src/dashboard/src/i18n/LanguageProvider";
import MemoryExplorerPage from "../../src/dashboard/src/pages/MemoryExplorerPage";

vi.mock("../../src/dashboard/src/lib/api", () => ({
  fetchJson: vi.fn((url: string) => url === '/api/config'
    ? Promise.resolve({ language: 'en' })
    : Promise.reject(new Error(`UNEXPECTED_DASHBOARD_REQUEST:${url}`))),
}));
vi.mock("../../src/dashboard/src/lib/memory-read", async () => ({
  ...(await vi.importActual<typeof import("../../src/dashboard/src/lib/memory-read")>("../../src/dashboard/src/lib/memory-read")),
  useMemoryRead: vi.fn(() => ({
    data: {
      schemaVersion: 1,
      view: {
        state: 'ABSENT',
        scope: { kind: 'local-project', projectId: 'project-page' },
        selectionRevisionDigest: 'sha256:page',
        entries: [],
        deferred: [],
        nextCursor: null,
      },
    },
    loading: false,
    error: null,
  })),
  useMemoryDetail: vi.fn(() => ({ data: null, loading: false, error: null })),
}));

afterEach(() => cleanup());

describe("MemoryExplorerPage", () => {
  it("is a deep-linkable bounded-reader view, not a Markdown-derived ADR timeline", () => {
    render(<LanguageProvider><MemoryExplorerPage /></LanguageProvider>);
    expect(screen.getByTestId("memory-explorer-page")).toBeTruthy();
    expect(screen.getByTestId("memory-explorer")).toBeTruthy();
    expect(screen.getByTestId("tab-adr")).toBeTruthy();
  });
});
