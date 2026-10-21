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
