import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import PdfPage from "./PdfPage";
import "./App.css";

function App() {
  const [path, setPath] = useState<string | null>(null);

  async function openPdf() {
    const picked = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (typeof picked === "string") setPath(picked);
  }

  return (
    <main style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>B.Read</h1>
        <button onClick={openPdf}>Open PDF…</button>
        {path && <span style={{ opacity: 0.6 }}>{path}</span>}
      </div>
      {path ? <PdfPage key={path} path={path} /> : <p>Open a PDF to start.</p>}
    </main>
  );
}

export default App;