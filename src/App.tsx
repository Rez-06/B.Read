import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import ContinuousView from "./ContinuousView";
import "./styles.css";

type Tab = {
  id: number;
  pageCount: number;
  firstPageSize: [number, number];
  path: string;
  /** Content fingerprint; null until it has been computed in the background. */
  docKey: string | null;
};
type ViewState = { page: number; zoom: number };

function baseName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tabsRef = useRef<Tab[]>([]);
  const viewStates = useRef(new Map<number, ViewState>());

  async function openPaths(paths: string[]) {
    for (const path of paths) {
      const existing = tabsRef.current.find((t) => t.path === path);
      if (existing) {
        setActiveId(existing.id);
        continue;
      }
      try {
        const opened = await invoke<{
          id: number;
          pageCount: number;
          firstPageSize: [number, number];
        }>("open_pdf", { path });
        const tab: Tab = { ...opened, path, docKey: null };
        tabsRef.current = [...tabsRef.current, tab];
        setTabs(tabsRef.current);
        setActiveId(tab.id);
        setError(null);

        // Identify the document by its contents in the background.
        invoke<string>("file_fingerprint", { path })
          .then(async (fingerprint) => {
            await invoke("subtext_adopt", { path, fingerprint });
            tabsRef.current = tabsRef.current.map((t) =>
              t.id === tab.id ? { ...t, docKey: fingerprint } : t,
            );
            setTabs(tabsRef.current);
          })
          .catch((e) => setError(`${baseName(path)}: could not identify file (${e})`));
      } catch (e) {
        setError(`${baseName(path)}: ${e}`);
      }
    }
  }

  async function pickPdfs() {
    const picked = await open({
      multiple: true,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
    if (paths.length) await openPaths(paths);
  }

  async function closeTab(id: number) {
    const list = tabsRef.current;
    const index = list.findIndex((t) => t.id === id);
    if (index < 0) return;
    const next = list.filter((t) => t.id !== id);
    tabsRef.current = next;
    setTabs(next);
    viewStates.current.delete(id);
    setActiveId((prev) =>
      prev === id ? (next[Math.min(index, next.length - 1)]?.id ?? null) : prev,
    );
    await invoke("close_pdf", { id });
  }

  const active = tabs.find((t) => t.id === activeId) ?? null;
  const saved = active ? viewStates.current.get(active.id) : undefined;

  return (
    <div className="app">
      <header className="titlebar">
        <span className="name">B.Read</span>
        <button onClick={pickPdfs}>Open PDF…</button>
        {active && (
          <span className="path" title={active.path}>
            {active.path}
          </span>
        )}
      </header>
      {tabs.length > 0 && (
        <nav className="tabs">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={`tab${t.id === activeId ? " active" : ""}`}
              title={t.path}
              onClick={() => setActiveId(t.id)}
              onAuxClick={(e) => {
                if (e.button === 1) closeTab(t.id);
              }}
            >
              <span className="tab-name">{baseName(t.path)}</span>
              <button
                className="tab-close"
                aria-label={`Close ${baseName(t.path)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </nav>
      )}
      <main className="workspace">
        {error && (
          <p style={{ color: "var(--danger)", margin: "0 0 8px" }}>Could not open: {error}</p>
        )}
        {active ? (
          <ContinuousView
            key={active.id}
            docId={active.id}
            pageCount={active.pageCount}
            firstPageSize={active.firstPageSize}
            docKey={active.docKey}
            initialPage={saved?.page ?? 0}
            initialZoom={saved?.zoom ?? 1}
            onViewState={(page, zoom) => viewStates.current.set(active.id, { page, zoom })}
          />
        ) : (
          <p className="empty">Open a PDF to start.</p>
        )}
      </main>
    </div>
  );
}

export default App;