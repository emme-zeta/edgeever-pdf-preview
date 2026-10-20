// EdgeEver plugin: PDF Preview (v0.1.4)
// Anteprima inline dei PDF allegati alle note, via viewer PDF nativo del browser.
// v0.1.4: individua gli allegati dal MARKDOWN della nota (/api/v1/resources/res_.../blob)
// e verifica che siano PDF leggendo il blob — perché context.resources.list() risulta vuoto.

export default {
  activate(context) {
    const disposers = [];
    const notice = (m) => { try { context.ui.showNotice(String(m)); } catch (e) {} };
    const log = (...a) => { try { console.log("[pdf-preview]", ...a); } catch (e) {} };

    function renderBlob(container, blob, height) {
      container.replaceChildren();
      try {
        const url = URL.createObjectURL(blob);
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
      try { const blob = await context.resources.read(resourceId); return renderBlob(container, blob, height); }
      catch (e) { s.textContent = "Impossibile caricare il PDF: " + ((e && e.message) || e); return () => container.replaceChildren(); }
    }

    // Inline embed: render a PDF by resource id.
    try {
      disposers.push(context.editor.embeds.register({
        type: "pdf-preview",
        async mount(container, embed) {
          const data = (embed && embed.data) || {};
          if (!data.resourceId) { container.textContent = "Anteprima PDF: nessun allegato collegato."; return () => {}; }
          const view = document.createElement("div"); container.appendChild(view);
          return await renderById(view, data.resourceId, data.height);
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

    // Extract resource references from note markdown. Returns [{id, name, image}] in order, deduped.
    function refsFromMarkdown(md) {
      const out = []; const seen = new Set();
      const re = /(!?)\[([^\]]*)\]\(\/api\/v1\/resources\/(res_[A-Za-z0-9]+)\/blob\)/g;
      let m;
      while ((m = re.exec(md))) {
        const id = m[3];
        if (seen.has(id)) continue; seen.add(id);
        out.push({ id: id, name: (m[2] || "").trim(), image: m[1] === "!" });
      }
      // also bare occurrences not in markdown-link form
      const re2 = /\/api\/v1\/resources\/(res_[A-Za-z0-9]+)\/blob/g;
      while ((m = re2.exec(md))) { const id = m[1]; if (!seen.has(id)) { seen.add(id); out.push({ id: id, name: "", image: false }); } }
      return out;
    }

    // Find the note's PDFs: prefer non-image refs, confirm each by reading its blob type.
    async function findPdfs() {
      const { noteId, md } = await getActive();
      if (!noteId) { notice("PDF Preview: apri prima una nota."); return { noteId: null, pdfs: [] }; }
      let refs = refsFromMarkdown(md);
      // attachments (non-image) first, then images, so PDFs saved as attachments win
      refs.sort((a, b) => (a.image === b.image) ? 0 : (a.image ? 1 : -1));
      const pdfs = [];
      for (const r of refs) {
        try {
          const blob = await context.resources.read(r.id);
          const type = (blob && blob.type ? blob.type : "").toLowerCase();
          const looksPdf = type.includes("pdf") || (r.name || "").toLowerCase().endsWith(".pdf");
          if (looksPdf || (!type && !r.image)) {
            // treat as PDF if type says so, or if name ends .pdf; if type unknown and it's an attachment, verify magic bytes
            let ok = looksPdf;
            if (!ok && !type) { try { const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer()); ok = String.fromCharCode.apply(null, head).startsWith("%PDF-"); } catch (e) {} }
            if (ok) pdfs.push({ id: r.id, name: r.name || "PDF", blob: blob });
          }
        } catch (e) { log("read probe error", r.id, e); }
      }
      if (!pdfs.length) notice("PDF diag — nota " + String(noteId).slice(-8) + " · riferimenti=" + refs.length + " · pdf=0");
      return { noteId, pdfs };
    }

    async function insertFor(p) {
      await context.editor.insertEmbed({ type: "pdf-preview", data: { resourceId: p.id, name: p.name, height: 600 } });
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

    notice("PDF Preview v0.1.4 attivo");
    log("activated v0.1.4");
    return () => { disposers.forEach((d) => { try { if (d) d(); } catch (e) {} }); };
  }
};
