# Decisiones cerradas A–J: agrupación por polyline base

Especificación implementable. Reglas de **similitud de base** (rebase) separadas de las de **pertenencia al grupo** (2 km para pasajeros).

---

## Resumen ejecutivo (reglas listas para implementar)

| Letra | Regla |
|-------|--------|
| **A** | Origen anclado: inicio de la nueva polyline a **≤ 500 m** del origen de la base actual. |
| **B** | Mismo corredor en tramo compartido: distancia punto–polyline **≤ 500 m** (más estricto que los 2 km de pasajeros). |
| **C** | Extensión de destino: nuevo destino debe avanzar **al menos 1 km** más allá del destino actual (sobre la nueva polyline). |
| **D** | Solapamiento válido si **≥ 80 %** de la base cae a **≤ 500 m** de la nueva polyline en el tramo compartido y **desviación máxima ≤ 1 km**. |
| **E** | Al publicar viaje para un grupo: solicitudes quedan **vinculadas provisionalmente** (ej. `group_linked_pending`); salen de demanda abierta; si el viaje se confirma quedan asociadas, si se cancela vuelven a demanda. |
| **F** | Si la base cancela: **recalcular base** entre las que quedan y **revalidar** todo el grupo; sacar o reasignar a quien no cumpla. |
| **G** | Ventana de hora: misma fecha pero **diferencia > 90 min** → **grupo distinto**. ≤ 90 min → mismo grupo potencial. |
| **H** | Varios grupos misma ruta: mostrar como **Salida 1 / Salida 2** (si cambia la hora) o **Grupo 1 / Grupo 2** (si por capacidad). |
| **I** | Filtrar por **origen y por destino** (ciudad/zona); barrio de destino opcional o secundario. |
| **J** | Barrio: **reverse geocode automático** (Nominatim); si falla o es ambiguo, **corrección manual** desde lista. |

---

## A. Umbral “origen anclado”

- **Valor:** **500 m**
- **Regla:** El inicio de la nueva polyline debe estar a **≤ 500 m** del origen de la base actual.
- **Motivo:** 1 km permite demasiado corrimiento; 500 m mantiene el grupo anclado al mismo arranque operativo.

---

## B. Umbral de solapamiento

- **Valor:** **500 m**
- **Regla:** En el tramo compartido, considerar “mismo corredor” si la distancia punto–polyline es **≤ 500 m**.
- **Motivo:** Para rebase debe ser más estricto que el umbral de pasajeros (2 km). 2 km sirve para compatibilidad operativa; 500 m para “es la misma ruta base”.

---

## C. “Extiende destino” en números

- **Regla:**
  1. Proyectar el **destino actual** sobre la **nueva** polyline → `old_dest_progress` (metros desde inicio).
  2. El **nuevo destino** es el último punto de la nueva polyline → `new_dest_progress` (longitud total de la nueva).
  3. Aceptar extensión solo si: **`new_dest_progress > old_dest_progress + 1000`** (avance de al menos 1 km).
- **Motivo:** Evita aceptar microcambios o ruido GPS como “extensión real”.

---

## D. Algoritmo de solapamiento

- **Regla:** La nueva polyline es válida para rebase si:
  1. **overlap_ratio ≥ 80 %:** Al menos 80 % de los puntos muestreados de la **base actual** caen a **≤ 500 m** de la nueva polyline, en el tramo compartido.
  2. **shared_corridor_distance ≤ 500 m:** Distancia típica en el tramo compartido bajo ese umbral.
  3. **max_deviation ≤ 1000 m:** La desviación máxima en el tramo compartido no supera 1 km (evita promedios buenos con desvíos grandes).
- **Resumen:** overlap_ratio ≥ 80 %, corridor ≤ 500 m, max_deviation ≤ 1 km.

---

## E. Conductor publica para un grupo

- **Decisión:** Al publicar el viaje para un grupo:
  - Las solicitudes del grupo quedan **vinculadas provisionalmente**.
  - Dejan de mostrarse como demanda abierta general.
  - Pasan a estado tipo **`group_linked_pending`** o **`assigned_to_trip_pending`**.
- **Luego:**
  - Si el viaje se **confirma/publica** bien → quedan asociadas al ride.
  - Si el viaje se **cancela o falla** → vuelven a demanda abierta.
- **Motivo:** Evita duplicados y confusión, pero no las “quema” hasta que el viaje exista de verdad.

---

## F. Cancelación de la base

- **Decisión:** **Sí**, recalcular base entre las que quedan y revalidar el grupo.
- **Orden:**
  1. Quitar la solicitud que era base.
  2. Elegir **nueva base** entre las restantes (polyline más larga que cumpla extensión respecto al resto).
  3. **Revalidar** a todos contra la nueva base (≤ 2 km, orden).
  4. Sacar o reasignar a los que ya no cumplan.
- **Motivo:** El grupo no debe morir porque canceló quien originó la base; sí debe conservar consistencia geométrica.

---

## G. Ventana de hora

- **Decisión:** **Grupos distintos** si la diferencia de hora supera **90 minutos**.
- **Regla:** Misma fecha, pero:
  - Diferencia **≤ 90 min** → mismo grupo potencial (ej. 06:00 y 06:45).
  - Diferencia **> 90 min** → grupos distintos (ej. 06:00 y 08:00, o 06:00 y 18:00).
- **Motivo:** El grupo debe reflejar compatibilidad operativa real, no solo coincidencia de día.

---

## H. Varios grupos misma ruta

- **Decisión:** Mostrar como:
  - **“Ruta X — Salida 1”** / **“Ruta X — Salida 2”** cuando cambia principalmente la **hora** (más comercial para el usuario).
  - **“Ruta X — Grupo 1”** / **“Ruta X — Grupo 2”** cuando coexisten por **capacidad** o partición interna (más interno).
- **Lógica práctica:** Si cambia sobre todo la hora → Salida 1 / Salida 2. Si es por llenado de capacidad → Grupo 1 / Grupo 2.

---

## I. Filtro por destino

- **Decisión:** Filtrar por **origen y también por destino**.
- **Fuerza:** Origen = filtro fuerte; destino = filtro fuerte a nivel **ciudad/zona principal**; **barrio de destino** = opcional o secundario.
- **Regla práctica:** Mismo corredor de origen + misma ciudad/zona de destino; opcionalmente mismo barrio de destino o barrio cercano.
- **Motivo:** Dos personas pueden salir del mismo lugar pero ir a destinos incompatibles; sin filtro de destino se agrupa demasiado y mal.

---

## J. Origen del barrio

- **Decisión:** **Primero** reverse geocode automático; **si falla o es ambiguo**, permitir **corrección del usuario** desde lista.
- **Orden:**
  1. Guardar coords.
  2. Hacer reverse geocode (Nominatim).
  3. Completar ciudad/barrio automáticamente.
  4. Si falta o viene raro, permitir **edición manual**.
- **Motivo:** Automático reduce fricción; edición manual resuelve errores de geocoding en Paraguay.

---

## Recomendación MVP

- **500 m** como regla fuerte para **base** (origen anclado y solapamiento).
- **2 km** solo para **compatibilidad de pasajeros** (pertenencia al grupo), no para decidir rebase.
- Separar siempre:
  - **Reglas de similitud de base** (rebase): 500 m, solapamiento 80 %, extensión ≥ 1 km.
  - **Reglas de pertenencia al grupo**: 2 km al corredor, orden recogida/bajada.

Con esto la especificación queda cerrada e implementable.
