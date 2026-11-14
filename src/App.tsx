import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import PdfPage from "./PdfPage";
import "./App.css";

type OpenDoc = { id: number; pageCount: number; path: string };

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
      const opened = await invoke<{ id: number; pageCount: number }>("open_pdf", { path: picked });
      if (doc) await invoke("close_pdf", { id: doc.id });
      setDoc({ ...opened, path: picked });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <main style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>B.Read</h1>
        <button onClick={openPdf}>Open PDF…</button>
        {doc && <span style={{ opacity: 0.6 }}>{doc.path}</span>}
      </div>
      {error && <p style={{ color: "red" }}>Could not open: {error}</p>}
      {doc ? (
        <PdfPage key={doc.id} docId={doc.id} count={doc.pageCount} />
      ) : (
        <p>Open a PDF to start.</p>
      )}
    </main>
  );
}

export default App;