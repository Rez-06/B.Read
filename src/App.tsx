import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import ContinuousView from "./ContinuousView";
import "./styles.css";

type OpenDoc = {
  id: number;
  pageCount: number;
  firstPageSize: [number, number];
  path: string;
};

function App() {
  const [doc, setDoc] = useState<OpenDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openPdf() {
    const picked = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (typeof picked !== "string") return;
    try {
      const opened = await invoke<{
        id: number;
        pageCount: number;
        firstPageSize: [number, number];
      }>("open_pdf", { path: picked });
      if (doc) await invoke("close_pdf", { id: doc.id });
      setDoc({ ...opened, path: picked });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="app">
      <header className="titlebar">
        <span className="name">B.Read</span>
        <button onClick={openPdf}>Open PDF…</button>
        {doc && (
          <span className="path" title={doc.path}>
            {doc.path}
          </span>
        )}
      </header>
      <main className="workspace">
        {error && (
          <p style={{ color: "var(--danger)", margin: "0 0 8px" }}>Could not open: {error}</p>
        )}
        {doc ? (
          <ContinuousView
            key={doc.id}
            docId={doc.id}
            pageCount={doc.pageCount}
            firstPageSize={doc.firstPageSize}
          />
        ) : (
          <p className="empty">Open a PDF to start.</p>
        )}
      </main>
    </div>
  );
}

export default App;