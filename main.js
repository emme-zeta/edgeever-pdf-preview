// EdgeEver plugin: PDF Preview (v0.1.1)
// Anteprima inline dei PDF allegati alle note, via viewer PDF nativo del browser.
// v0.1.1: notifica all'avvio, errori visibili, gestione flessibile delle risposte API.

export default {
  activate(context) {
    const disposers = [];
    const notice = (m) => { try { context.ui.showNotice(String(m)); } catch (e) {} };
    const log = (...a) => { try { console.log("[pdf-preview]", ...a); } catch (e) {} };

    const asArray = (res) => {
      if (Array.isArray(res)) return res;
      if (res && Array.isArray(res.resources)) return res.resources;
      if (res && Array.isArray(res.items)) return res.items;
      if (res && Array.isArray(res.data)) return res.data;
      return [];
    };
    const isPdf = (r) => {
      const ct = String((r && (r.contentType || r.mimeType || r.type)) || "").toLowerCase();
      const nm = String((r && (r.name || r.fileName || r.filename || r.title)) || "").toLowerCase();
      return ct.includes("pdf") || nm.endsWith(".pdf");
    };
    const resId = (r) => r && (r.id || r.resourceId || r.resource_id);
    const resName = (r) => (r && (r.name || r.fileName || r.filename || r.title)) || "PDF";

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
        frame.src = url;
        frame.setAttribute("title", "Anteprima PDF");
        frame.style.cssText =
          "width:100%;height:" + (height || 600) + "px;border:1px solid var(--edgeever-border,#dcdcdc);border-radius:8px;background:#fff";
        container.replaceChildren(frame);
        return () => { try { URL.revokeObjectURL(url); } catch (e) {} container.replaceChildren(); };
      } catch (e) {
        log("read error", e);
        status.textContent = "Impossibile caricare il PDF: " + ((e && e.message) || e);
        return () => container.replaceChildren();
      }
    }

    // Custom block embed: inline PDF preview inside a note.
    try {
      disposers.push(context.editor.embeds.register({
        type: "pdf-preview",
        async mount(container, embed) {
          const data = (embed && embed.data) || {};
          if (!data.resourceId) { container.textContent = "Anteprima PDF: nessun allegato collegato."; return () => {}; }
          const view = document.createElement("div");
          container.appendChild(view);
          return await renderPdf(view, data.resourceId, data.height);
        }
      }));
    } catch (e) { log("embeds.register failed", e); }

    async function activeNotePdfs() {
      let doc;
      try { doc = await context.editor.getDocument(); } catch (e) { log("getDocument error", e); }
      log("getDocument ->", doc);
      const noteId = doc && (doc.noteId || doc.id || doc.documentId || (doc.note && doc.note.id));
      if (!noteId) { notice("PDF Preview: apri prima una nota (nessun documento attivo)."); return { noteId: null, pdfs: [] }; }
      let res;
      try { res = await context.resources.list(noteId); } catch (e) { log("resources.list error", e); notice("PDF Preview: errore lettura allegati: " + ((e && e.message) || e)); return { noteId, pdfs: [] }; }
      const all = asArray(res);
      log("resources ->", all);
      return { noteId, pdfs: all.filter(isPdf) };
    }

    async function insertFor(p) {
      await context.editor.insertEmbed({ type: "pdf-preview", data: { resourceId: resId(p), name: resName(p), height: 600 } });
      notice("Anteprima PDF inserita nella nota.");
    }

    // Picker panel (preview and/or insert).
    try {
      disposers.push(context.ui.panels.register({
        id: "pdf-preview.picker",
        title: "Anteprima PDF",
        purpose: "preview",
        presentation: "fullscreen",
        async mount(container, ctx) {
          const state = (ctx && ctx.state) || {};
          const mode = state.mode || "preview";
          const requestClose = ctx && ctx.requestClose;
          const wrap = document.createElement("div");
          wrap.style.cssText = "display:flex;flex-direction:column;gap:8px;height:100%;padding:8px;box-sizing:border-box";
          const bar = document.createElement("div");
          bar.style.cssText = "display:flex;flex-wrap:wrap;gap:6px";
          const view = document.createElement("div");
          view.style.cssText = "flex:1;min-height:420px";
          wrap.append(bar, view);
          container.appendChild(wrap);
          let cleanup = null;
          const pdfs = state.pdfs || [];
          if (!pdfs.length) { view.textContent = "Nessun PDF allegato."; return () => container.replaceChildren(); }
          pdfs.forEach((p, i) => {
            const btn = document.createElement("button");
            btn.textContent = resName(p) || ("PDF " + (i + 1));
            btn.style.cssText = "padding:6px 10px;border:1px solid var(--edgeever-border,#ccc);border-radius:6px;cursor:pointer;background:var(--edgeever-surface,#fff);font:13px system-ui,sans-serif";
            btn.onclick = async () => {
              if (cleanup) { try { cleanup(); } catch (e) {} }
              cleanup = await renderPdf(view, resId(p), null);
              if (mode === "insert") { try { await insertFor(p); } catch (e) { notice("PDF Preview: " + ((e && e.message) || e)); } if (requestClose) requestClose(); }
            };
            bar.appendChild(btn);
          });
          if (mode === "preview") { cleanup = await renderPdf(view, resId(pdfs[0]), null); }
          return () => { if (cleanup) { try { cleanup(); } catch (e) {} } container.replaceChildren(); };
        }
      }));
    } catch (e) { log("panels.register failed", e); }

    // Commands
    try {
      disposers.push(context.commands.register({
        id: "pdf-preview.open",
        title: "PDF: anteprima rapida",
        async run() {
          try {
            const { noteId, pdfs } = await activeNotePdfs();
            if (!noteId) return;
            if (!pdfs.length) { notice("PDF Preview: nessun PDF allegato a questa nota."); return; }
            await context.ui.panels.open("pdf-preview.picker", { state: { mode: "preview", pdfs } });
          } catch (e) { log("open run error", e); notice("PDF Preview: " + ((e && e.message) || e)); }
        }
      }));
      disposers.push(context.commands.register({
        id: "pdf-preview.insert",
        title: "PDF: inserisci anteprima nel testo",
        async run() {
          try {
            const { noteId, pdfs } = await activeNotePdfs();
            if (!noteId) return;
            if (!pdfs.length) { notice("PDF Preview: nessun PDF allegato a questa nota."); return; }
            if (pdfs.length === 1) { await insertFor(pdfs[0]); }
            else { await context.ui.panels.open("pdf-preview.picker", { state: { mode: "insert", pdfs } }); }
          } catch (e) { log("insert run error", e); notice("PDF Preview: " + ((e && e.message) || e)); }
        }
      }));
    } catch (e) { log("commands.register failed", e); }

    notice("PDF Preview: plugin attivo (comandi: 'PDF: anteprima rapida' / 'PDF: inserisci anteprima')");
    log("activated");

    return () => { disposers.forEach((d) => { try { if (d) d(); } catch (e) {} }); };
  }
};
