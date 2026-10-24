/**
 * Amara Lleida U22 · puente entre la app y la hoja U22.
 *
 * Se pega en la hoja U22 › Extensiones › Apps Script, y se implementa como
 * "Aplicación web" (Ejecutar como: yo · Quién tiene acceso: cualquier usuario).
 * En Configuración del proyecto › Propiedades del script, añade TOKEN con una
 * clave larga que solo sepas tú; la app te la pide la primera vez.
 *
 * Reglas que protege este script (las mismas que la app dentro de Claude):
 *  - RPE es un IMPORTRANGE de la hoja antigua y 'RPE App' es una fórmula: nunca se escriben.
 *  - En 'ENTRENOS DATOS', E:G son ARRAYFORMULA: nunca se escriben.
 *
 * Minutos de partido (Liga U22): el script lee las fichas de gigantes.com una vez al día y
 * los apunta en MINUTOS PARTIDO (una fila por jugador y partido) y PARTIDOS U22 (la lista de
 * partidos del Amara). Para ponerlo en marcha, ejecuta una vez instalarDisparador() desde el editor.
 */

const NO_ESCRIBIR = ['RPE', 'RPE APP'];
const FOTOS = 'FOTOS APP';

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ error: 'bad_request' }); }
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || req.token !== token) return out_({ error: 'bad_token' });
  try {
    if (req.op === 'get_values') return out_({ values: leer_(req.range) });
    if (req.op === 'update_values') { escribir_(req.range, req.values); return out_({ ok: true }); }
    if (req.op === 'get_photos') return out_({ photos: fotos_() });
    if (req.op === 'set_photo') { guardarFoto_(req.id, req.name, req.photo); return out_({ ok: true }); }
    if (req.op === 'refresh_matches') return out_(actualizarPartidos());
    return out_({ error: 'bad_op' });
  } catch (err) {
    return out_({ error: 'tool_error', message: String(err && err.message || err) });
  }
}

function doGet() { return out_({ ok: true, app: 'Amara Lleida U22' }); }

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function rango_(a1) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const m = String(a1).match(/^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/);
  if (!m) throw new Error('Rango sin pestaña: ' + a1);
  const nombre = (m[1] || m[2]).replace(/''/g, "'");
  const sh = ss.getSheetByName(nombre);
  if (!sh) throw new Error('No existe la pestaña ' + nombre);
  return { sh: sh, nombre: nombre, r: sh.getRange(m[3]) };
}

/* Igual que la API de Google Sheets: valores como se ven, sin filas ni celdas vacías al final. */
function leer_(a1) {
  const x = rango_(a1);
  const last = x.sh.getLastRow();
  if (x.r.getRow() > last) return [];
  const filas = Math.min(x.r.getNumRows(), last - x.r.getRow() + 1);
  const v = x.sh.getRange(x.r.getRow(), x.r.getColumn(), filas, x.r.getNumColumns()).getDisplayValues();
  const res = v.map(function (row) {
    let n = row.length;
    while (n > 0 && row[n - 1] === '') n--;
    return row.slice(0, n);
  });
  while (res.length && !res[res.length - 1].length) res.pop();
  return res;
}

function escribir_(a1, values) {
  const x = rango_(a1);
  const up = x.nombre.toUpperCase();
  if (NO_ESCRIBIR.indexOf(up) >= 0) throw new Error('La pestaña ' + x.nombre + ' no se escribe desde la app');
  if (!Array.isArray(values) || !values.length) throw new Error('Sin valores');
  const cols = Math.max.apply(null, values.map(function (r) { return r.length; }));
  const c0 = x.r.getColumn();
  if (up === 'ENTRENOS DATOS' && c0 <= 7 && c0 + cols - 1 >= 5) throw new Error('E:G de ENTRENOS DATOS son fórmulas');
  const rows = values.map(function (r) { const o = r.slice(); while (o.length < cols) o.push(''); return o; });
  x.sh.getRange(x.r.getRow(), c0, rows.length, cols).setValues(rows);
}

function hojaFotos_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(FOTOS);
  if (!sh) { sh = ss.insertSheet(FOTOS); sh.getRange(1, 1, 1, 3).setValues([['ID', 'JUGADOR', 'FOTO']]); sh.hideSheet(); }
  return sh;
}

function fotos_() {
  const v = hojaFotos_().getDataRange().getValues().slice(1);
  return v.filter(function (r) { return r[0] && r[2]; }).map(function (r) { return { id: r[0], name: r[1], photo: r[2] }; });
}

function guardarFoto_(id, name, photo) {
  if (!id || !/^data:image\/jpeg;base64,/.test(photo || '') || photo.length > 49000) throw new Error('Foto no válida');
  const sh = hojaFotos_();
  const ids = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues().map(function (r) { return r[0]; });
  const i = ids.indexOf(id);
  const fila = i >= 0 ? i + 1 : sh.getLastRow() + 1;
  sh.getRange(fila, 1, 1, 3).setValues([[id, name || '', photo]]);
}

/* ---------- Minutos de partido de la Liga U22 (gigantes.com) ----------
   Gigantes publica cada partido en /estadisticas/liga-u22/<lo-que-sea>/feb-<id>/, con el mismo id que la FEB.
   No hay calendario por equipo, así que una vez por semana se recorre un tramo de ids (ID_DESDE..ID_HASTA,
   propiedades del script) y se guardan los del Amara en PARTIDOS U22. Cada día se leen los ya jugados
   que aún no tienen minutos. Un id escrito a mano en la columna A de PARTIDOS U22 también se lee. */

const PARTIDOS = 'PARTIDOS U22';
const MINUTOS = 'MINUTOS PARTIDO';
const GIGANTES = 'https://www.gigantes.com/estadisticas/liga-u22/amara-lleida/feb-';
const EQUIPO_RE = /LLEIDA/i;
/* Apellido en la ficha (A. POU BLINNIKOV → POU) → nombre en la app. */
const APP_JUGADOR = { POU: 'Alexis', TORRENS: 'Pau', PALLAS: 'Bru', MARTENSON: 'Kaspar', SOW: 'Baba', FERNANDEZ: 'Roger' };
/* Apellidos de la plantilla, para saber cuál de las dos tablas de la ficha es la del Amara. */
const PLANTILLA = ['POU', 'TORRENS', 'PALLAS', 'MARTENSON', 'SOW', 'FERNANDEZ', 'MESTRE', 'IBARS', 'GALATANU', 'ROS', 'MARTOS', 'MONTULL', 'GUSTRAN', 'MARVA'];

function instalarDisparador() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'actualizarPartidos') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('actualizarPartidos').timeBased().everyDays(1).atHour(9).create();
  return actualizarPartidos();
}

function actualizarPartidos() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok: true, busy: true };
  try {
    const props = PropertiesService.getScriptProperties();
    const idx = leerPartidos_();
    let nuevos = 0;
    const ultima = Number(props.getProperty('PARTIDOS_BUSQUEDA') || 0);
    if (!idx.length || Date.now() - ultima > 7 * 864e5) {
      nuevos = buscarPartidos_(idx, props);
      props.setProperty('PARTIDOS_BUSQUEDA', String(Date.now()));
    }
    const hoy = new Date();
    const pend = idx.filter(function (p) {
      return p.estado !== 'jugado' && (!p.fecha || p.fecha <= hoy) && (!p.fecha || hoy - p.fecha < 15 * 864e5);
    });
    let leidos = 0;
    const filas = {};
    trozos_(pend, 10).forEach(function (grupo) {
      const res = UrlFetchApp.fetchAll(grupo.map(function (p) { return { url: GIGANTES + p.id + '/', muteHttpExceptions: true }; }));
      res.forEach(function (r, i) {
        const p = grupo[i];
        p.leido = new Date();
        if (r.getResponseCode() !== 200) { p.estado = 'sin ficha'; return; }
        const f = leerFicha_(r.getContentText());
        Object.assign(p, f.info);
        if (f.jugadores.length) { p.estado = 'jugado'; filas[p.id] = f.jugadores; leidos++; }
        else p.estado = f.info.fecha && f.info.fecha > hoy ? 'pendiente' : 'sin minutos';
      });
      Utilities.sleep(300);
    });
    guardarPartidos_(idx);
    if (leidos) guardarMinutos_(idx, filas);
    return { ok: true, partidos: idx.length, nuevos: nuevos, leidos: leidos };
  } finally { lock.releaseLock(); }
}

function trozos_(a, n) { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

function hoja_(nombre, cab) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(nombre);
  if (!sh) { sh = ss.insertSheet(nombre); sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}

const CAB_PARTIDOS = ['ID FEB', 'Fecha', 'Jornada', 'Local', 'Visitante', 'Resultado', 'Estado', 'Leído', 'Ficha'];
function leerPartidos_() {
  const sh = hoja_(PARTIDOS, CAB_PARTIDOS);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues().filter(function (r) { return /^\d{6,9}$/.test(String(r[0]).trim()); }).map(function (r) {
    return { id: String(r[0]).trim(), fecha: r[1] instanceof Date ? r[1] : null, jornada: r[2], local: r[3], visitante: r[4], resultado: r[5], estado: r[6], leido: r[7] };
  });
}

function guardarPartidos_(idx) {
  const sh = hoja_(PARTIDOS, CAB_PARTIDOS);
  idx.sort(function (a, b) { return (a.fecha || 0) - (b.fecha || 0) || a.id - b.id; });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, CAB_PARTIDOS.length).clearContent();
  if (!idx.length) return;
  sh.getRange(2, 1, idx.length, CAB_PARTIDOS.length).setValues(idx.map(function (p) {
    return [p.id, p.fecha || '', p.jornada || '', p.local || '', p.visitante || '', p.resultado ? "'" + p.resultado : '', p.estado || '', p.leido || '', GIGANTES + p.id + '/'];
  }));
  sh.getRange(2, 2, idx.length, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(2, 8, idx.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');
}

/* Recorre ID_DESDE..ID_HASTA y añade los partidos del Amara que falten. Si aparece uno cerca del final, amplía el tramo. */
function buscarPartidos_(idx, props) {
  const desde = Number(props.getProperty('ID_DESDE') || 2538880);
  const hasta = Number(props.getProperty('ID_HASTA') || 2539080);
  const ya = {}; idx.forEach(function (p) { ya[p.id] = true; });
  const ids = []; for (let i = desde; i <= hasta; i++) if (!ya[i]) ids.push(String(i));
  let nuevos = 0, max = 0;
  trozos_(ids, 20).forEach(function (grupo) {
    const res = UrlFetchApp.fetchAll(grupo.map(function (id) { return { url: GIGANTES + id + '/', muteHttpExceptions: true }; }));
    res.forEach(function (r, i) {
      if (r.getResponseCode() !== 200) return;
      const html = r.getContentText();
      const t = titulo_(html);
      if (!/liga u22/i.test(t.texto)) return;
      max = Math.max(max, Number(grupo[i]));
      if (!EQUIPO_RE.test(t.local + ' ' + t.visitante)) return;
      const info = leerFicha_(html).info;
      idx.push(Object.assign({ id: grupo[i], estado: '' }, info));
      nuevos++;
    });
    Utilities.sleep(500);
  });
  if (max > hasta - 40) props.setProperty('ID_HASTA', String(max + 150));
  return nuevos;
}

function texto_(h) {
  return String(h).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); }).replace(/\s+/g, ' ').trim();
}
function sinAcentos_(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase(); }

/* <title>LOCAL – VISITANTE: resultado y estadísticas | Liga U22 2026-27</title> */
function titulo_(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const texto = m ? texto_(m[1]) : '';
  const eq = texto.split(':')[0].split(/\s+[–—-]\s+/);
  return { texto: texto, local: (eq[0] || '').trim(), visitante: (eq[1] || '').trim() };
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function leerFicha_(html) {
  const t = titulo_(html);
  const cuerpo = html.replace(/^[\s\S]*?<body[^>]*>/i, '');
  const txt = texto_(cuerpo.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' '));
  const info = { local: t.local, visitante: t.visitante };
  let m = txt.match(/Jornada\s*(\d{1,2})/i);
  if (m) info.jornada = Number(m[1]);
  m = txt.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (m) info.fecha = new Date(+m[3], +m[2] - 1, +m[1]);
  else {
    m = txt.match(new RegExp('\\b(\\d{1,2}) de (' + MESES.join('|') + ') de (20\\d{2})', 'i'));
    if (m) info.fecha = new Date(+m[3], MESES.indexOf(m[2].toLowerCase()), +m[1]);
  }

  /* Tablas de jugadores: filas con un nombre "X. APELLIDO" y unos minutos mm:ss. */
  const tablas = [];
  const reT = /<table[\s\S]*?<\/table>/gi;
  let mt, fin = 0;
  while ((mt = reT.exec(cuerpo))) {
    const antes = texto_(cuerpo.slice(fin, mt.index)).slice(-400);
    fin = mt.index + mt[0].length;
    const filas = (mt[0].match(/<tr[\s\S]*?<\/tr>/gi) || []).map(function (tr) {
      return (tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) || []).map(texto_);
    });
    const cab = filas.filter(function (f) { return f.indexOf('MIN') >= 0; })[0] || [];
    const iPts = cab.indexOf('PTS');
    const jug = [];
    let pts = 0;
    filas.forEach(function (f) {
      const min = f.filter(function (c) { return /^\d{1,2}:\d{2}$/.test(c); })[0];
      const nombre = f.filter(function (c) { return /^[A-ZÀ-Ý]{1,3}\.\s*[A-ZÀ-Ý'][A-ZÀ-Ýa-zà-ÿ' -]+$/.test(c); })[0];
      if (!min || !nombre) return;
      const p = min.split(':');
      jug.push({ nombre: nombre, min: Math.round((+p[0] + p[1] / 60) * 100) / 100, texto: min, dorsal: /^\d{1,2}$/.test(f[0]) ? f[0] : '' });
      if (iPts >= 0 && f.length === cab.length) pts += Number(f[iPts]) || 0;
    });
    if (jug.length >= 5) tablas.push({ antes: sinAcentos_(antes), jug: jug, pts: pts });
  }
  /* La del Amara: la que tiene más apellidos de la plantilla; si empatan, la que lleva LLEIDA justo antes; si no, por orden local/visitante. */
  const amaraLocal = EQUIPO_RE.test(t.local);
  tablas.forEach(function (tb, i) {
    tb.score = tb.jug.filter(function (j) { return PLANTILLA.indexOf(apellido_(j.nombre)) >= 0; }).length * 10
      + (EQUIPO_RE.test(tb.antes) ? 3 : 0) + ((i === 0) === amaraLocal ? 1 : 0);
  });
  const orden = tablas.slice().sort(function (a, b) { return b.score - a.score; });
  const nuestra = orden[0];
  const rival = orden[1];
  if (nuestra && rival && nuestra.pts && rival.pts) info.resultado = nuestra.pts + '-' + rival.pts;
  return { info: info, jugadores: nuestra ? nuestra.jug : [] };
}

function apellido_(nombre) { return sinAcentos_(nombre).replace(/^[A-Z]{1,3}\.\s*/, '').split(/\s+/)[0]; }

const CAB_MINUTOS = ['Fecha', 'Jornada', 'Rival', 'Casa/Fuera', 'Resultado', 'Dorsal', 'Jugador (ficha)', 'Jugador app', 'Minutos', 'MIN', 'ID FEB'];
function guardarMinutos_(idx, nuevas) {
  const sh = hoja_(MINUTOS, CAB_MINUTOS);
  const n = CAB_MINUTOS.length;
  let filas = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, n).getValues() : [];
  filas = filas.filter(function (r) { return r[10] !== '' && !nuevas[String(r[10])]; });
  idx.forEach(function (p) {
    const js = nuevas[p.id];
    if (!js) return;
    const casa = EQUIPO_RE.test(p.local);
    js.forEach(function (j) {
      filas.push([p.fecha || '', p.jornada || '', casa ? p.visitante : p.local, casa ? 'Casa' : 'Fuera', p.resultado ? "'" + p.resultado : '',
        j.dorsal, j.nombre, APP_JUGADOR[apellido_(j.nombre)] || '', j.min, "'" + j.texto, p.id]);
    });
  });
  filas.sort(function (a, b) { return (b[0] || 0) - (a[0] || 0) || b[8] - a[8]; });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, n).clearContent();
  if (!filas.length) return;
  sh.getRange(2, 1, filas.length, n).setValues(filas);
  sh.getRange(2, 1, filas.length, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(2, 9, filas.length, 1).setNumberFormat('0.00');
}
