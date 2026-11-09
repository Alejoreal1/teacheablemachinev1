/**
 * Google Apps Script that the user pastes into their Google Sheet
 * (Extensiones → Apps Script) and deploys as a Web App.
 * The /api/registro endpoint POSTs one JSON row to it per detection.
 */
export const APPS_SCRIPT_CODE = `const NOMBRE_HOJA = 'Registros';
const ENCABEZADOS = ['Fecha', 'Estación', 'Clase', 'Confianza', 'Modo', 'Foto'];

function obtenerHoja() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = libro.getSheetByName(NOMBRE_HOJA);
  if (!hoja) hoja = libro.insertSheet(NOMBRE_HOJA);
  if (hoja.getLastRow() === 0) {
    hoja.appendRow(ENCABEZADOS);
    hoja.getRange(1, 1, 1, ENCABEZADOS.length).setFontWeight('bold');
    hoja.setFrozenRows(1);
    hoja.setColumnWidth(6, 140);
  }
  return hoja;
}

function limpiar(valor) {
  const texto = String(valor || '');
  return /^[=+\\-@]/.test(texto) ? "'" + texto : texto;
}

function doPost(e) {
  const datos = JSON.parse(e.postData.contents);
  const hoja = obtenerHoja();
  const foto = /^https:\\/\\//.test(datos.foto || '') ? '=IMAGE("' + datos.foto + '")' : '';
  hoja.appendRow([
    new Date(datos.fecha),
    limpiar(datos.estacion),
    limpiar(datos.clase),
    Number(datos.confianza),
    limpiar(datos.modo),
    foto,
  ]);
  const fila = hoja.getLastRow();
  hoja.getRange(fila, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  hoja.getRange(fila, 4).setNumberFormat('0.0%');
  hoja.setRowHeight(fila, 100);
  return ContentService.createTextOutput(JSON.stringify({ ok: true, fila: fila }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  obtenerHoja();
  return ContentService.createTextOutput(JSON.stringify({ ok: true, mensaje: 'Conectado' }))
    .setMimeType(ContentService.MimeType.JSON);
}
`
