import {
  bloquesPorAlumno,
  esc,
  estadoDeEntrega,
  plantillaComprobante,
} from './plantilla-comprobante';
import type { DatosEmpresa, VentaCompleta } from '../ventas/consulta-venta';

const empresa: DatosEmpresa = {
  nombre: 'Intelecto',
  nit: '123',
  direccion: null,
  telefono: null,
  correo: null,
  sitioLicencias: 'aula.ejemplo.com',
  pie: 'Gracias',
};
const linea = (id: number, ventaAlumnoId: number | null, titulo: string, estado = 'ENTREGADO') => ({
  id,
  ventaAlumnoId,
  libroId: id,
  titulo,
  isbn: null,
  cantidad: 1,
  cantidadEntregada: estado === 'ENTREGADO' ? 1 : 0,
  precioUnitario: '100.00',
  subtotal: '100.00',
  estado,
  colegioOrigen: null,
  entregadoEn: null,
});
const venta = (extra: Partial<VentaCompleta> = {}): VentaCompleta => ({
  id: 1,
  codigo: 'V-2027-000001',
  colegioId: 1,
  colegio: 'Colegio Norte',
  clienteId: 5,
  cliente: 'Ana López',
  nit: 'CF',
  clienteTelefono: null,
  clienteCorreo: 'ana@example.com',
  alumno: 'Luis López, Sofía López',
  grado: null,
  subtotal: '300.00',
  descuento: '0.00',
  recargo: '0.00',
  total: '300.00',
  estadoPago: 'PAGADA',
  estadoEntrega: 'PARCIAL',
  entregaCompletaEn: null,
  fecha: new Date('2027-01-15T15:00:00Z'),
  usuarioId: 1,
  usuario: 'cajero',
  cajaNumero: 1,
  motivoAnulacion: null,
  alumnos: [
    {
      id: 10,
      alumnoId: 1,
      nombre: 'Luis López',
      gradoId: 1,
      grado: '1ro',
      licencia: 'LIC-001',
      descuento: '0.00',
      comboId: null,
    },
    {
      id: 11,
      alumnoId: 2,
      nombre: 'Sofía López',
      gradoId: 3,
      grado: '3ro',
      licencia: null,
      descuento: '0.00',
      comboId: null,
    },
  ],
  lineas: [
    linea(1, 10, 'Matemática 1'),
    linea(2, 11, 'Lectura 3'),
    linea(3, 11, 'Inglés 3', 'RESERVADO'),
  ],
  pagos: [],
  correos: [],
  ...extra,
});

describe('plantilla de comprobante', () => {
  it('escapa HTML', () => {
    expect(esc('<script>alert("x")</script>&')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;',
    );
  });

  it('agrupa las líneas por alumno, en orden', () => {
    const b = bloquesPorAlumno(venta());
    expect(b.map((x) => x.titulo)).toEqual(['Luis López', 'Sofía López']);
    expect(b[0].lineas.map((l) => l.titulo)).toEqual(['Matemática 1']);
    expect(b[1].lineas).toHaveLength(2);
    expect(b[0].licencia).toBe('LIC-001');
  });

  it('venta antigua sin alumnos registrados: un solo bloque', () => {
    const b = bloquesPorAlumno(
      venta({ alumnos: [], alumno: 'Pedro', grado: '2do', lineas: [linea(1, null, 'X')] }),
    );
    expect(b).toHaveLength(1);
    expect(b[0].titulo).toBe('Pedro');
    expect(b[0].grado).toBe('2do');
  });

  it('el HTML no deja pasar datos maliciosos del cliente', () => {
    const { html, texto, asunto } = plantillaComprobante(
      venta({ cliente: '<img src=x onerror=alert(1)>' }),
      empresa,
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    expect(asunto).toBe('Comprobante V-2027-000001 · Intelecto');
    expect(texto).toContain('Licencia digital: LIC-001 — aula.ejemplo.com');
    expect(html).toContain('pendientes de entrega');
    expect(texto).toContain('Estado: PENDIENTE DE ENTREGA: 1 libro(s)');
  });

  it('estado de entrega', () => {
    expect(estadoDeEntrega(venta()).texto).toBe('PENDIENTE DE ENTREGA: 1 libro(s)');
    const completa = venta({
      estadoEntrega: 'COMPLETA',
      entregaCompletaEn: new Date('2027-01-20T16:00:00Z'),
    });
    expect(estadoDeEntrega(completa)).toEqual({ completo: true, texto: 'ENTREGADO el 20/01/2027' });
    expect(plantillaComprobante(completa, empresa, 'ENTREGA_COMPLETA').asunto).toBe(
      'Entrega completa V-2027-000001 · Intelecto',
    );
    expect(estadoDeEntrega(venta({ estadoPago: 'ANULADA' })).texto).toBe('VENTA ANULADA');
  });
});
