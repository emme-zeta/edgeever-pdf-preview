// EdgeEver plugin: PDF Preview (v0.1.5)
// Anteprima inline dei PDF allegati alle note, via viewer PDF nativo del browser.
// v0.1.4: individua gli allegati dal MARKDOWN della nota (/api/v1/resources/res_.../blob).
// v0.1.5: normalizza qualunque formato restituito da resources.read() in un Blob
//         (resources.read non ritorna sempre un Blob) + embed con resourceId top-level.

export default {
  activate(context) {
    const disposers = [];
    const notice = (m) => { try { context.ui.showNotice(String(m)); } catch (e) {} };
    const log = (...a) => { try { console.log("[pdf-preview]", ...a); } catch (e) {} };

    function b64ToBytes(b64) {
      const bin = atob(String(b64).replace(/\s+/g, ""));
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u;
    }
    function stringToBlob(s, mime) {
      if (s.startsWith("data:")) {
        const i = s.indexOf(","); const meta = s.slice(5, i);
        const m = (meta.split(";")[0] || mime || "application/pdf");
        const body = s.slice(i + 1);
        if (/;base64/i.test(meta)) return new Blob([b64ToBytes(body)], { type: m });
        return new Blob([decodeURIComponent(body)], { type: m });
      }
      if (/^[A-Za-z0-9+/=\r\n]+$/.test(s) && s.length > 64) {
        try { return new Blob([b64ToBytes(s)], { type: mime || "application/pdf" }); } catch (e) {}
      }
      return new Blob([s], { type: mime || "text/plain" });
    }
    // Normalize whatever resources.read() returns into a Blob. defaultMime used only when unknown.
    async function toBlob(res, defaultMime) {
      if (!res) return null;
      if (res instanceof Blob) return res;
      if (res instanceof ArrayBuffer || ArrayBuffer.isView(res)) return new Blob([res], { type: defaultMime || "application/octet-stream" });
      if (typeof res === "string") return stringToBlob(res, defaultMime);
      if (typeof res.arrayBuffer === "function") { // Response-like
        try { const ab = await res.arrayBuffer(); return new Blob([ab], { type: (res.type || defaultMime || "application/octet-stream") }); } catch (e) {}
      }
      const mime = res.mimeType || res.mime || res.type || res.contentType || defaultMime || "application/octet-stream";
      const d = res.blob || res.data || res.bytes || res.buffer || res.content || res.base64 || res.dataUrl || res.body;
      if (d != null) {
        if (d instanceof Blob) return d;
        if (d instanceof ArrayBuffer || ArrayBuffer.isView(d)) return new Blob([d], { type: mime });
        if (typeof d === "string") return stringToBlob(d, mime);
      }
      return null;
    }
    // Read a resource; return { blob, mime } with mime "" when unknown (so detection can fall back to magic bytes).
    async function probeResource(id) {
      const res = await context.resources.read(id);
      let mime = "";
      if (res instanceof Blob) mime = (res.type || "").toLowerCase();
      else if (res && typeof res === "object" && !(res instanceof ArrayBuffer) && !ArrayBuffer.isView(res)) {
        mime = String(res.mimeType || res.mime || res.type || res.contentType || "").toLowerCase();
      }
      const blob = await toBlob(res, mime || "");
      return { blob, mime: mime || (blob && blob.type ? blob.type.toLowerCase() : "") };
    }
    function asPdfBlob(blob) {
      try { return (blob && blob.type === "application/pdf") ? blob : blob.slice(0, blob.size, "application/pdf"); }
      catch (e) { return blob; }
    }

    function renderBlob(container, blob, height) {
      container.replaceChildren();
      try {
        const url = URL.createObjectURL(asPdfBlob(blob));
        const frame = document.createElement("iframe");
        frame.src = url; frame.setAttribute("title", "Anteprima PDF");
        frame.style.cssText = "width:100%;height:" + (height || 600) + "px;border:1px solid var(--edgeever-border,#dcdcdc);border-radius:8px;background:#fff";
        container.replaceChildren(frame);
        return () => { try { URL.revokeObjectURL(url); } catch (e) {} container.replaceChildren(); };
      } catch (e) { container.textContent = "Errore anteprima: " + ((e && e.message) || e); return () => container.replaceChildren(); }
    }
    async function renderById(container, resourceId, height) {
      container.replaceChildren();
      const s = document.createElement("div"); s.textContent = "Caricamento PDF…";
      s.style.cssText = "padding:8px;font:13px/1.4 system-ui,sans-serif;opacity:.7"; container.appendChild(s);
      try { const { blob } = await probeResource(resourceId); if (!blob) throw new Error("risorsa vuota"); return renderBlob(container, blob, height); }
      catch (e) { s.textContent = "Impossibile caricare il PDF: " + ((e && e.message) || e); return () => container.replaceChildren(); }
    }

    // Inline embed: render a PDF by resource id (id may sit top-level or under data).
    try {
      disposers.push(context.editor.embeds.register({
        type: "pdf-preview",
        async mount(container, embed) {
          const e = embed || {}; const data = e.data || {};
          const resourceId = e.resourceId || data.resourceId || e.id;
          if (!resourceId) { container.textContent = "Anteprima PDF: nessun allegato collegato."; return () => {}; }
          const view = document.createElement("div"); container.appendChild(view);
          return await renderById(view, resourceId, data.height || e.height);
        }
      }));
    } catch (e) { log("embeds.register failed", e); }

    async function getActive() {
      let doc;
      try { doc = await context.editor.getDocument(); } catch (e) { log("getDocument error", e); }
      const noteId = doc && (doc.noteId || doc.id || doc.documentId || (doc.note && doc.note.id));
      let md = doc && (doc.markdown || doc.contentMarkdown || doc.content || doc.text);
      if (!md && noteId) {
        try { const n = await context.notes.get(noteId); md = n && (n.contentMarkdown || n.markdown || n.content); }
        catch (e) { log("notes.get error", e); }
      }
      return { noteId, md: md || "" };
    }

    function refsFromMarkdown(md) {
      const out = []; const seen = new Set(); let m;
      const re = /(!?)\[([^\]]*)\]\(\/api\/v1\/resources\/(res_[A-Za-z0-9]+)\/blob\)/g;
      while ((m = re.exec(md))) { const id = m[3]; if (seen.has(id)) continue; seen.add(id); out.push({ id: id, name: (m[2] || "").trim(), image: m[1] === "!" }); }
      const re2 = /\/api\/v1\/resources\/(res_[A-Za-z0-9]+)\/blob/g;
      while ((m = re2.exec(md))) { const id = m[1]; if (!seen.has(id)) { seen.add(id); out.push({ id: id, name: "", image: false }); } }
      return out;
    }

    async function findPdfs() {
      const { noteId, md } = await getActive();
      if (!noteId) { notice("PDF Preview: apri prima una nota."); return { noteId: null, pdfs: [] }; }
      const refs = refsFromMarkdown(md);
      refs.sort((a, b) => (a.image === b.image) ? 0 : (a.image ? 1 : -1));
      const pdfs = [];
      for (const r of refs) {
        try {
          const { blob, mime } = await probeResource(r.id);
          if (!blob) continue;
          let ok = mime.includes("pdf") || (r.name || "").toLowerCase().endsWith(".pdf");
          if (!ok) { try { const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer()); ok = String.fromCharCode.apply(null, head).startsWith("%PDF-"); } catch (e) {} }
          if (ok) pdfs.push({ id: r.id, name: r.name || "PDF", blob: blob });
        } catch (e) { log("read probe error", r.id, e); }
      }
      if (!pdfs.length) notice("PDF diag — nota " + String(noteId).slice(-8) + " · riferimenti=" + refs.length + " · pdf=0");
      return { noteId, pdfs };
    }

    async function insertFor(p) {
      await context.editor.insertEmbed({ type: "pdf-preview", resourceId: p.id, data: { resourceId: p.id, name: p.name, height: 600 } });
      notice("Anteprima PDF inserita nella nota.");
    }

    try {
      disposers.push(context.ui.panels.register({
        id: "pdf-preview.picker", title: "Anteprima PDF", purpose: "preview", presentation: "fullscreen",
        async mount(container, ctx) {
          const state = (ctx && ctx.state) || {}; const mode = state.mode || "preview"; const requestClose = ctx && ctx.requestClose;
          const wrap = document.createElement("div"); wrap.style.cssText = "display:flex;flex-direction:column;gap:8px;height:100%;padding:8px;box-sizing:border-box";
          const bar = document.createElement("div"); bar.style.cssText = "display:flex;flex-wrap:wrap;gap:6px";
          const view = document.createElement("div"); view.style.cssText = "flex:1;min-height:420px";
          wrap.append(bar, view); container.appendChild(wrap);
          let cleanup = null; const pdfs = state.pdfs || [];
          if (!pdfs.length) { view.textContent = "Nessun PDF."; return () => container.replaceChildren(); }
          pdfs.forEach((p, i) => {
            const btn = document.createElement("button"); btn.textContent = p.name || ("PDF " + (i + 1));
            btn.style.cssText = "padding:6px 10px;border:1px solid var(--edgeever-border,#ccc);border-radius:6px;cursor:pointer;background:var(--edgeever-surface,#fff);font:13px system-ui,sans-serif";
            btn.onclick = async () => { if (cleanup) { try { cleanup(); } catch (e) {} } cleanup = p.blob ? renderBlob(view, p.blob, null) : await renderById(view, p.id, null); if (mode === "insert") { try { await insertFor(p); } catch (e) { notice("PDF Preview: " + ((e && e.message) || e)); } if (requestClose) requestClose(); } };
            bar.appendChild(btn);
          });
          if (mode === "preview") { cleanup = pdfs[0].blob ? renderBlob(view, pdfs[0].blob, null) : await renderById(view, pdfs[0].id, null); }
          return () => { if (cleanup) { try { cleanup(); } catch (e) {} } container.replaceChildren(); };
        }
      }));
    } catch (e) { log("panels.register failed", e); }

    try {
      disposers.push(context.commands.register({
        id: "pdf-preview.open", title: "PDF: anteprima rapida",
        async run() { try { const { noteId, pdfs } = await findPdfs(); if (!noteId || !pdfs.length) return; await context.ui.panels.open("pdf-preview.picker", { state: { mode: "preview", pdfs } }); } catch (e) { log("open run error", e); notice("PDF Preview: " + ((e && e.message) || e)); } }
      }));
      disposers.push(context.commands.register({
        id: "pdf-preview.insert", title: "PDF: inserisci anteprima nel testo",
        async run() { try { const { noteId, pdfs } = await findPdfs(); if (!noteId || !pdfs.length) return; if (pdfs.length === 1) { await insertFor(pdfs[0]); } else { await context.ui.panels.open("pdf-preview.picker", { state: { mode: "insert", pdfs } }); } } catch (e) { log("insert run error", e); notice("PDF Preview: " + ((e && e.message) || e)); } }
      }));
    } catch (e) { log("commands.register failed", e); }

    notice("PDF Preview v0.1.5 attivo");
    log("activated v0.1.5");
    return () => { disposers.forEach((d) => { try { if (d) d(); } catch (e) {} }); };
  }
};
