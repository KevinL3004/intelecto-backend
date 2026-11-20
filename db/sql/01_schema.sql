-- =====================================================================
-- Sistema de Ventas Intelecto (SVI) - Esquema v1.0
-- PostgreSQL 16. Montos NUMERIC(12,2). Fechas TIMESTAMPTZ (UTC).
-- Incluye estructura preparada para fase 2 (portal, pagos en línea, FEL).
-- =====================================================================
SET client_encoding = 'UTF8';
SET timezone = 'UTC';

-- ---------- Tipos ----------
CREATE TYPE rol_usuario        AS ENUM ('ADMIN','CONTADOR','CAJERO');
CREATE TYPE tipo_denominacion  AS ENUM ('BILLETE','MONEDA');
CREATE TYPE estado_turno       AS ENUM ('ABIERTO','EN_CIERRE','CERRADO','VALIDADO','OBSERVADO');
CREATE TYPE momento_conteo     AS ENUM ('APERTURA','CIERRE');
CREATE TYPE tipo_mov_caja      AS ENUM ('RETIRO','INGRESO','REEMBOLSO');
CREATE TYPE canal_venta        AS ENUM ('PRESENCIAL','PORTAL');
CREATE TYPE estado_pago_venta  AS ENUM ('PENDIENTE_PAGO','PENDIENTE_VALIDACION','PAGADA','ANULADA','RECHAZADA','VENCIDA');
CREATE TYPE estado_entrega_venta AS ENUM ('PENDIENTE','PARCIAL','COMPLETA');
CREATE TYPE estado_linea       AS ENUM ('PENDIENTE_PROVEEDOR','EN_PEDIDO','PENDIENTE_TRASLADO','EN_TRANSITO','RESERVADO','ENTREGADO','ANULADO');
CREATE TYPE medio_tarjeta      AS ENUM ('TERMINAL','LINK_PAGO','OTRO');
CREATE TYPE tipo_mov_inv       AS ENUM ('INGRESO','AJUSTE','VENTA_ENTREGA','RESERVA','LIBERA','TRASLADO_SALIDA','TRASLADO_ENTRADA','ANULACION','PROVEEDOR_ENTRADA');
CREATE TYPE estado_traslado    AS ENUM ('BORRADOR','EN_TRANSITO','RECIBIDO','CANCELADO');
CREATE TYPE estado_pedido_prov AS ENUM ('SOLICITADO','PARCIAL','RECIBIDO','CANCELADO');
CREATE TYPE estado_factura     AS ENUM ('PENDIENTE','CERTIFICADA','ANULADA','ERROR');

-- ---------- Función de auditoría de fechas ----------
CREATE OR REPLACE FUNCTION fn_actualizado_en() RETURNS trigger AS $$
BEGIN NEW.actualizado_en := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

-- ---------- Personas y usuarios ----------
CREATE TABLE persona (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombres         VARCHAR(100) NOT NULL,
  apellidos       VARCHAR(100) NOT NULL DEFAULT '',
  nit             VARCHAR(20)  NOT NULL DEFAULT 'CF',
  dpi             VARCHAR(20),
  telefono        VARCHAR(20),
  correo          VARCHAR(120),
  activo          BOOLEAN NOT NULL DEFAULT true,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por      BIGINT
);
CREATE INDEX ix_persona_nit ON persona (nit);
CREATE INDEX ix_persona_nombre ON persona (lower(nombres || ' ' || apellidos));

CREATE TABLE colegio (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo          VARCHAR(20)  NOT NULL UNIQUE,
  nombre          VARCHAR(150) NOT NULL,
  direccion       VARCHAR(250),
  telefono        VARCHAR(20),
  activo          BOOLEAN NOT NULL DEFAULT true,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por      BIGINT
);

CREATE TABLE usuario (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  persona_id            BIGINT NOT NULL REFERENCES persona(id),
  username              VARCHAR(50) NOT NULL UNIQUE,
  password_hash         VARCHAR(100) NOT NULL,
  rol                   rol_usuario NOT NULL,
  colegio_id            BIGINT REFERENCES colegio(id),
  debe_cambiar_password BOOLEAN NOT NULL DEFAULT true,
  intentos_fallidos     INT NOT NULL DEFAULT 0,
  bloqueado_hasta       TIMESTAMPTZ,
  tema                  VARCHAR(10) NOT NULL DEFAULT 'system' CHECK (tema IN ('light','dark','system')),
  ultimo_acceso         TIMESTAMPTZ,
  activo                BOOLEAN NOT NULL DEFAULT true,
  creado_en             TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por            BIGINT
);
CREATE INDEX ix_usuario_persona ON usuario (persona_id);

-- ---------- Catálogos ----------
CREATE TABLE grado (
  id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre  VARCHAR(60) NOT NULL,
  nivel   VARCHAR(30) NOT NULL,
  orden   INT NOT NULL DEFAULT 0,
  activo  BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (nivel, nombre)
);

CREATE TABLE libro (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  isbn            VARCHAR(20) UNIQUE,
  titulo          VARCHAR(200) NOT NULL,
  editorial       VARCHAR(120),
  activo          BOOLEAN NOT NULL DEFAULT true,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por      BIGINT
);
CREATE INDEX ix_libro_titulo ON libro (lower(titulo));

CREATE TABLE precio_libro (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  colegio_id      BIGINT NOT NULL REFERENCES colegio(id),
  libro_id        BIGINT NOT NULL REFERENCES libro(id),
  ciclo           INT NOT NULL,
  precio          NUMERIC(12,2) NOT NULL CHECK (precio >= 0),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_por BIGINT,
  UNIQUE (colegio_id, libro_id, ciclo)
);

CREATE TABLE combo (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  colegio_id  BIGINT NOT NULL REFERENCES colegio(id),
  grado_id    BIGINT NOT NULL REFERENCES grado(id),
  ciclo       INT NOT NULL,
  nombre      VARCHAR(120) NOT NULL,
  descuento   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  activo      BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (colegio_id, grado_id, ciclo)
);

CREATE TABLE combo_libro (
  combo_id  BIGINT NOT NULL REFERENCES combo(id) ON DELETE CASCADE,
  libro_id  BIGINT NOT NULL REFERENCES libro(id),
  cantidad  INT NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  PRIMARY KEY (combo_id, libro_id)
);

CREATE TABLE proveedor (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre    VARCHAR(150) NOT NULL,
  nit       VARCHAR(20),
  contacto  VARCHAR(150),
  telefono  VARCHAR(20),
  correo    VARCHAR(120),
  activo    BOOLEAN NOT NULL DEFAULT true
);

-- ---------- Configuración ----------
CREATE TABLE metodo_pago (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo              VARCHAR(20) NOT NULL UNIQUE,   -- EFECTIVO | TARJETA | TRANSFERENCIA
  nombre              VARCHAR(60) NOT NULL,
  recargo_pct         NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (recargo_pct >= 0 AND recargo_pct <= 15),
  requiere_referencia BOOLEAN NOT NULL DEFAULT false,
  activo              BOOLEAN NOT NULL DEFAULT true,
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_por     BIGINT
);

CREATE TABLE denominacion (
  id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  valor   NUMERIC(8,2) NOT NULL,
  tipo    tipo_denominacion NOT NULL,
  orden   INT NOT NULL DEFAULT 0,
  activo  BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (valor, tipo)
);

CREATE TABLE parametro (
  clave           VARCHAR(60) PRIMARY KEY,
  valor           VARCHAR(250) NOT NULL,
  descripcion     VARCHAR(250),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Inventario ----------
CREATE TABLE inventario (
  colegio_id  BIGINT NOT NULL REFERENCES colegio(id),
  libro_id    BIGINT NOT NULL REFERENCES libro(id),
  existencia  INT NOT NULL DEFAULT 0 CHECK (existencia >= 0),
  reservado   INT NOT NULL DEFAULT 0 CHECK (reservado >= 0),
  version     INT NOT NULL DEFAULT 1,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (colegio_id, libro_id),
  CONSTRAINT ck_inv_reservado CHECK (reservado <= existencia)
);

CREATE TABLE movimiento_inventario (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  colegio_id  BIGINT NOT NULL REFERENCES colegio(id),
  libro_id    BIGINT NOT NULL REFERENCES libro(id),
  tipo        tipo_mov_inv NOT NULL,
  cantidad    INT NOT NULL,              -- positivo entra, negativo sale
  referencia  VARCHAR(60),               -- ej. V-2026-000123, T-12
  motivo      VARCHAR(250),
  usuario_id  BIGINT REFERENCES usuario(id),
  fecha       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_movinv_libro ON movimiento_inventario (colegio_id, libro_id, fecha);

CREATE TABLE traslado (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  origen_id     BIGINT NOT NULL REFERENCES colegio(id),
  destino_id    BIGINT NOT NULL REFERENCES colegio(id),
  estado        estado_traslado NOT NULL DEFAULT 'BORRADOR',
  observacion   VARCHAR(250),
  usuario_id    BIGINT REFERENCES usuario(id),
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  despachado_en TIMESTAMPTZ,
  recibido_en   TIMESTAMPTZ,
  recibido_por  BIGINT REFERENCES usuario(id),
  CHECK (origen_id <> destino_id)
);

CREATE TABLE traslado_detalle (
  traslado_id BIGINT NOT NULL REFERENCES traslado(id) ON DELETE CASCADE,
  libro_id    BIGINT NOT NULL REFERENCES libro(id),
  cantidad    INT NOT NULL CHECK (cantidad > 0),
  recibido    INT NOT NULL DEFAULT 0 CHECK (recibido >= 0),
  PRIMARY KEY (traslado_id, libro_id)
);

CREATE TABLE pedido_proveedor (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proveedor_id       BIGINT NOT NULL REFERENCES proveedor(id),
  colegio_destino_id BIGINT NOT NULL REFERENCES colegio(id),
  estado             estado_pedido_prov NOT NULL DEFAULT 'SOLICITADO',
  observacion        VARCHAR(250),
  usuario_id         BIGINT REFERENCES usuario(id),
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pedido_proveedor_detalle (
  pedido_id   BIGINT NOT NULL REFERENCES pedido_proveedor(id) ON DELETE CASCADE,
  libro_id    BIGINT NOT NULL REFERENCES libro(id),
  solicitado  INT NOT NULL CHECK (solicitado > 0),
  recibido    INT NOT NULL DEFAULT 0 CHECK (recibido >= 0),
  PRIMARY KEY (pedido_id, libro_id)
);

-- ---------- Cajas y turnos ----------
CREATE TABLE caja (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  colegio_id      BIGINT NOT NULL REFERENCES colegio(id),
  numero          INT NOT NULL CHECK (numero > 0),
  fondo_asignado  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (fondo_asignado >= 0),
  activa          BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (colegio_id, numero)
);

CREATE TABLE turno_caja (
  id                        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  caja_id                   BIGINT NOT NULL REFERENCES caja(id),
  usuario_id                BIGINT NOT NULL REFERENCES usuario(id),
  estado                    estado_turno NOT NULL DEFAULT 'ABIERTO',
  fondo_inicial             NUMERIC(12,2) NOT NULL DEFAULT 0,
  observacion_apertura      VARCHAR(250),
  efectivo_esperado         NUMERIC(12,2),
  efectivo_contado          NUMERIC(12,2),
  diferencia_efectivo       NUMERIC(12,2),
  tarjeta_esperado          NUMERIC(12,2),
  transferencia_esperado    NUMERIC(12,2),
  observacion_cierre        VARCHAR(250),
  forzado                   BOOLEAN NOT NULL DEFAULT false,
  cerrado_por               BIGINT REFERENCES usuario(id),
  validado_por              BIGINT REFERENCES usuario(id),
  observacion_validacion    VARCHAR(250),
  abierto_en                TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado_en                TIMESTAMPTZ,
  validado_en               TIMESTAMPTZ
);
-- Un turno activo por caja y por usuario (RN-04)
CREATE UNIQUE INDEX ux_turno_caja_activo    ON turno_caja (caja_id)    WHERE estado IN ('ABIERTO','EN_CIERRE');
CREATE UNIQUE INDEX ux_turno_usuario_activo ON turno_caja (usuario_id) WHERE estado IN ('ABIERTO','EN_CIERRE');
CREATE INDEX ix_turno_fecha ON turno_caja (abierto_en);

CREATE TABLE turno_denominacion (
  turno_id        BIGINT NOT NULL REFERENCES turno_caja(id) ON DELETE CASCADE,
  momento         momento_conteo NOT NULL,
  denominacion_id BIGINT NOT NULL REFERENCES denominacion(id),
  cantidad        INT NOT NULL CHECK (cantidad >= 0),
  PRIMARY KEY (turno_id, momento, denominacion_id)
);

CREATE TABLE movimiento_caja (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  turno_id    BIGINT NOT NULL REFERENCES turno_caja(id),
  tipo        tipo_mov_caja NOT NULL,
  monto       NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  motivo      VARCHAR(250) NOT NULL,
  referencia  VARCHAR(60),
  usuario_id  BIGINT NOT NULL REFERENCES usuario(id),
  fecha       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Ventas ----------
CREATE SEQUENCE seq_codigo_venta;

CREATE TABLE venta (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo           VARCHAR(20) NOT NULL UNIQUE,          -- V-2026-000001 / P-2026-000001
  canal            canal_venta NOT NULL DEFAULT 'PRESENCIAL',
  colegio_id       BIGINT NOT NULL REFERENCES colegio(id),
  cliente_id       BIGINT NOT NULL REFERENCES persona(id),
  alumno           VARCHAR(150),
  grado_id         BIGINT REFERENCES grado(id),
  ciclo            INT NOT NULL,
  turno_id         BIGINT REFERENCES turno_caja(id),     -- NULL para pedidos de portal sin pagar
  usuario_id       BIGINT REFERENCES usuario(id),        -- NULL si lo crea el cliente en el portal
  subtotal         NUMERIC(12,2) NOT NULL DEFAULT 0,
  descuento        NUMERIC(12,2) NOT NULL DEFAULT 0,
  recargo          NUMERIC(12,2) NOT NULL DEFAULT 0,
  total            NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado_pago      estado_pago_venta NOT NULL DEFAULT 'PAGADA',
  estado_entrega   estado_entrega_venta NOT NULL DEFAULT 'PENDIENTE',
  vence_en         TIMESTAMPTZ,                          -- fase 2: pedidos del portal
  observacion      VARCHAR(250),
  anulada_por      BIGINT REFERENCES usuario(id),
  motivo_anulacion VARCHAR(250),
  anulada_en       TIMESTAMPTZ,
  fecha            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (total = subtotal - descuento + recargo)
);
CREATE INDEX ix_venta_fecha   ON venta (fecha);
CREATE INDEX ix_venta_colegio ON venta (colegio_id, fecha);
CREATE INDEX ix_venta_turno   ON venta (turno_id);
CREATE INDEX ix_venta_cliente ON venta (cliente_id);

CREATE TABLE venta_detalle (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venta_id          BIGINT NOT NULL REFERENCES venta(id),
  libro_id          BIGINT NOT NULL REFERENCES libro(id),
  cantidad          INT NOT NULL CHECK (cantidad > 0),
  cantidad_entregada INT NOT NULL DEFAULT 0 CHECK (cantidad_entregada >= 0),
  precio_unitario   NUMERIC(12,2) NOT NULL CHECK (precio_unitario >= 0),
  subtotal          NUMERIC(12,2) NOT NULL,
  estado            estado_linea NOT NULL,
  colegio_origen_id BIGINT REFERENCES colegio(id),       -- colegio sugerido para traslado
  traslado_id       BIGINT REFERENCES traslado(id),
  pedido_proveedor_id BIGINT REFERENCES pedido_proveedor(id),
  CHECK (cantidad_entregada <= cantidad)
);
CREATE INDEX ix_vdet_venta  ON venta_detalle (venta_id);
CREATE INDEX ix_vdet_estado ON venta_detalle (estado, libro_id);

CREATE TABLE venta_pago (
  id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venta_id                 BIGINT NOT NULL REFERENCES venta(id),
  metodo_pago_id           BIGINT NOT NULL REFERENCES metodo_pago(id),
  turno_id                 BIGINT REFERENCES turno_caja(id),
  medio                    medio_tarjeta,                -- solo tarjeta, opcional
  monto_base               NUMERIC(12,2) NOT NULL CHECK (monto_base > 0),
  recargo_pct              NUMERIC(5,2)  NOT NULL DEFAULT 0, -- snapshot
  recargo                  NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_total              NUMERIC(12,2) NOT NULL,
  recibido                 NUMERIC(12,2),                -- solo efectivo
  vuelto                   NUMERIC(12,2),                -- solo efectivo
  referencia               VARCHAR(60),
  -- Fase 2 (pagos en línea)
  comprobante_url          VARCHAR(300),
  pasarela                 VARCHAR(40),
  pasarela_transaccion_id  VARCHAR(100),
  pasarela_estado          VARCHAR(30),
  validado_por             BIGINT REFERENCES usuario(id),
  validado_en              TIMESTAMPTZ,
  usuario_id               BIGINT REFERENCES usuario(id),
  fecha                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  anulado                  BOOLEAN NOT NULL DEFAULT false,
  CHECK (monto_total = monto_base + recargo)
);
CREATE INDEX ix_vpago_turno ON venta_pago (turno_id);
CREATE INDEX ix_vpago_venta ON venta_pago (venta_id);

CREATE TABLE entrega (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venta_detalle_id  BIGINT NOT NULL REFERENCES venta_detalle(id),
  cantidad          INT NOT NULL CHECK (cantidad > 0),
  usuario_id        BIGINT NOT NULL REFERENCES usuario(id),
  fecha             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- FEL (fase 2) ----------
CREATE TABLE factura (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venta_id           BIGINT NOT NULL REFERENCES venta(id),
  nit_receptor       VARCHAR(20) NOT NULL,
  nombre_receptor    VARCHAR(200) NOT NULL,
  serie              VARCHAR(40),
  numero             VARCHAR(40),
  uuid_autorizacion  VARCHAR(60) UNIQUE,
  estado             estado_factura NOT NULL DEFAULT 'PENDIENTE',
  certificador       VARCHAR(40),
  xml                TEXT,
  mensaje_error      VARCHAR(500),
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  certificado_en     TIMESTAMPTZ,
  anulado_en         TIMESTAMPTZ
);
CREATE INDEX ix_factura_venta ON factura (venta_id);

-- ---------- Auditoría ----------
CREATE TABLE bitacora (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id  BIGINT REFERENCES usuario(id),
  accion      VARCHAR(40) NOT NULL,      -- CREAR, EDITAR, DESACTIVAR, ANULAR, LOGIN, CONFIG...
  entidad     VARCHAR(60) NOT NULL,
  entidad_id  VARCHAR(40),
  antes       JSONB,
  despues     JSONB,
  ip          VARCHAR(45),
  fecha       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_bitacora_fecha   ON bitacora (fecha);
CREATE INDEX ix_bitacora_entidad ON bitacora (entidad, entidad_id);

-- ---------- Triggers actualizado_en ----------
CREATE TRIGGER tg_persona_upd  BEFORE UPDATE ON persona  FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();
CREATE TRIGGER tg_colegio_upd  BEFORE UPDATE ON colegio  FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();
CREATE TRIGGER tg_usuario_upd  BEFORE UPDATE ON usuario  FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();
CREATE TRIGGER tg_libro_upd    BEFORE UPDATE ON libro    FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();
CREATE TRIGGER tg_precio_upd   BEFORE UPDATE ON precio_libro FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();
CREATE TRIGGER tg_metodo_upd   BEFORE UPDATE ON metodo_pago  FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();
CREATE TRIGGER tg_inv_upd      BEFORE UPDATE ON inventario   FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();
CREATE TRIGGER tg_pedprov_upd  BEFORE UPDATE ON pedido_proveedor FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();
CREATE TRIGGER tg_param_upd    BEFORE UPDATE ON parametro    FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();

-- ---------- Vista de disponibilidad ----------
CREATE VIEW v_disponibilidad AS
SELECT i.colegio_id, i.libro_id, i.existencia, i.reservado,
       (i.existencia - i.reservado) AS disponible,
       COALESCE(p.pendientes, 0) AS pendientes_propios,
       (i.existencia - i.reservado - COALESCE(p.pendientes, 0)) AS excedente
FROM inventario i
LEFT JOIN (
  SELECT v.colegio_id, d.libro_id, SUM(d.cantidad - d.cantidad_entregada) AS pendientes
  FROM venta_detalle d JOIN venta v ON v.id = d.venta_id
  WHERE d.estado IN ('PENDIENTE_TRASLADO','PENDIENTE_PROVEEDOR')
  GROUP BY v.colegio_id, d.libro_id
) p ON p.colegio_id = i.colegio_id AND p.libro_id = i.libro_id;
