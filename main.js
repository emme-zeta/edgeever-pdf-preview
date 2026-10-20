// EdgeEver plugin: PDF Preview
// Anteprima inline dei PDF allegati alle note, tramite il viewer PDF nativo del browser.
// API EdgeEver v2: resources(read), editor(embeds/insert), commands, panels, notices.

export default {
  activate(context) {
    const disposers = [];
    const isPdf = (r) =>
      ((r && (r.contentType || r.mimeType)) || "").toLowerCase().includes("pdf") ||
      ((r && (r.name || r.fileName)) || "").toLowerCase().endsWith(".pdf");

    // Render a PDF resource into a container using an <iframe> + object URL.
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
          "width:100%;height:" + (height || 600) + "px;border:1px solid var(--edgeever-border,#dcdcdc);" +
          "border-radius:8px;background:#fff";
        container.replaceChildren(frame);
        return () => { try { URL.revokeObjectURL(url); } catch (e) {} container.replaceChildren(); };
      } catch (e) {
        status.textContent = "Impossibile caricare il PDF: " + ((e && e.message) || e);
        return () => container.replaceChildren();
      }
    }

    // 1) Custom block embed: inline PDF preview inside a note.
    disposers.push(context.editor.embeds.register({
      type: "pdf-preview",
      async mount(container, embed) {
        const data = (embed && embed.data) || {};
        if (!data.resourceId) {
          container.textContent = "Anteprima PDF: nessun allegato collegato.";
          return () => {};
        }
        if (data.name) {
          const cap = document.createElement("div");
          cap.textContent = "📄 " + data.name;
          cap.style.cssText = "font:12px/1.4 system-ui,sans-serif;opacity:.7;margin:0 0 4px";
          container.appendChild(cap);
        }
        const view = document.createElement("div");
        container.appendChild(view);
        return await renderPdf(view, data.resourceId, data.height);
      }
    }));

    // Resolve the active note id + its PDF attachments.
    async function activeNotePdfs() {
      const doc = await context.editor.getDocument();
      const noteId = doc && (doc.noteId || doc.id);
      if (!noteId) { context.ui.showNotice("Apri prima una nota."); return { noteId: null, pdfs: [] }; }
      const res = (await context.resources.list(noteId)) || [];
      return { noteId, pdfs: res.filter(isPdf) };
    }

    // Shared picker panel: list PDFs, preview and/or insert inline.
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
        const pdfs = (state.pdfs) || [];
        if (!pdfs.length) { view.textContent = "Nessun PDF allegato a questa nota."; return () => container.replaceChildren(); }
        pdfs.forEach((p, i) => {
          const btn = document.createElement("button");
          btn.textContent = p.name || p.fileName || ("PDF " + (i + 1));
          btn.style.cssText =
            "padding:6px 10px;border:1px solid var(--edgeever-border,#ccc);border-radius:6px;cursor:pointer;" +
            "background:var(--edgeever-surface,#fff);font:13px system-ui,sans-serif";
          btn.onclick = async () => {
            if (cleanup) { try { cleanup(); } catch (e) {} }
            cleanup = await renderPdf(view, p.id, null);
            if (mode === "insert") {
              await context.editor.insertEmbed({ type: "pdf-preview", data: { resourceId: p.id, name: p.name || p.fileName, height: 600 } });
              context.ui.showNotice("Anteprima PDF inserita nella nota.");
              if (requestClose) requestClose();
            }
          };
          bar.appendChild(btn);
        });
        if (mode === "preview") { cleanup = await renderPdf(view, pdfs[0].id, null); }
        return () => { if (cleanup) { try { cleanup(); } catch (e) {} } container.replaceChildren(); };
      }
    }));

    // 2) Command: quick full-screen preview of a note's PDF.
    disposers.push(context.commands.register({
      id: "pdf-preview.open",
      title: "PDF: anteprima rapida",
      async run() {
        const { noteId, pdfs } = await activeNotePdfs();
        if (!noteId) return;
        if (!pdfs.length) { context.ui.showNotice("Nessun PDF allegato a questa nota."); return; }
        await context.ui.panels.open("pdf-preview.picker", { state: { mode: "preview", pdfs } });
      }
    }));

    // 3) Command: insert an inline PDF preview block into the note.
    disposers.push(context.commands.register({
      id: "pdf-preview.insert",
      title: "PDF: inserisci anteprima nel testo",
      async run() {
        const { noteId, pdfs } = await activeNotePdfs();
        if (!noteId) return;
        if (!pdfs.length) { context.ui.showNotice("Nessun PDF allegato a questa nota."); return; }
        if (pdfs.length === 1) {
          await context.editor.insertEmbed({ type: "pdf-preview", data: { resourceId: pdfs[0].id, name: pdfs[0].name || pdfs[0].fileName, height: 600 } });
          context.ui.showNotice("Anteprima PDF inserita nella nota.");
        } else {
          await context.ui.panels.open("pdf-preview.picker", { state: { mode: "insert", pdfs } });
        }
      }
    }));

    return () => { disposers.forEach((d) => { try { if (d) d(); } catch (e) {} }); };
  }
};
