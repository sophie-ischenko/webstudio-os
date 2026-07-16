/// <reference types="vite/client" />

interface StudioBridge {
  db: {
    all: (sql: string, params?: unknown[]) => Promise<unknown[]>;
    get: (sql: string, params?: unknown[]) => Promise<unknown | undefined>;
    run: (sql: string, params?: unknown[]) => Promise<{ changes: number; lastInsertRowid: number | string }>;
    transaction: (statements: { sql: string; params?: unknown[] }[]) => Promise<unknown[]>;
    backup: () => Promise<{ ok: boolean; path?: string; reason?: string }>;
  };
  util: { uuid: () => Promise<string> };
}

interface Window {
  studio?: StudioBridge;
}
