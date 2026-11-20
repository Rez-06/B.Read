import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import ContinuousView from "./ContinuousView";
import IconButton from "./IconButton";
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
type SavedSession = {
  tabs: { path: string; page: number; zoom: number }[];
  active: string | null;
};

function baseName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tabsRef = useRef<Tab[]>([]);
  const activeRef = useRef<number | null>(null);
  const viewStates = useRef(new Map<number, ViewState>());
  const readyRef = useRef(false); // saving is off until the saved session has been restored
  const restoredRef = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);

  function scheduleSave() {
    if (!readyRef.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const now = tabsRef.current;
      const session: SavedSession = {
        tabs: now.map((t) => ({
          path: t.path,
          page: viewStates.current.get(t.id)?.page ?? 0,
          zoom: viewStates.current.get(t.id)?.zoom ?? 1,
        })),
        active: now.find((t) => t.id === activeRef.current)?.path ?? null,
      };
      invoke("session_save", { value: JSON.stringify(session) }).catch(() => {});
    }, 600);
  }

  function activate(id: number | null) {
    activeRef.current = id;
    setActiveId(id);
    scheduleSave();
  }

  async function openPaths(
    paths: string[],
    opts?: { activate?: boolean; views?: Map<string, ViewState> },
  ) {
    for (const path of paths) {
      const existing = tabsRef.current.find((t) => t.path === path);
      if (existing) {
        if (opts?.activate !== false) activate(existing.id);
        continue;
      }
      try {
        const opened = await invoke<{
          id: number;
          pageCount: number;
          firstPageSize: [number, number];
        }>("open_pdf", { path });
        const tab: Tab = { ...opened, path, docKey: null };
        const view = opts?.views?.get(path);
        if (view) viewStates.current.set(tab.id, view);
        tabsRef.current = [...tabsRef.current, tab];
        setTabs(tabsRef.current);
        if (opts?.activate !== false) activate(tab.id);
        else scheduleSave();

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

  // Restore the previous session once, then open any files the app was launched with.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    (async () => {
      try {
        const raw = await invoke<string | null>("session_load");
        if (raw) {
          const saved = JSON.parse(raw) as SavedSession;
          const views = new Map(
            saved.tabs.map((t) => [t.path, { page: t.page, zoom: t.zoom }] as const),
          );
          await openPaths(
            saved.tabs.map((t) => t.path),
            { activate: false, views },
          );
          const target =
            tabsRef.current.find((t) => t.path === saved.active) ??
            tabsRef.current[tabsRef.current.length - 1];
          if (target) activate(target.id);
        }
      } catch {
        // no saved session, or it couldn't be read: start empty
      }
      try {
        const launched = await invoke<string[]>("take_pending_opens");
        if (launched.length) await openPaths(launched);
      } catch {
        // nothing was passed on the command line
      }
      readyRef.current = true;
      scheduleSave();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Files sent by a second launch of the app (double-click / "Open with" while running).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<string[]>("open-files", (e) => {
      openPaths(e.payload);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickPdfs() {
    setError(null);
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
    const wasActive = activeRef.current === id;
    const next = list.filter((t) => t.id !== id);
    tabsRef.current = next;
    setTabs(next);
    viewStates.current.delete(id);
    if (wasActive) activate(next[Math.min(index, next.length - 1)]?.id ?? null);
    else scheduleSave();
    await invoke("close_pdf", { id });
  }

  const active = tabs.find((t) => t.id === activeId) ?? null;
  const saved = active ? viewStates.current.get(active.id) : undefined;

  return (
    <div className="app">
      <header className="titlebar">
        <span className="name">B.Read</span>
        <IconButton label="Open PDF" wide onClick={pickPdfs}>
          <FolderOpen size={16} strokeWidth={1.75} />
          <span>Open</span>
        </IconButton>
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
              onClick={() => activate(t.id)}
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
            onViewState={(page, zoom) => {
              viewStates.current.set(active.id, { page, zoom });
              scheduleSave();
            }}
          />
        ) : (
          <p className="empty">Open a PDF to start.</p>
        )}
      </main>
    </div>
  );
}

export default App;