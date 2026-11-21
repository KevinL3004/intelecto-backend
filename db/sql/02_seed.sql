-- =====================================================================
-- SVI - Datos semilla v1.0
-- Usuario inicial: admin SIN contraseña utilizable (no puede entrar hasta que se le asigne una).
-- Asignarla con:  npm run usuario:password -- admin     (pide la contraseña sin mostrarla)
-- =====================================================================
INSERT INTO persona (nombres, apellidos, nit) VALUES ('Administrador', 'Sistema', 'CF');
INSERT INTO persona (nombres, apellidos, nit) VALUES ('Consumidor', 'Final', 'CF');  -- cliente genérico CF

INSERT INTO usuario (persona_id, username, password_hash, rol, debe_cambiar_password)
VALUES (1, 'admin', '!', 'ADMIN', true);  -- '!' no es un hash bcrypt válido: nadie puede entrar con él

INSERT INTO metodo_pago (codigo, nombre, recargo_pct, requiere_referencia) VALUES
  ('EFECTIVO',      'Efectivo',      0, false),
  ('TARJETA',       'Tarjeta',       5, true),
  ('TRANSFERENCIA', 'Transferencia', 0, true);

INSERT INTO denominacion (valor, tipo, orden) VALUES
  (200,'BILLETE',1),(100,'BILLETE',2),(50,'BILLETE',3),(20,'BILLETE',4),
  (10,'BILLETE',5),(5,'BILLETE',6),(1,'BILLETE',7),
  (1,'MONEDA',8),(0.50,'MONEDA',9),(0.25,'MONEDA',10),(0.10,'MONEDA',11),(0.05,'MONEDA',12),(0.01,'MONEDA',13);

INSERT INTO grado (nombre, nivel, orden) VALUES
  ('Prekínder','PREPRIMARIA',1),('Kínder','PREPRIMARIA',2),('Preparatoria','PREPRIMARIA',3),
  ('1.º primaria','PRIMARIA',4),('2.º primaria','PRIMARIA',5),('3.º primaria','PRIMARIA',6),
  ('4.º primaria','PRIMARIA',7),('5.º primaria','PRIMARIA',8),('6.º primaria','PRIMARIA',9),
  ('1.º básico','BASICOS',10),('2.º básico','BASICOS',11),('3.º básico','BASICOS',12),
  ('4.º diversificado','DIVERSIFICADO',13),('5.º diversificado','DIVERSIFICADO',14),('6.º diversificado','DIVERSIFICADO',15);

INSERT INTO parametro (clave, valor, descripcion) VALUES
  ('ciclo_actual',            '2027', 'Ciclo escolar vigente para precios y combos'),
  ('nombre_empresa',          'Intelecto', 'Nombre en comprobantes'),
  ('nit_empresa',             'CF', 'NIT del emisor (FEL fase 2)'),
  ('dias_vencimiento_pedido', '7', 'Días para que venza un pedido del portal sin pago (fase 2)'),
  ('monto_minimo_nit',        '2500', 'Monto desde el cual se exige NIT (FEL fase 2)');
