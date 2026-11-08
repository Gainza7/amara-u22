/* Amara Lleida U22 · conexión de la app fuera de Claude.
   La app se escribió para el entorno de Claude (window.claude.use("mcp" | "sample" | "db" | "assets")).
   Aquí se da esa misma forma con piezas propias:
     mcp    → Apps Script de la hoja U22 (leer y escribir rangos)
     sample → /api/leer en Vercel (leer fotos de horarios y entrenos con Claude)
     db + assets → fotos de jugadores guardadas por el Apps Script en la pestaña oculta FOTOS APP */
(function () {
  const CFG = window.U22_CONFIG || {};
  const TOKEN_KEY = "u22-token";
  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } };

  function fail(code, message) { const e = new Error(message || code); e.code = code; return e; }

  async function script(body) {
    if (!CFG.scriptUrl) throw fail("server_not_connected", "Falta la dirección del Apps Script en config.js");
    let r;
    try {
      // text/plain evita la petición previa de CORS, que Apps Script no contesta.
      r = await fetch(CFG.scriptUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ token: getToken() }, body)) });
    } catch (e) { throw fail("server_unavailable"); }
    let j;
    try { j = await r.json(); } catch (e) { throw fail("server_unavailable"); }
    if (j.error === "bad_token") { askToken("La clave no es correcta. Escríbela otra vez."); throw fail("needs_reauth"); }
    if (j.error) throw fail(j.error === "tool_error" ? "tool_error" : "server_unavailable", j.message || j.error);
    return j;
  }

  const mcp = {
    async callTool(server, tool, args) {
      if (tool === "get_values") { const j = await script({ op: "get_values", range: args.range }); return { payload: { values: j.values || [] } }; }
      if (tool === "update_values") { await script({ op: "update_values", range: args.range, values: args.values }); return { payload: { ok: true } }; }
      if (tool === "refresh_matches") { const j = await script({ op: "refresh_matches" }); return { payload: j }; }
      throw fail("not_in_manifest", tool);
    },
  };

  async function readerOn() {
    try { const r = await fetch(CFG.readerUrl || "/api/leer"); if (!r.ok) return false; const j = await r.json(); return !!j.ok; } catch (e) { return false; }
  }
  async function blobToDataUrl(b) {
    if (typeof b === "string") return b;
    return await new Promise((ok, ko) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = ko; fr.readAsDataURL(b); });
  }
  function makeSample() {
    const f = async () => { throw fail("not_granted"); };
    f.limits = async () => ({ images: true });
    f.json = async (prompt, opts) => {
      const images = [];
      for (const im of (opts && opts.images) || []) images.push(await blobToDataUrl(im));
      let r;
      try { r = await fetch(CFG.readerUrl || "/api/leer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: getToken(), prompt, images }) }); }
      catch (e) { throw fail("server_unavailable"); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw fail(j.error === "invalid_json" ? "invalid_json" : j.error === "image_rejected" ? "image_rejected" : (j.error || "error"));
      return j.data;
    };
    return f;
  }

  /* Fotos: se reducen a 200 px para que quepan en una celda de la hoja. */
  async function smallJpeg(blob) {
    const img = await createImageBitmap(blob);
    const c = document.createElement("canvas"); c.width = c.height = 200;
    c.getContext("2d").drawImage(img, 0, 0, 200, 200);
    for (const q of [0.8, 0.65, 0.5]) { const u = c.toDataURL("image/jpeg", q); if (u.length < 45000) return u; }
    return c.toDataURL("image/jpeg", 0.4);
  }
  const assets = { async upload(blob) { return { id: await smallJpeg(blob) }; } };
  const db = {
    collection() {
      return {
        onSnapshot(cb, onErr) {
          script({ op: "get_photos" }).then((j) => cb({ docs: (j.photos || []).map((p) => ({ id: p.id, data: () => ({ name: p.name, photo: p.photo }) })) })).catch((e) => onErr && onErr(e));
          return () => {};
        },
        doc(id) { return { async set(o) { await script({ op: "set_photo", id, name: o.name, photo: o.photo }); } }; },
      };
    },
  };

  function askToken(msg) {
    if (document.getElementById("u22-token-box")) return;
    const box = document.createElement("div");
    box.id = "u22-token-box";
    box.innerHTML = `<div class="tk-card"><img src="icons/icon-192.png" alt="" width="72" height="72"><h2>Amara Lleida U22</h2>
      <p>${msg || "Escribe la clave de la app. Es la misma que pusiste como TOKEN en el Apps Script de la hoja."}</p>
      <input type="password" id="u22-token-in" autocomplete="current-password" placeholder="Clave">
      <button type="button" id="u22-token-ok">Entrar</button></div>`;
    document.body.appendChild(box);
    const go = () => { const v = document.getElementById("u22-token-in").value.trim(); if (!v) return; try { localStorage.setItem(TOKEN_KEY, v); } catch (e) {} location.reload(); };
    document.getElementById("u22-token-ok").onclick = go;
    document.getElementById("u22-token-in").onkeydown = (e) => { if (e.key === "Enter") go(); };
  }

  let reader = null;
  window.claude = {
    async use(name) {
      if (!getToken()) { if (name === "mcp") { if (document.body) askToken(); else addEventListener("DOMContentLoaded", () => askToken()); } return null; }
      if (name === "mcp") return mcp;
      if (name === "db") return db;
      if (name === "assets") return assets;
      if (name === "sample") { if (reader === null) reader = readerOn(); return (await reader) ? makeSample() : null; }
      return null;
    },
  };

  if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
})();
