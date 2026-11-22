-- =====================================================================
-- SVI - HISTORIAL DE PRUEBA (solo desarrollo local). NUNCA ejecutar en producción.
-- Requiere 03_datos_prueba.sql y las migraciones V003-V005. Se ejecuta una sola vez
-- (marca el parámetro demo_historial); para regenerarlo hay que recrear la BD.
--
--   docker exec -i intelecto_postgres psql -U intelecto -d intelecto < db/sql/demo/04_historial.sql
--
-- Simula ~60 días de temporada escolar en 3 colegios: turnos abiertos y cerrados (validados,
-- algunos con diferencia), ventas por alumno con combos y licencias, pagos en efectivo,
-- tarjeta (con recargo) y transferencia, libros que se agotan y quedan pendientes, traslados
-- y pedidos a proveedor ya recibidos, entregas posteriores y algunas anulaciones.
-- El inventario y el kárdex quedan consistentes con las ventas.
-- =====================================================================
BEGIN;

-- ---------- Tercer colegio, su caja y su cajero ----------
INSERT INTO colegio (codigo, nombre, direccion, telefono)
VALUES ('COL-CENTRAL', 'Colegio Central', 'Zona 1, Guatemala', '2222-3003')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO caja (colegio_id, numero, fondo_asignado)
SELECT id, 1, 500.00 FROM colegio WHERE codigo = 'COL-CENTRAL'
ON CONFLICT (colegio_id, numero) DO NOTHING;

WITH p AS (
  INSERT INTO persona (nombres, apellidos, nit, creado_por)
  SELECT 'Celia', 'Ramírez (prueba)', 'CF', 1
   WHERE NOT EXISTS (SELECT 1 FROM usuario WHERE username = 'cajero.central')
  RETURNING id
)
INSERT INTO usuario (persona_id, username, password_hash, rol, colegio_id, debe_cambiar_password, creado_por)
SELECT p.id, 'cajero.central',
       '$2b$12$g3OXGSrpJETF05lrqG9QoOmTPtkQ.JmsjRf8MWV23FcLhk7Srav52',  -- Prueba2026!
       'CAJERO', (SELECT id FROM colegio WHERE codigo = 'COL-CENTRAL'), false, 1
  FROM p;

-- ---------- Libros de 3.º primaria ----------
INSERT INTO libro (isbn, titulo, editorial, creado_por) VALUES
  ('978-9929-100-09-7', 'Matemática Activa 3',      'Santillana', 1),
  ('978-9929-100-10-3', 'Comunicación y Lenguaje 3', 'Santillana', 1),
  ('978-9929-100-11-0', 'Ciencias Naturales 3',      'Norma',      1),
  ('978-9929-100-12-7', 'English Kids 3',            'Oxford',     1)
ON CONFLICT (isbn) DO NOTHING;

-- ---------- Precios 2027 de todos los libros en los 3 colegios ----------
INSERT INTO precio_libro (colegio_id, libro_id, ciclo, precio, actualizado_por)
SELECT c.id, l.id, 2027,
       v.precio + CASE c.codigo WHEN 'COL-SUR' THEN 10 WHEN 'COL-CENTRAL' THEN 5 ELSE 0 END, 1
  FROM (VALUES
    ('978-9929-100-01-1', 145.00), ('978-9929-100-02-8', 135.00), ('978-9929-100-03-5', 120.00),
    ('978-9929-100-04-2', 150.00), ('978-9929-100-05-9', 140.00), ('978-9929-100-06-6', 125.00),
    ('978-9929-100-07-3', 180.00), ('978-9929-100-08-0', 185.00), ('978-9929-100-09-7', 155.00),
    ('978-9929-100-10-3', 145.00), ('978-9929-100-11-0', 130.00), ('978-9929-100-12-7', 190.00)
  ) AS v(isbn, precio)
  JOIN libro l ON l.isbn = v.isbn
  CROSS JOIN colegio c WHERE c.codigo IN ('COL-NORTE', 'COL-SUR', 'COL-CENTRAL')
ON CONFLICT (colegio_id, libro_id, ciclo) DO NOTHING;

-- ---------- Combos 1.º, 2.º y 3.º primaria en los 3 colegios ----------
INSERT INTO combo (colegio_id, grado_id, ciclo, nombre, descuento)
SELECT c.id, g.id, 2027, 'Combo ' || g.nombre || ' 2027',
       CASE g.nombre WHEN '3.º primaria' THEN 60.00 ELSE 50.00 END
  FROM colegio c CROSS JOIN grado g
 WHERE c.codigo IN ('COL-NORTE', 'COL-SUR', 'COL-CENTRAL')
   AND g.nombre IN ('1.º primaria', '2.º primaria', '3.º primaria')
ON CONFLICT (colegio_id, grado_id, ciclo) DO NOTHING;

INSERT INTO combo_libro (combo_id, libro_id, cantidad)
SELECT cb.id, l.id, 1
  FROM combo cb JOIN grado g ON g.id = cb.grado_id
  JOIN libro l ON l.isbn = ANY (CASE g.nombre
      WHEN '1.º primaria' THEN ARRAY['978-9929-100-01-1','978-9929-100-02-8','978-9929-100-03-5','978-9929-100-07-3']
      WHEN '2.º primaria' THEN ARRAY['978-9929-100-04-2','978-9929-100-05-9','978-9929-100-06-6','978-9929-100-08-0']
      WHEN '3.º primaria' THEN ARRAY['978-9929-100-09-7','978-9929-100-10-3','978-9929-100-11-0','978-9929-100-12-7']
    END)
 WHERE cb.ciclo = 2027
ON CONFLICT (combo_id, libro_id) DO NOTHING;

-- ---------- Proveedores ----------
INSERT INTO proveedor (nombre, nit, contacto, telefono, correo)
SELECT v.* FROM (VALUES
  ('Santillana Guatemala', '1111111', 'Ventas institucionales', '2300-1000', 'ventas@santillana.ejemplo.com'),
  ('Norma Guatemala',      '2222222', 'Atención a colegios',    '2300-2000', 'colegios@norma.ejemplo.com'),
  ('Oxford University Press GT', '3333333', 'Distribución',     '2300-3000', 'pedidos@oxford.ejemplo.com')
) AS v(nombre, nit, contacto, telefono, correo)
WHERE NOT EXISTS (SELECT 1 FROM proveedor p WHERE p.nombre = v.nombre);

-- =====================================================================
DO $$
DECLARE
  v_contador BIGINT := (SELECT id FROM usuario WHERE username = 'contador');
  v_admin    BIGINT := (SELECT id FROM usuario WHERE username = 'admin');
  nombres    TEXT[] := ARRAY['María','José','Ana','Luis','Carmen','Carlos','Lucía','Jorge','Sofía','Pedro',
                             'Andrea','Miguel','Gabriela','Juan','Valeria','Diego','Paola','Fernando','Rosa',
                             'Ricardo','Claudia','Óscar','Marta','Héctor','Silvia','Mario','Patricia','Raúl'];
  apellidos  TEXT[] := ARRAY['García','López','Pérez','Hernández','Morales','Castillo','Rodríguez','Méndez',
                             'Ramírez','Gómez','Ruiz','Díaz','Cruz','Reyes','Flores','Barrios','Orellana',
                             'Estrada','Juárez','Monzón','Aguilar','Velásquez','Chávez','Pineda'];
  hijos      TEXT[] := ARRAY['Mateo','Valentina','Santiago','Camila','Sebastián','Isabella','Daniel','Mariana',
                             'Emiliano','Renata','Gael','Ximena','Leonardo','Regina','Andrés','Fernanda',
                             'Nicolás','Victoria','Samuel','Daniela'];
  c RECORD; f RECORD; a RECORD; l RECORD; ln RECORD;
  d INT; dia DATE; n INT; i INT; k INT;
  ramp NUMERIC; wfac NUMERIC;
  t_id BIGINT; t_abre TIMESTAMPTZ; t_venta TIMESTAMPTZ;
  v_id BIGINT; v_cod TEXT; va_id BIGINT; det_id BIGINT;
  cb_id BIGINT; cb_desc NUMERIC; con_combo BOOLEAN;
  sub NUMERIC; descu NUMERIC; base NUMERIC; v_rec NUMERIC; pct NUMERIC;
  metodo TEXT; mp_id BIGINT; v_recibido NUMERIC;
  efectivo NUMERIC; tarjeta NUMERIC; transf NUMERIC; dif NUMERIC;
  disp INT; origen BIGINT; estado_l estado_linea;
  pid BIGINT; tid BIGINT; fecha_ent TIMESTAMPTZ; q INT;
BEGIN
  IF EXISTS (SELECT 1 FROM parametro WHERE clave = 'demo_historial') THEN
    RAISE NOTICE 'El historial de prueba ya estaba cargado: no se hace nada.';
    RETURN;
  END IF;
  PERFORM setseed(0.2027);

  -- ---------- 1. Carga de inventario al inicio de la temporada (hace 75 días) ----------
  FOR c IN SELECT id, codigo FROM colegio WHERE codigo IN ('COL-NORTE','COL-SUR','COL-CENTRAL') LOOP
    FOR l IN SELECT lb.id, lb.isbn, lb.titulo FROM libro lb WHERE lb.isbn LIKE '978-9929-100-%' LOOP
      q := round(
             CASE WHEN l.titulo LIKE '% 1' THEN 150 WHEN l.titulo LIKE '% 2' THEN 125 ELSE 105 END
           * CASE c.codigo WHEN 'COL-NORTE' THEN 1.15 WHEN 'COL-SUR' THEN 0.62 ELSE 0.92 END);
      -- Casos para que el sistema tenga algo que sugerir:
      IF c.codigo = 'COL-SUR' AND l.titulo = 'English Kids 2' THEN q := 0; END IF;
      IF c.codigo = 'COL-CENTRAL' AND l.titulo = 'Ciencias Naturales 3' THEN q := 25; END IF;
      IF c.codigo = 'COL-SUR' AND l.titulo = 'Matemática Activa 1' THEN q := 35; END IF;
      IF c.codigo = 'COL-NORTE' AND l.titulo LIKE '% 3' THEN q := q + 60; END IF;  -- Norte con excedente de 3.º
      CONTINUE WHEN q = 0;
      INSERT INTO inventario (colegio_id, libro_id, existencia) VALUES (c.id, l.id, q)
      ON CONFLICT (colegio_id, libro_id) DO UPDATE SET existencia = inventario.existencia + EXCLUDED.existencia;
      INSERT INTO movimiento_inventario (colegio_id, libro_id, tipo, cantidad, referencia, motivo, usuario_id, fecha)
      VALUES (c.id, l.id, 'INGRESO', q, 'TEMPORADA-2027', 'Carga de inicio de temporada (prueba)', v_contador,
              now() - interval '75 days');
    END LOOP;
  END LOOP;

  -- ---------- 2. Familias (padres con 1 a 3 hijos) ----------
  CREATE TEMP TABLE _fam (persona_id BIGINT, colegio_id BIGINT) ON COMMIT DROP;
  FOR i IN 1..180 LOOP
    DECLARE
      nom TEXT := nombres[1 + floor(random() * array_length(nombres, 1))::int];
      ap1 TEXT := apellidos[1 + floor(random() * array_length(apellidos, 1))::int];
      ap2 TEXT := apellidos[1 + floor(random() * array_length(apellidos, 1))::int];
      r1 NUMERIC := random();
      cod TEXT := CASE WHEN r1 < 0.45 THEN 'COL-NORTE' WHEN r1 < 0.75 THEN 'COL-CENTRAL' ELSE 'COL-SUR' END;
      col BIGINT := (SELECT id FROM colegio WHERE codigo = cod);
      grado_txt TEXT;
      per BIGINT;
    BEGIN
      INSERT INTO persona (nombres, apellidos, nit, telefono, correo, creado_por)
      VALUES (nom, ap1 || ' ' || ap2,
              CASE WHEN random() < 0.35 THEN (1000000 + floor(random() * 8999999))::text ELSE 'CF' END,
              (5000 + floor(random() * 4999))::text || '-' || lpad(floor(random() * 9999)::text, 4, '0'),
              CASE WHEN random() < 0.55 THEN f_norm(nom) || '.' || f_norm(ap1) || i || '@ejemplo.com' END,
              v_admin)
      RETURNING id INTO per;
      INSERT INTO _fam VALUES (per, col);
      FOR k IN 1..(1 + floor(random() * 2.4)::int) LOOP
        grado_txt := (ARRAY['1.º primaria','2.º primaria','3.º primaria'])[1 + floor(random() * 3)::int];
        WITH al AS (
          INSERT INTO alumno (nombres, apellidos, colegio_id, grado_id, creado_por)
          VALUES (hijos[1 + floor(random() * array_length(hijos, 1))::int], ap1 || ' ' || ap2, col,
                  (SELECT id FROM grado WHERE nombre = grado_txt),
                  v_admin)
          RETURNING id
        )
        INSERT INTO persona_alumno (persona_id, alumno_id, parentesco)
        SELECT per, al.id, CASE WHEN random() < 0.6 THEN 'MADRE' WHEN random() < 0.8 THEN 'PADRE' ELSE 'ENCARGADO' END FROM al;
      END LOOP;
    END;
  END LOOP;

  -- ---------- 3. Reabastecimiento a media temporada (hace 30 días, pedido recibido) ----------
  INSERT INTO pedido_proveedor (proveedor_id, colegio_destino_id, estado, observacion, usuario_id, creado_en, actualizado_en)
  SELECT (SELECT id FROM proveedor WHERE nombre = 'Santillana Guatemala'), id, 'RECIBIDO',
         'Reabastecimiento de media temporada (prueba)', v_contador, now() - interval '34 days', now() - interval '30 days'
    FROM colegio WHERE codigo = 'COL-NORTE'
  RETURNING id INTO pid;
  FOR l IN SELECT id FROM libro WHERE isbn IN ('978-9929-100-01-1','978-9929-100-02-8') LOOP
    INSERT INTO pedido_proveedor_detalle (pedido_id, libro_id, solicitado, recibido) VALUES (pid, l.id, 30, 30);
    UPDATE inventario SET existencia = existencia + 30
     WHERE libro_id = l.id AND colegio_id = (SELECT id FROM colegio WHERE codigo = 'COL-NORTE');
    INSERT INTO movimiento_inventario (colegio_id, libro_id, tipo, cantidad, referencia, motivo, usuario_id, fecha)
    VALUES ((SELECT id FROM colegio WHERE codigo = 'COL-NORTE'), l.id, 'PROVEEDOR_ENTRADA', 30, 'P-' || pid,
            'Recepción de pedido (prueba)', v_contador, now() - interval '30 days');
  END LOOP;

  -- ---------- 4. Días de venta ----------
  FOR d IN REVERSE 60..1 LOOP
    dia := (now() AT TIME ZONE 'America/Guatemala')::date - d;
    CONTINUE WHEN extract(dow FROM dia) = 0;                       -- domingo cerrado
    ramp := 0.45 + 1.15 * (60 - d) / 60.0;                         -- la temporada va creciendo
    wfac := CASE extract(dow FROM dia) WHEN 6 THEN 0.55 WHEN 1 THEN 1.15 ELSE 1.0 END;

    FOR c IN
      SELECT co.id, co.codigo, cj.id AS caja_id, cj.fondo_asignado AS fondo, u.id AS cajero,
             CASE co.codigo WHEN 'COL-NORTE' THEN 5.5 WHEN 'COL-CENTRAL' THEN 4.0 ELSE 3.0 END AS base
        FROM colegio co JOIN caja cj ON cj.colegio_id = co.id AND cj.numero = 1
        JOIN usuario u ON u.colegio_id = co.id AND u.rol = 'CAJERO'
       WHERE co.codigo IN ('COL-NORTE','COL-SUR','COL-CENTRAL')
    LOOP
      n := greatest(0, round(c.base * ramp * wfac * (0.7 + random() * 0.6)));
      CONTINUE WHEN n = 0;
      t_abre := (dia + time '07:45') AT TIME ZONE 'America/Guatemala';
      INSERT INTO turno_caja (caja_id, usuario_id, estado, fondo_inicial, abierto_en)
      VALUES (c.caja_id, c.cajero, 'CERRADO', c.fondo, t_abre) RETURNING id INTO t_id;  -- nace cerrado: no choca con turnos abiertos reales
      efectivo := 0; tarjeta := 0; transf := 0;

      FOR i IN 1..n LOOP
        SELECT * INTO f FROM _fam WHERE colegio_id = c.id ORDER BY random() LIMIT 1;
        t_venta := t_abre + interval '15 minutes' + (i * (interval '9 hours' / (n + 1)));
        v_cod := 'V-' || to_char(dia, 'YYYY') || '-' || lpad(nextval('seq_codigo_venta')::text, 6, '0');
        INSERT INTO venta (codigo, canal, colegio_id, cliente_id, ciclo, turno_id, usuario_id,
                           estado_pago, estado_entrega, fecha)
        VALUES (v_cod, 'PRESENCIAL', c.id, f.persona_id, 2027, t_id, c.cajero, 'PAGADA', 'PENDIENTE', t_venta)
        RETURNING id INTO v_id;
        sub := 0; descu := 0; k := 0;

        FOR a IN
          SELECT al.id, al.grado_id FROM alumno al JOIN persona_alumno pa ON pa.alumno_id = al.id
           WHERE pa.persona_id = f.persona_id ORDER BY random()
           LIMIT (1 + floor(random() * 3))::int
        LOOP
          k := k + 1;
          SELECT cb.id, cb.descuento INTO cb_id, cb_desc FROM combo cb
           WHERE cb.colegio_id = c.id AND cb.grado_id = a.grado_id AND cb.ciclo = 2027 AND cb.activo;
          con_combo := cb_id IS NOT NULL AND random() < 0.78;
          INSERT INTO venta_alumno (venta_id, alumno_id, grado_id, combo_id, descuento, licencia, orden)
          VALUES (v_id, a.id, a.grado_id, CASE WHEN con_combo THEN cb_id END,
                  CASE WHEN con_combo THEN cb_desc ELSE 0 END,
                  CASE WHEN random() < 0.7 THEN 'LIC-' || upper(substr(md5(random()::text), 1, 4)) || '-' ||
                                               upper(substr(md5(random()::text), 1, 5)) END,
                  k - 1)
          RETURNING id INTO va_id;
          IF con_combo THEN descu := descu + cb_desc; END IF;

          FOR l IN
            SELECT cl.libro_id, pl.precio FROM combo_libro cl
              JOIN precio_libro pl ON pl.libro_id = cl.libro_id AND pl.colegio_id = c.id AND pl.ciclo = 2027
             WHERE con_combo AND cl.combo_id = cb_id
            UNION ALL
            (SELECT pl.libro_id, pl.precio FROM precio_libro pl JOIN combo_libro cl ON cl.libro_id = pl.libro_id
               JOIN combo cb2 ON cb2.id = cl.combo_id AND cb2.colegio_id = c.id AND cb2.grado_id = a.grado_id
              WHERE NOT con_combo AND pl.colegio_id = c.id AND pl.ciclo = 2027
              ORDER BY random() LIMIT (1 + floor(random() * 2))::int)
          LOOP
            SELECT existencia - reservado INTO disp FROM inventario WHERE colegio_id = c.id AND libro_id = l.libro_id;
            disp := coalesce(disp, 0);
            origen := NULL;
            IF disp >= 1 THEN
              estado_l := CASE WHEN d <= 6 AND random() < 0.25 THEN 'RESERVADO' ELSE 'ENTREGADO' END;
            ELSE
              SELECT i2.colegio_id INTO origen FROM inventario i2
               WHERE i2.libro_id = l.libro_id AND i2.colegio_id <> c.id AND i2.existencia - i2.reservado > 3
               ORDER BY i2.existencia - i2.reservado DESC LIMIT 1;
              estado_l := CASE WHEN origen IS NOT NULL THEN 'PENDIENTE_TRASLADO' ELSE 'PENDIENTE_PROVEEDOR' END;
            END IF;
            INSERT INTO venta_detalle (venta_id, venta_alumno_id, libro_id, cantidad, cantidad_entregada,
                                       precio_unitario, subtotal, estado, colegio_origen_id)
            VALUES (v_id, va_id, l.libro_id, 1, CASE WHEN estado_l = 'ENTREGADO' THEN 1 ELSE 0 END,
                    l.precio, l.precio, estado_l, origen)
            RETURNING id INTO det_id;
            sub := sub + l.precio;
            IF estado_l = 'ENTREGADO' THEN
              UPDATE inventario SET existencia = existencia - 1 WHERE colegio_id = c.id AND libro_id = l.libro_id;
              INSERT INTO movimiento_inventario (colegio_id, libro_id, tipo, cantidad, referencia, usuario_id, fecha)
              VALUES (c.id, l.libro_id, 'VENTA_ENTREGA', -1, v_cod, c.cajero, t_venta);
              INSERT INTO entrega (venta_detalle_id, cantidad, usuario_id, fecha) VALUES (det_id, 1, c.cajero, t_venta);
            ELSIF estado_l = 'RESERVADO' THEN
              UPDATE inventario SET reservado = reservado + 1 WHERE colegio_id = c.id AND libro_id = l.libro_id;
              INSERT INTO movimiento_inventario (colegio_id, libro_id, tipo, cantidad, referencia, motivo, usuario_id, fecha)
              VALUES (c.id, l.libro_id, 'RESERVA', 1, v_cod, 'El cliente recoge después', c.cajero, t_venta);
            END IF;
          END LOOP;
        END LOOP;

        IF k = 0 OR sub = 0 THEN   -- familia sin alumnos (no debería pasar): se descarta
          DELETE FROM venta_detalle WHERE venta_id = v_id;
          DELETE FROM venta_alumno WHERE venta_id = v_id;
          DELETE FROM venta WHERE id = v_id;
          CONTINUE;
        END IF;

        descu := least(descu, sub);
        base := sub - descu;
        dif := random();   -- (reutiliza la variable) 60 % efectivo, 30 % tarjeta, 10 % transferencia
        metodo := CASE WHEN dif < 0.6 THEN 'EFECTIVO' WHEN dif < 0.9 THEN 'TARJETA' ELSE 'TRANSFERENCIA' END;
        SELECT id, recargo_pct INTO mp_id, pct FROM metodo_pago WHERE codigo = metodo;
        v_rec := round(base * pct / 100, 2);
        v_recibido := CASE WHEN metodo = 'EFECTIVO' THEN ceil(base / 50) * 50 END;
        INSERT INTO venta_pago (venta_id, metodo_pago_id, turno_id, medio, monto_base, recargo_pct, recargo,
                                monto_total, recibido, vuelto, referencia, usuario_id, fecha)
        VALUES (v_id, mp_id, t_id, CASE WHEN metodo = 'TARJETA' THEN 'TERMINAL'::medio_tarjeta END,
                base, pct, v_rec, base + v_rec, v_recibido,
                CASE WHEN metodo = 'EFECTIVO' THEN v_recibido - base END,
                CASE WHEN metodo <> 'EFECTIVO' THEN upper(substr(md5(random()::text), 1, 8)) END,
                c.cajero, t_venta);
        UPDATE venta SET subtotal = sub, descuento = descu, recargo = v_rec, total = base + v_rec,
               alumno = (SELECT left(string_agg(trim(al.nombres || ' ' || al.apellidos), ', ' ORDER BY va.orden), 150)
                           FROM venta_alumno va JOIN alumno al ON al.id = va.alumno_id WHERE va.venta_id = v_id),
               estado_entrega = (SELECT CASE WHEN bool_and(estado = 'ENTREGADO') THEN 'COMPLETA'
                                             WHEN bool_or(estado = 'ENTREGADO') THEN 'PARCIAL'
                                             ELSE 'PENDIENTE' END::estado_entrega_venta
                                   FROM venta_detalle WHERE venta_id = v_id)
         WHERE id = v_id;
        IF metodo = 'EFECTIVO' THEN efectivo := efectivo + base;
        ELSIF metodo = 'TARJETA' THEN tarjeta := tarjeta + base + v_rec;
        ELSE transf := transf + base; END IF;

        -- Anulaciones ocasionales (cliente desiste): se devuelve el stock y el efectivo.
        IF d > 3 AND random() < 0.015 THEN
          FOR ln IN SELECT id, libro_id, estado FROM venta_detalle WHERE venta_id = v_id LOOP
            IF ln.estado = 'ENTREGADO' THEN
              UPDATE inventario SET existencia = existencia + 1 WHERE colegio_id = c.id AND libro_id = ln.libro_id;
              INSERT INTO movimiento_inventario (colegio_id, libro_id, tipo, cantidad, referencia, motivo, usuario_id, fecha)
              VALUES (c.id, ln.libro_id, 'ANULACION', 1, v_cod, 'Cliente desistió de la compra', v_contador, t_venta + interval '1 hour');
            ELSIF ln.estado = 'RESERVADO' THEN
              UPDATE inventario SET reservado = reservado - 1 WHERE colegio_id = c.id AND libro_id = ln.libro_id;
            END IF;
          END LOOP;
          UPDATE venta_detalle SET estado = 'ANULADO' WHERE venta_id = v_id;
          UPDATE venta SET estado_pago = 'ANULADA', anulada_por = v_contador, anulada_en = t_venta + interval '1 hour',
                 motivo_anulacion = 'Cliente desistió de la compra'
           WHERE id = v_id;
          IF metodo = 'EFECTIVO' THEN
            INSERT INTO movimiento_caja (turno_id, tipo, monto, motivo, referencia, usuario_id, fecha)
            VALUES (t_id, 'REEMBOLSO', base, 'Anulación ' || v_cod || ': cliente desistió', v_cod, v_contador,
                    t_venta + interval '1 hour');
            efectivo := efectivo - base;
          END IF;
        END IF;
      END LOOP;

      -- Cierre del turno (la mayoría cuadra; algunos con diferencia, observados)
      dif := CASE WHEN random() < 0.12 THEN round((random() * 40 - 25)::numeric, 2) ELSE 0 END;
      UPDATE turno_caja
         SET efectivo_esperado = fondo_inicial + efectivo,
             efectivo_contado = fondo_inicial + efectivo + dif,
             diferencia_efectivo = dif,
             tarjeta_esperado = tarjeta, transferencia_esperado = transf,
             observacion_cierre = CASE WHEN dif <> 0 THEN 'Diferencia al contar el efectivo' END,
             cerrado_por = c.cajero, cerrado_en = t_abre + interval '9 hours 45 minutes',
             estado = CASE WHEN dif < -10 THEN 'OBSERVADO' ELSE 'VALIDADO' END::estado_turno,
             validado_por = v_contador, validado_en = t_abre + interval '10 hours 30 minutes',
             observacion_validacion = CASE WHEN dif < -10 THEN 'Faltante: se descuenta según política' END
       WHERE id = t_id;
    END LOOP;
  END LOOP;

  -- ---------- 5. Lo que llegó después: reservas recogidas y pendientes resueltos ----------
  -- Reservas de hace más de 3 días: el cliente ya las recogió.
  FOR ln IN
    SELECT dt.id, dt.libro_id, dt.cantidad, v.colegio_id, v.fecha, v.usuario_id, v.codigo
      FROM venta_detalle dt JOIN venta v ON v.id = dt.venta_id
     WHERE dt.estado = 'RESERVADO' AND v.estado_pago = 'PAGADA' AND v.fecha < now() - interval '3 days'
  LOOP
    fecha_ent := ln.fecha + (1 + floor(random() * 3)) * interval '1 day';
    UPDATE inventario SET existencia = existencia - ln.cantidad, reservado = reservado - ln.cantidad
     WHERE colegio_id = ln.colegio_id AND libro_id = ln.libro_id;
    INSERT INTO movimiento_inventario (colegio_id, libro_id, tipo, cantidad, referencia, usuario_id, fecha)
    VALUES (ln.colegio_id, ln.libro_id, 'VENTA_ENTREGA', -ln.cantidad, ln.codigo, ln.usuario_id, fecha_ent);
    INSERT INTO entrega (venta_detalle_id, cantidad, usuario_id, fecha) VALUES (ln.id, ln.cantidad, ln.usuario_id, fecha_ent);
    UPDATE venta_detalle SET estado = 'ENTREGADO', cantidad_entregada = cantidad WHERE id = ln.id;
  END LOOP;

  -- Pendientes de más de 12 días: la mayoría ya llegó (traslado o proveedor) y se entregó.
  FOR ln IN
    SELECT dt.id, dt.libro_id, dt.cantidad, dt.estado, dt.colegio_origen_id AS origen, v.colegio_id,
           v.fecha, v.usuario_id, v.codigo, to_char(v.fecha, 'IYYY-IW') AS semana
      FROM venta_detalle dt JOIN venta v ON v.id = dt.venta_id
     WHERE dt.estado IN ('PENDIENTE_TRASLADO','PENDIENTE_PROVEEDOR') AND v.estado_pago = 'PAGADA'
       AND v.fecha < now() - interval '12 days'
     ORDER BY v.fecha
  LOOP
    CONTINUE WHEN random() > 0.85;
    fecha_ent := ln.fecha + (4 + floor(random() * 6)) * interval '1 day';
    IF ln.estado = 'PENDIENTE_TRASLADO' THEN
      SELECT existencia - reservado INTO disp FROM inventario WHERE colegio_id = ln.origen AND libro_id = ln.libro_id;
      CONTINUE WHEN coalesce(disp, 0) < ln.cantidad;
      SELECT id INTO tid FROM traslado
       WHERE origen_id = ln.origen AND destino_id = ln.colegio_id AND estado = 'RECIBIDO'
         AND observacion = 'Semana ' || ln.semana;
      IF tid IS NULL THEN
        INSERT INTO traslado (origen_id, destino_id, estado, observacion, usuario_id, creado_en, despachado_en,
                              recibido_en, recibido_por)
        VALUES (ln.origen, ln.colegio_id, 'RECIBIDO', 'Semana ' || ln.semana, v_contador,
                fecha_ent - interval '2 days', fecha_ent - interval '1 day', fecha_ent - interval '2 hours', v_contador)
        RETURNING id INTO tid;
      END IF;
      INSERT INTO traslado_detalle (traslado_id, libro_id, cantidad, recibido) VALUES (tid, ln.libro_id, ln.cantidad, ln.cantidad)
      ON CONFLICT (traslado_id, libro_id) DO UPDATE SET cantidad = traslado_detalle.cantidad + EXCLUDED.cantidad,
                                                        recibido = traslado_detalle.recibido + EXCLUDED.recibido;
      UPDATE inventario SET existencia = existencia - ln.cantidad WHERE colegio_id = ln.origen AND libro_id = ln.libro_id;
      INSERT INTO movimiento_inventario (colegio_id, libro_id, tipo, cantidad, referencia, usuario_id, fecha)
      VALUES (ln.origen, ln.libro_id, 'TRASLADO_SALIDA', -ln.cantidad, 'T-' || tid, v_contador, fecha_ent - interval '1 day');
      INSERT INTO movimiento_inventario (colegio_id, libro_id, tipo, cantidad, referencia, usuario_id, fecha)
      VALUES (ln.colegio_id, ln.libro_id, 'TRASLADO_ENTRADA', ln.cantidad, 'T-' || tid, v_contador, fecha_ent - interval '2 hours');
      UPDATE venta_detalle SET traslado_id = tid WHERE id = ln.id;
    ELSE
      SELECT id INTO pid FROM pedido_proveedor
       WHERE colegio_destino_id = ln.colegio_id AND estado = 'RECIBIDO' AND observacion = 'Semana ' || ln.semana;
      IF pid IS NULL THEN
        INSERT INTO pedido_proveedor (proveedor_id, colegio_destino_id, estado, observacion, usuario_id, creado_en, actualizado_en)
        VALUES ((SELECT id FROM proveedor ORDER BY id LIMIT 1), ln.colegio_id, 'RECIBIDO', 'Semana ' || ln.semana,
                v_contador, fecha_ent - interval '4 days', fecha_ent - interval '2 hours')
        RETURNING id INTO pid;
      END IF;
      INSERT INTO pedido_proveedor_detalle (pedido_id, libro_id, solicitado, recibido) VALUES (pid, ln.libro_id, ln.cantidad, ln.cantidad)
      ON CONFLICT (pedido_id, libro_id) DO UPDATE SET solicitado = pedido_proveedor_detalle.solicitado + EXCLUDED.solicitado,
                                                      recibido = pedido_proveedor_detalle.recibido + EXCLUDED.recibido;
      INSERT INTO movimiento_inventario (colegio_id, libro_id, tipo, cantidad, referencia, usuario_id, fecha)
      VALUES (ln.colegio_id, ln.libro_id, 'PROVEEDOR_ENTRADA', ln.cantidad, 'P-' || pid, v_contador, fecha_ent - interval '2 hours');
      UPDATE venta_detalle SET pedido_proveedor_id = pid WHERE id = ln.id;
    END IF;
    -- Llegó y se entregó al cliente (existencia neta sin cambio en el destino)
    INSERT INTO movimiento_inventario (colegio_id, libro_id, tipo, cantidad, referencia, usuario_id, fecha)
    VALUES (ln.colegio_id, ln.libro_id, 'VENTA_ENTREGA', -ln.cantidad, ln.codigo, ln.usuario_id, fecha_ent);
    INSERT INTO entrega (venta_detalle_id, cantidad, usuario_id, fecha) VALUES (ln.id, ln.cantidad, ln.usuario_id, fecha_ent);
    UPDATE venta_detalle SET estado = 'ENTREGADO', cantidad_entregada = cantidad, colegio_origen_id = NULL WHERE id = ln.id;
  END LOOP;

  -- Estado de entrega de todas las ventas, según sus líneas
  UPDATE venta v SET estado_entrega = x.estado
    FROM (SELECT venta_id,
                 CASE WHEN bool_and(estado IN ('ENTREGADO','ANULADO')) THEN 'COMPLETA'
                      WHEN bool_or(estado = 'ENTREGADO') THEN 'PARCIAL' ELSE 'PENDIENTE' END::estado_entrega_venta AS estado
            FROM venta_detalle GROUP BY venta_id) x
   WHERE x.venta_id = v.id AND v.estado_pago = 'PAGADA';

  -- ---------- 6. Algo ya en camino: un pedido solicitado para parte de lo pendiente ----------
  SELECT dt.libro_id, v.colegio_id INTO l FROM venta_detalle dt JOIN venta v ON v.id = dt.venta_id
   WHERE dt.estado = 'PENDIENTE_PROVEEDOR' AND v.estado_pago = 'PAGADA'
   GROUP BY dt.libro_id, v.colegio_id ORDER BY sum(dt.cantidad) DESC LIMIT 1;
  IF FOUND THEN
    INSERT INTO pedido_proveedor (proveedor_id, colegio_destino_id, estado, observacion, usuario_id, creado_en)
    VALUES ((SELECT id FROM proveedor WHERE nombre = 'Oxford University Press GT'), l.colegio_id, 'SOLICITADO',
            'Pedido urgente (prueba)', v_contador, now() - interval '2 days')
    RETURNING id INTO pid;
    WITH sel AS (
      SELECT dt.id FROM venta_detalle dt JOIN venta v ON v.id = dt.venta_id
       WHERE dt.estado = 'PENDIENTE_PROVEEDOR' AND dt.libro_id = l.libro_id AND v.colegio_id = l.colegio_id
         AND v.estado_pago = 'PAGADA'
       ORDER BY v.fecha LIMIT 4
    ), upd AS (
      UPDATE venta_detalle SET estado = 'EN_PEDIDO', pedido_proveedor_id = pid WHERE id IN (SELECT id FROM sel)
      RETURNING cantidad
    )
    INSERT INTO pedido_proveedor_detalle (pedido_id, libro_id, solicitado)
    SELECT pid, l.libro_id, sum(cantidad) FROM upd HAVING sum(cantidad) > 0;
  END IF;

  INSERT INTO parametro (clave, valor, descripcion)
  VALUES ('demo_historial', to_char(now(), 'YYYY-MM-DD HH24:MI'), 'Historial de prueba cargado (solo desarrollo)');
END $$;

COMMIT;

SELECT co.nombre AS colegio,
       count(*) FILTER (WHERE v.estado_pago = 'PAGADA') AS ventas,
       sum(v.total) FILTER (WHERE v.estado_pago = 'PAGADA') AS total,
       count(*) FILTER (WHERE v.estado_pago = 'ANULADA') AS anuladas,
       count(*) FILTER (WHERE v.estado_entrega <> 'COMPLETA' AND v.estado_pago = 'PAGADA') AS con_pendientes
  FROM venta v JOIN colegio co ON co.id = v.colegio_id
 GROUP BY co.nombre ORDER BY co.nombre;
