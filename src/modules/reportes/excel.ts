import ExcelJS from 'exceljs';
import { Reporte } from './reporte.types';

/** Guatemala es UTC−6 todo el año (sin horario de verano). */
const OFFSET_GT_MS = -6 * 60 * 60 * 1000;

/**
 * Excel guarda fechas "sin zona": se convierte a la hora local de Guatemala
 * para que la celda muestre lo mismo que la pantalla.
 */
const aLocal = (v: unknown) => {
  const d = v instanceof Date ? v : new Date(String(v));
  return new Date(d.getTime() + OFFSET_GT_MS);
};

export async function reporteAExcel(r: Reporte, filtros: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistema de Ventas Intelecto';
  wb.created = new Date();
  const ws = wb.addWorksheet(r.titulo.slice(0, 31));

  ws.addRow([r.titulo]).font = { bold: true, size: 14 };
  ws.addRow([filtros]).font = { italic: true, color: { argb: 'FF666666' } };
  ws.addRow([]);
  const header = ws.addRow(r.columnas.map((c) => c.titulo));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    cell.border = { bottom: { style: 'thin' } };
  });

  for (const f of r.filas)
    ws.addRow(
      r.columnas.map((c) => {
        const v = f[c.clave];
        if (v === null || v === undefined) return null;
        if (c.tipo === 'dinero' || c.tipo === 'entero') return Number(v);
        if (c.tipo === 'fecha' || c.tipo === 'fechaHora') return aLocal(v);
        return String(v);
      }),
    );

  if (Object.keys(r.totales).length) {
    const fila = ws.addRow(
      r.columnas.map((c, i) => (i === 0 ? 'Totales' : (r.totales[c.clave] ?? null))),
    );
    fila.font = { bold: true };
    fila.eachCell((cell, n) => {
      cell.border = { top: { style: 'thin' } };
      const col = r.columnas[n - 1];
      if (col && r.totales[col.clave] !== undefined) cell.value = Number(r.totales[col.clave]);
    });
  }

  r.columnas.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.tipo === 'dinero') col.numFmt = '#,##0.00';
    if (c.tipo === 'fecha') col.numFmt = 'dd/mm/yyyy';
    if (c.tipo === 'fechaHora') col.numFmt = 'dd/mm/yyyy hh:mm';
    const largo = Math.max(
      c.titulo.length,
      ...r.filas.slice(0, 200).map((f) => String(f[c.clave] ?? '').length),
    );
    col.width = Math.min(Math.max(largo + 2, 10), c.clave === 'detalle' ? 80 : 40);
  });
  ws.views = [{ state: 'frozen', ySplit: 4 }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}
