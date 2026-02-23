-- Script para crear una ruta de ejemplo
-- Ajusta las coordenadas según tu ubicación

INSERT INTO routes (name, direction, polyline, active)
VALUES (
  'Ruta Principal',
  'Norte-Sur',
  '[
    {"lat": -34.6037, "lng": -58.3816},
    {"lat": -34.6040, "lng": -58.3820},
    {"lat": -34.6045, "lng": -58.3825},
    {"lat": -34.6050, "lng": -58.3830},
    {"lat": -34.6055, "lng": -58.3835}
  ]'::jsonb,
  true
)
ON CONFLICT DO NOTHING;

-- Verificar que se creó
SELECT * FROM routes WHERE active = true;

