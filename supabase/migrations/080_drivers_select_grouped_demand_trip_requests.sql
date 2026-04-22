-- Conductores y admins deben poder leer pedidos en fase "demanda agrupada" (status grouped / grouping / group_linked_pending)
-- con demand_group_id, para que la app (RLS + Supabase anon) pueda armar paradas y montos sin depender solo de la API.
-- Antes solo existía SELECT para conductores con status = 'pending', por eso el detalle de ruta con demanda quedaba vacío.

CREATE POLICY "Drivers and admins can view grouped demand trip_requests"
  ON public.trip_requests
  FOR SELECT
  USING (
    demand_group_id IS NOT NULL
    AND status IN ('grouping', 'grouped', 'group_linked_pending')
    AND (
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('driver', 'admin'))
    )
  );

COMMENT ON POLICY "Drivers and admins can view grouped demand trip_requests" ON public.trip_requests IS
  'Permite al conductor ver origen/destino/monto de pasajeros ya agrupados en demand_route_groups (vía demand_group_id).';
