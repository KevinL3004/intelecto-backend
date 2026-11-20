-- =====================================================================
-- SVI - Datos de PRUEBA (solo desarrollo local). NUNCA ejecutar en producción.
-- Se puede ejecutar varias veces: no duplica registros.
--
--   docker exec -i intelecto_postgres psql -U intelecto -d intelecto < db/sql/demo/03_datos_prueba.sql
--
-- Usuarios (contraseña de todos: Prueba2026!)
--   contador     CONTADOR  (sin colegio: consulta todo)
--   cajero.norte CAJERO    Colegio Norte
--   cajero.sur   CAJERO    Colegio Sur
-- =====================================================================
BEGIN;

-- ---------- Colegios ----------
INSERT INTO colegio (codigo, nombre, direccion, telefono) VALUES
  ('COL-NORTE', 'Colegio Norte', 'Zona 18, Guatemala', '2222-1001'),
  ('COL-SUR',   'Colegio Sur',   'Villa Nueva',        '2222-2002')
ON CONFLICT (codigo) DO NOTHING;

-- ---------- Usuarios de prueba (persona + usuario) ----------
CREATE TEMP TABLE _u (username text, nombres text, apellidos text, rol rol_usuario, colegio text) ON COMMIT DROP;
INSERT INTO _u VALUES
  ('contador',     'Carla',  'Contreras (prueba)', 'CONTADOR', NULL),
  ('cajero.norte', 'Nora',   'Pérez (prueba)',     'CAJERO',   'COL-NORTE'),
  ('cajero.sur',   'Samuel', 'López (prueba)',     'CAJERO',   'COL-SUR');

WITH nuevas AS (
  INSERT INTO persona (nombres, apellidos, nit, creado_por)
  SELECT nombres, apellidos, 'CF', 1 FROM _u
   WHERE NOT EXISTS (SELECT 1 FROM usuario x WHERE x.username = _u.username)
  RETURNING id, nombres, apellidos
)
INSERT INTO usuario (persona_id, username, password_hash, rol, colegio_id, debe_cambiar_password, creado_por)
SELECT n.id, u.username,
       '$2a$10$UiDpm5Cr5hdX/2Q4NJhOKe7oSIQ38JpsAnYGt4D0xtKyq1mPEWw2i',  -- Prueba2026!
       u.rol, c.id, false, 1
  FROM nuevas n
  JOIN _u u ON u.nombres = n.nombres AND u.apellidos = n.apellidos
  LEFT JOIN colegio c ON c.codigo = u.colegio;

-- ---------- Clientes ----------
INSERT INTO persona (nombres, apellidos, nit, telefono, correo, creado_por)
SELECT v.* FROM (VALUES
  ('María',  'García Ruiz',   '1234567K', '5555-1111', 'maria.garcia@ejemplo.com', 1::bigint),
  ('José',   'Hernández',     'CF',       '5555-2222', NULL,                       1::bigint),
  ('Ana',    'Morales Díaz',  '9876543',  NULL,        'ana.morales@ejemplo.com',  1::bigint)
) AS v(nombres, apellidos, nit, telefono, correo, creado_por)
WHERE NOT EXISTS (SELECT 1 FROM persona p WHERE p.nombres = v.nombres AND p.apellidos = v.apellidos);

-- ---------- Cajas ----------
INSERT INTO caja (colegio_id, numero, fondo_asignado)
SELECT c.id, v.numero, v.fondo FROM (VALUES
  ('COL-NORTE', 1, 500.00), ('COL-NORTE', 2, 300.00), ('COL-SUR', 1, 500.00)
) AS v(colegio, numero, fondo)
JOIN colegio c ON c.codigo = v.colegio
ON CONFLICT (colegio_id, numero) DO NOTHING;

-- ---------- Libros ----------
INSERT INTO libro (isbn, titulo, editorial, creado_por) VALUES
  ('978-9929-100-01-1', 'Matemática Activa 1',     'Santillana', 1),
  ('978-9929-100-02-8', 'Comunicación y Lenguaje 1','Santillana', 1),
  ('978-9929-100-03-5', 'Ciencias Naturales 1',    'Norma',      1),
  ('978-9929-100-04-2', 'Matemática Activa 2',     'Santillana', 1),
  ('978-9929-100-05-9', 'Comunicación y Lenguaje 2','Santillana', 1),
  ('978-9929-100-06-6', 'Ciencias Naturales 2',    'Norma',      1),
  ('978-9929-100-07-3', 'English Kids 1',          'Oxford',     1),
  ('978-9929-100-08-0', 'English Kids 2',          'Oxford',     1)
ON CONFLICT (isbn) DO NOTHING;

-- ---------- Precios ciclo 2027 (Sur un poco más caro) ----------
INSERT INTO precio_libro (colegio_id, libro_id, ciclo, precio, actualizado_por)
SELECT c.id, l.id, 2027, v.precio + CASE WHEN c.codigo = 'COL-SUR' THEN 10 ELSE 0 END, 1
  FROM (VALUES
    ('978-9929-100-01-1', 145.00), ('978-9929-100-02-8', 135.00), ('978-9929-100-03-5', 120.00),
    ('978-9929-100-04-2', 150.00), ('978-9929-100-05-9', 140.00), ('978-9929-100-06-6', 125.00),
    ('978-9929-100-07-3', 180.00), ('978-9929-100-08-0', 185.00)
  ) AS v(isbn, precio)
  JOIN libro l ON l.isbn = v.isbn
  CROSS JOIN colegio c WHERE c.codigo IN ('COL-NORTE', 'COL-SUR')
ON CONFLICT (colegio_id, libro_id, ciclo) DO NOTHING;

-- ---------- Combos ciclo 2027 ----------
INSERT INTO combo (colegio_id, grado_id, ciclo, nombre, descuento)
SELECT c.id, g.id, 2027, 'Combo ' || g.nombre || ' 2027', v.descuento
  FROM (VALUES ('COL-NORTE', '1.º primaria', 50.00), ('COL-NORTE', '2.º primaria', 50.00),
               ('COL-SUR',   '1.º primaria', 40.00)) AS v(colegio, grado, descuento)
  JOIN colegio c ON c.codigo = v.colegio
  JOIN grado g ON g.nombre = v.grado
ON CONFLICT (colegio_id, grado_id, ciclo) DO NOTHING;

INSERT INTO combo_libro (combo_id, libro_id, cantidad)
SELECT cb.id, l.id, 1
  FROM combo cb JOIN grado g ON g.id = cb.grado_id
  JOIN libro l ON l.isbn = ANY (CASE g.nombre
      WHEN '1.º primaria' THEN ARRAY['978-9929-100-01-1','978-9929-100-02-8','978-9929-100-03-5','978-9929-100-07-3']
      WHEN '2.º primaria' THEN ARRAY['978-9929-100-04-2','978-9929-100-05-9','978-9929-100-06-6','978-9929-100-08-0']
    END)
 WHERE cb.ciclo = 2027
ON CONFLICT (combo_id, libro_id) DO NOTHING;

-- ---------- Inventario inicial (con su movimiento de ingreso) ----------
WITH carga AS (
  SELECT c.id AS colegio_id, l.id AS libro_id, v.cantidad
    FROM (VALUES
      ('COL-NORTE', '978-9929-100-01-1', 40), ('COL-NORTE', '978-9929-100-02-8', 35),
      ('COL-NORTE', '978-9929-100-03-5', 30), ('COL-NORTE', '978-9929-100-07-3', 25),
      ('COL-NORTE', '978-9929-100-04-2', 20), ('COL-SUR',   '978-9929-100-01-1', 15),
      ('COL-SUR',   '978-9929-100-02-8', 12), ('COL-SUR',   '978-9929-100-07-3', 8)
    ) AS v(colegio, isbn, cantidad)
    JOIN colegio c ON c.codigo = v.colegio
    JOIN libro l ON l.isbn = v.isbn
   WHERE NOT EXISTS (SELECT 1 FROM inventario i WHERE i.colegio_id = c.id AND i.libro_id = l.id)
), ins AS (
  INSERT INTO inventario (colegio_id, libro_id, existencia)
  SELECT colegio_id, libro_id, cantidad FROM carga
  RETURNING colegio_id, libro_id, existencia
)
INSERT INTO movimiento_inventario (colegio_id, libro_id, tipo, cantidad, referencia, motivo, usuario_id)
SELECT colegio_id, libro_id, 'INGRESO', existencia, 'CARGA-INICIAL', 'Datos de prueba', 1 FROM ins;

COMMIT;

SELECT u.username, u.rol, coalesce(c.nombre, '—') AS colegio
  FROM usuario u LEFT JOIN colegio c ON c.id = u.colegio_id ORDER BY u.id;
