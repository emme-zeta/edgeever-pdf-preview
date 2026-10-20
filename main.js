// EdgeEver plugin: PDF Preview (v0.1.6)
// Anteprima inline dei PDF allegati alle note, via viewer PDF nativo del browser.
//
// Perché via URL e non blob: context.resources.read() restituisce un Blob valido, ma
// alcuni browser (Safari in testa) NON renderizzano un <iframe src="blob:...pdf"> inline
// e mostrano solo una card "Apri". L'endpoint /api/v1/resources/<id>/blob serve il PDF
// con Content-Type application/pdf e Content-Disposition: inline, same-origin, autenticato
// dal cookie di sessione → un <iframe> verso quell'URL renderizza inline ovunque.
//
// Rilevamento allegati: id risorsa dal markdown della nota + metadati (mime/filename/url)
// da resources.list(); fallback a lettura byte (magic %PDF-) per risorse non elencate.

export default {
  activate(context) {
    const disposers = [];
    const notice = (m) => { try { context.ui.showNotice(String(m)); } catch (e) {} };
    const log = (...a) => { try { console.log("[pdf-preview]", ...a); } catch (e) {} };

    function originBase() { try { return (typeof location !== "undefined" && location.origin) ? location.origin : ""; } catch (e) { return ""; } }
    function absUrl(u) { if (!u) return u; if (/^https?:/i.test(u)) return u; const b = originBase(); return b ? (b + (u.charAt(0) === "/" ? "" : "/") + u) : u; }
    function resourceUrl(id) { return absUrl("/api/v1/resources/" + id + "/blob"); }

    function renderUrl(container, url, name, height) {
      container.replaceChildren();
      const bar = document.createElement("div");
      bar.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px";
      const label = document.createElement("span");
      label.textContent = name || ""; label.style.cssText = "font:12px system-ui,sans-serif;color:var(--edgeever-text-muted,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.textContent = "Apri in una nuova scheda ↗";
      a.style.cssText = "font:12px system-ui,sans-serif;color:var(--edgeever-accent,#5b5bd6);text-decoration:none;flex:none";
      bar.append(label, a);
      const frame = document.createElement("iframe");
      frame.src = url; frame.setAttribute("title", "Anteprima PDF " + (name || ""));
      frame.style.cssText = "width:100%;height:" + (height || 600) + "px;border:1px solid var(--edgeever-border,#dcdcdc);border-radius:8px;background:#fff";
      container.append(bar, frame);
      return () => container.replaceChildren();
    }

    // --- byte fallback for resources not returned by list() ---
    function b64ToBytes(b64) { const bin = atob(String(b64).replace(/\s+/g, "")); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    async function readBlob(id) {
      const res = await context.resources.read(id);
      if (!res) return null;
      if (res instanceof Blob) return res;
      if (res instanceof ArrayBuffer || ArrayBuffer.isView(res)) return new Blob([res]);
      if (typeof res === "string") { try { return new Blob([b64ToBytes(res)]); } catch (e) { return new Blob([res]); } }
      if (typeof res.arrayBuffer === "function") { try { return new Blob([await res.arrayBuffer()]); } catch (e) {} }
      const d = res.blob || res.data || res.bytes || res.buffer || res.content || res.base64 || res.body;
      if (d instanceof Blob) return d;
      if (d instanceof ArrayBuffer || ArrayBuffer.isView(d)) return new Blob([d]);
      if (typeof d === "string") { try { return new Blob([b64ToBytes(d)]); } catch (e) { return new Blob([d]); } }
      return null;
    }
    async function looksLikePdfBytes(id) {
      try { const b = await readBlob(id); if (!b) return false; const h = new Uint8Array(await b.slice(0, 5).arrayBuffer()); return String.fromCharCode.apply(null, h).startsWith("%PDF-"); }
      catch (e) { return false; }
    }

    // Inline embed: render a PDF by resource id (top-level or nested).
    try {
      disposers.push(context.editor.embeds.register({
        type: "pdf-preview",
        async mount(container, embed) {
          const e = embed || {}; const data = e.data || {};
          const resourceId = e.resourceId || data.resourceId || e.id;
          if (!resourceId) { container.textContent = "Anteprima PDF: nessun allegato collegato."; return () => {}; }
          const view = document.createElement("div"); container.appendChild(view);
          return renderUrl(view, resourceUrl(resourceId), e.title || data.name || "", data.height || e.height);
        }
      }));
    } catch (e) { log("embeds.register failed", e); }

    async function getActive() {
      let doc;
      try { doc = await context.editor.getDocument(); } catch (e) { log("getDocument error", e); }
      const noteId = doc && (doc.noteId || doc.id || doc.documentId || (doc.note && doc.note.id));
      let md = doc && (doc.contentMarkdown || doc.markdown || doc.content || doc.text);
      if (!md && noteId) { try { const n = await context.notes.get(noteId); md = n && (n.contentMarkdown || n.markdown || n.content); } catch (e) { log("notes.get error", e); } }
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

    async function loadResourceMap(noteId) {
      let arr = [];
      try { arr = await context.resources.list(noteId); } catch (e) { log("list(noteId) error", e); }
      if (!arr || !arr.length) { try { arr = await context.resources.list(); } catch (e) { log("list() error", e); } }
      const map = new Map(); for (const r of (arr || [])) map.set(r.id, r); return map;
    }
    function isPdfResource(r, name) {
      const mt = String((r && r.mimeType) || "").toLowerCase();
      const fn = String((r && r.filename) || name || "").toLowerCase();
      return mt.indexOf("pdf") >= 0 || fn.endsWith(".pdf");
    }

    async function findPdfs() {
      const { noteId, md } = await getActive();
      if (!noteId) { notice("PDF Preview: apri prima una nota."); return { noteId: null, pdfs: [] }; }
      const refs = refsFromMarkdown(md);
      refs.sort((a, b) => (a.image === b.image) ? 0 : (a.image ? 1 : -1));
      const map = await loadResourceMap(noteId);
      const pdfs = [];
      for (const r of refs) {
        const res = map.get(r.id);
        let ok = false, name = r.name || "", url = null;
        if (res) { ok = isPdfResource(res, r.name); name = res.filename || r.name || "PDF"; url = absUrl(res.url) || resourceUrl(r.id); }
        else { // not in list(): try filename hint, then byte probe
          if ((r.name || "").toLowerCase().endsWith(".pdf")) ok = true;
          else if (!r.image) ok = await looksLikePdfBytes(r.id);
          url = resourceUrl(r.id);
        }
        if (ok) pdfs.push({ id: r.id, name: name || "PDF", url: url || resourceUrl(r.id) });
      }
      if (!pdfs.length) notice("PDF diag — nota " + String(noteId).slice(-8) + " · rif=" + refs.length + " · ris=" + map.size + " · pdf=0");
      return { noteId, pdfs };
    }

    async function insertFor(p) {
      await context.editor.insertEmbed({ type: "pdf-preview", resourceId: p.id, title: p.name, data: { name: p.name, height: 600 } });
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
          const show = (p) => { if (cleanup) { try { cleanup(); } catch (e) {} } cleanup = renderUrl(view, p.url, p.name, null); };
          pdfs.forEach((p, i) => {
            const btn = document.createElement("button"); btn.textContent = p.name || ("PDF " + (i + 1));
            btn.style.cssText = "padding:6px 10px;border:1px solid var(--edgeever-border,#ccc);border-radius:6px;cursor:pointer;background:var(--edgeever-surface,#fff);font:13px system-ui,sans-serif;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
            btn.onclick = async () => { show(p); if (mode === "insert") { try { await insertFor(p); } catch (e) { notice("PDF Preview: " + ((e && e.message) || e)); } if (requestClose) requestClose(); } };
            bar.appendChild(btn);
          });
          if (mode === "preview") show(pdfs[0]);
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

    notice("PDF Preview v0.1.6 attivo");
    log("activated v0.1.6");
    return () => { disposers.forEach((d) => { try { if (d) d(); } catch (e) {} }); };
  }
};
