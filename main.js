// EdgeEver plugin: PDF Preview (v0.1.2)
// Anteprima inline dei PDF allegati alle note, via viewer PDF nativo del browser.
// v0.1.2: diagnostica allegati + filtro PDF più ampio (mimeType/mime/filename/object_key/url).

export default {
  activate(context) {
    const disposers = [];
    const notice = (m) => { try { context.ui.showNotice(String(m)); } catch (e) {} };
    const log = (...a) => { try { console.log("[pdf-preview]", ...a); } catch (e) {} };

    const asArray = (res) => {
      if (Array.isArray(res)) return res;
      if (!res || typeof res !== "object") return [];
      for (const k of ["resources", "items", "data", "attachments", "list", "results", "rows", "files", "edges"]) {
        if (Array.isArray(res[k])) return res[k];
      }
      // one level deeper (e.g. { data: { resources: [...] } })
      for (const k of Object.keys(res)) {
        const v = res[k];
        if (v && typeof v === "object" && !Array.isArray(v)) {
          for (const k2 of ["resources", "items", "data", "attachments", "list", "results", "rows", "files", "edges"]) {
            if (Array.isArray(v[k2])) return v[k2];
          }
        }
      }
      return [];
    };
    const shapeOf = (res) => Array.isArray(res) ? ("array[" + res.length + "]") : (res && typeof res === "object" ? ("{" + Object.keys(res).slice(0, 8).join(",") + "}") : String(typeof res));
    const mimeOf = (r) => String((r && (r.mimeType || r.mime || r.contentType || r.content_type || r.type)) || "").toLowerCase();
    const nameOf = (r) => String((r && (r.filename || r.fileName || r.name || r.title || r.objectKey || r.object_key || r.url)) || "");
    const isPdf = (r) => mimeOf(r).includes("pdf") || nameOf(r).toLowerCase().endsWith(".pdf");
    const resId = (r) => r && (r.id || r.resourceId || r.resource_id);
    const resName = (r) => nameOf(r) || "PDF";

    async function renderPdf(container, resourceId, height) {
      container.replaceChildren();
      const status = document.createElement("div");
      status.textContent = "Caricamento PDF…";
      status.style.cssText = "padding:8px;font:13px/1.4 system-ui,sans-serif;opacity:.7";
      container.appendChild(status);
      try {
        const blob = await context.resources.read(resourceId);
        const url = URL.createObjectURL(blob);
        const frame = document.createElement("iframe");
        frame.src = url; frame.setAttribute("title", "Anteprima PDF");
        frame.style.cssText = "width:100%;height:" + (height || 600) + "px;border:1px solid var(--edgeever-border,#dcdcdc);border-radius:8px;background:#fff";
        container.replaceChildren(frame);
        return () => { try { URL.revokeObjectURL(url); } catch (e) {} container.replaceChildren(); };
      } catch (e) { log("read error", e); status.textContent = "Impossibile caricare il PDF: " + ((e && e.message) || e); return () => container.replaceChildren(); }
    }

    try {
      disposers.push(context.editor.embeds.register({
        type: "pdf-preview",
        async mount(container, embed) {
          const data = (embed && embed.data) || {};
          if (!data.resourceId) { container.textContent = "Anteprima PDF: nessun allegato collegato."; return () => {}; }
          const view = document.createElement("div"); container.appendChild(view);
          return await renderPdf(view, data.resourceId, data.height);
        }
      }));
    } catch (e) { log("embeds.register failed", e); }

    async function activeNotePdfs() {
      let doc;
      try { doc = await context.editor.getDocument(); } catch (e) { log("getDocument error", e); }
      log("getDocument ->", doc);
      const noteId = doc && (doc.noteId || doc.id || doc.documentId || (doc.note && doc.note.id));
      if (!noteId) { notice("PDF Preview: apri prima una nota (nessun documento attivo)."); return { noteId: null, pdfs: [], all: [] }; }
      let res;
      try { res = await context.resources.list(noteId); } catch (e) { log("resources.list error", e); notice("PDF Preview: errore lettura allegati: " + ((e && e.message) || e)); return { noteId, pdfs: [], all: [] }; }
      const all = asArray(res);
      log("resources raw ->", res, "array ->", all);
      const pdfs = all.filter(isPdf);
      if (!pdfs.length) {
        const sample = all.length ? (" | es: " + resName(all[0]) + " [" + (mimeOf(all[0]) || "?") + "]") : "";
        notice("PDF diag — nota " + String(noteId).slice(-8) + " · allegati=" + all.length + " · res=" + shapeOf(res) + sample);
      }
      return { noteId, pdfs, all };
    }

    async function insertFor(p) {
      await context.editor.insertEmbed({ type: "pdf-preview", data: { resourceId: resId(p), name: resName(p), height: 600 } });
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
          if (!pdfs.length) { view.textContent = "Nessun PDF allegato."; return () => container.replaceChildren(); }
          pdfs.forEach((p, i) => {
            const btn = document.createElement("button"); btn.textContent = resName(p) || ("PDF " + (i + 1));
            btn.style.cssText = "padding:6px 10px;border:1px solid var(--edgeever-border,#ccc);border-radius:6px;cursor:pointer;background:var(--edgeever-surface,#fff);font:13px system-ui,sans-serif";
            btn.onclick = async () => { if (cleanup) { try { cleanup(); } catch (e) {} } cleanup = await renderPdf(view, resId(p), null); if (mode === "insert") { try { await insertFor(p); } catch (e) { notice("PDF Preview: " + ((e && e.message) || e)); } if (requestClose) requestClose(); } };
            bar.appendChild(btn);
          });
          if (mode === "preview") { cleanup = await renderPdf(view, resId(pdfs[0]), null); }
          return () => { if (cleanup) { try { cleanup(); } catch (e) {} } container.replaceChildren(); };
        }
      }));
    } catch (e) { log("panels.register failed", e); }

    try {
      disposers.push(context.commands.register({
        id: "pdf-preview.open", title: "PDF: anteprima rapida",
        async run() { try { const { noteId, pdfs } = await activeNotePdfs(); if (!noteId || !pdfs.length) return; await context.ui.panels.open("pdf-preview.picker", { state: { mode: "preview", pdfs } }); } catch (e) { log("open run error", e); notice("PDF Preview: " + ((e && e.message) || e)); } }
      }));
      disposers.push(context.commands.register({
        id: "pdf-preview.insert", title: "PDF: inserisci anteprima nel testo",
        async run() { try { const { noteId, pdfs } = await activeNotePdfs(); if (!noteId || !pdfs.length) return; if (pdfs.length === 1) { await insertFor(pdfs[0]); } else { await context.ui.panels.open("pdf-preview.picker", { state: { mode: "insert", pdfs } }); } } catch (e) { log("insert run error", e); notice("PDF Preview: " + ((e && e.message) || e)); } }
      }));
    } catch (e) { log("commands.register failed", e); }

    notice("PDF Preview v0.1.3 attivo");
    log("activated v0.1.3");
    return () => { disposers.forEach((d) => { try { if (d) d(); } catch (e) {} }); };
  }
};
