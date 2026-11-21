-- V005: alumnos y sus encargados, ventas por alumno con licencia digital, y correos salientes.
-- Una venta puede incluir útiles de varios alumnos (p. ej. hermanos); cada línea sabe de qué alumno es.

-- ---------- Alumnos ----------
-- Datos mínimos de un menor de edad: nombre, colegio y grado. Nada más.
CREATE TABLE alumno (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombres         VARCHAR(100) NOT NULL,
  apellidos       VARCHAR(100) NOT NULL DEFAULT '',
  colegio_id      BIGINT REFERENCES colegio(id),
  grado_id        BIGINT REFERENCES grado(id),            -- último grado con el que compró
  activo          BOOLEAN NOT NULL DEFAULT true,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por      BIGINT REFERENCES usuario(id)
);
CREATE INDEX ix_alumno_nombre ON alumno (f_norm(nombres || ' ' || apellidos));
CREATE TRIGGER tg_alumno_upd BEFORE UPDATE ON alumno FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();

-- Padre, madre o encargado. Un alumno puede tener varios y un encargado varios alumnos.
CREATE TABLE persona_alumno (
  persona_id  BIGINT NOT NULL REFERENCES persona(id),
  alumno_id   BIGINT NOT NULL REFERENCES alumno(id),
  parentesco  VARCHAR(20) NOT NULL DEFAULT 'ENCARGADO'
              CHECK (parentesco IN ('PADRE', 'MADRE', 'ENCARGADO', 'OTRO')),
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (persona_id, alumno_id)
);
CREATE INDEX ix_persona_alumno_alumno ON persona_alumno (alumno_id);

-- ---------- Alumnos dentro de una venta ----------
CREATE TABLE venta_alumno (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venta_id    BIGINT NOT NULL REFERENCES venta(id),
  alumno_id   BIGINT NOT NULL REFERENCES alumno(id),
  grado_id    BIGINT REFERENCES grado(id),                -- grado al momento de la venta
  combo_id    BIGINT REFERENCES combo(id),
  descuento   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  licencia    VARCHAR(60),                                -- licencia digital del sitio didáctico
  orden       INT NOT NULL DEFAULT 0,
  UNIQUE (venta_id, alumno_id)
);
CREATE INDEX ix_venta_alumno_alumno ON venta_alumno (alumno_id);
CREATE INDEX ix_venta_alumno_licencia ON venta_alumno (upper(licencia)) WHERE licencia IS NOT NULL;

ALTER TABLE venta_detalle ADD COLUMN venta_alumno_id BIGINT REFERENCES venta_alumno(id);
CREATE INDEX ix_vdet_venta_alumno ON venta_detalle (venta_alumno_id);

-- ---------- Correos salientes (bandeja de salida con reintentos) ----------
CREATE TABLE correo_saliente (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venta_id         BIGINT REFERENCES venta(id),
  tipo             VARCHAR(30) NOT NULL DEFAULT 'COMPROBANTE',
  destinatario     VARCHAR(120) NOT NULL,
  estado           VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE'
                   CHECK (estado IN ('PENDIENTE', 'ENVIADO', 'FALLIDO')),
  intentos         INT NOT NULL DEFAULT 0,
  proximo_intento  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_error     VARCHAR(250),
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviado_en       TIMESTAMPTZ,
  creado_por       BIGINT REFERENCES usuario(id)
);
-- El contenido NO se guarda: se arma al enviar desde la venta (no duplica datos personales ni licencias).
CREATE INDEX ix_correo_pendiente ON correo_saliente (proximo_intento) WHERE estado = 'PENDIENTE';
CREATE INDEX ix_correo_venta ON correo_saliente (venta_id);

-- ---------- Datos del emisor para el comprobante ----------
INSERT INTO parametro (clave, valor, descripcion) VALUES
  ('direccion_empresa', '', 'Dirección impresa en el comprobante'),
  ('telefono_empresa',  '', 'Teléfono impreso en el comprobante'),
  ('correo_empresa',    '', 'Correo de contacto impreso en el comprobante'),
  ('sitio_licencias',   '', 'Sitio web donde se usa la licencia digital (se imprime en el comprobante)'),
  ('pie_comprobante',   'Gracias por su compra. Este comprobante no es una factura.',
                        'Texto al pie del comprobante')
ON CONFLICT (clave) DO NOTHING;
