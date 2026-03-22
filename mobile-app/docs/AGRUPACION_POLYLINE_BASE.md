# Agrupación por polyline base (rebase por extensión)

Lógica acordada: rebase por **extensión** de la base actual (no “polyline similar” genérica). Todo basado en **OSRM polyline**. Filtro por ciudad/origen para manejar varias agrupaciones.

---

## 1. Rebase válido solo por extensión de la base actual

**No** se usa “polyline similar” genérica ni “extremos cerca” como criterio (evita falsos positivos).

Una **nueva polyline puede reemplazar la base** del grupo **solo si** cumple **las tres** condiciones:

| Condición | Descripción |
|-----------|-------------|
| **1. Mantiene el origen de la base actual** | El **inicio** de la nueva ruta queda **anclado al origen anterior** (o dentro de un umbral muy corto, ej. ≤ 500 m). No vale una ruta que empiece en otro lado aunque “vaya parecido”. |
| **2. Solapa la polyline actual en el tramo compartido** | La nueva ruta **recorre el mismo corredor** que la base actual en la parte común. Tiene que haber **solapamiento real** del trazado (p. ej. distancia punto a punto de la nueva polyline a la base, a lo largo del tramo compartido, bajo un umbral). No alcanza con que los extremos sean parecidos. |
| **3. Extiende la ruta más allá del destino actual** | El **nuevo destino** cae **“después”** del destino anterior sobre la misma progresión. Es decir, la nueva polyline es una **prolongación hacia adelante** de la base, no una variante lateral ni una ruta recortada. |

En resumen, **“misma ruta” para rebase** significa:

- **Mismo origen lógico** (anclado al actual).
- **Mismo corredor** en el tramo compartido (solapamiento real).
- **Nuevo final** que **prolonga** el recorrido existente.

**Después del rebase:**

- Se **revalida** cada miembro del grupo contra la **nueva** base:
  - Distancia al corredor ≤ 2 km.
  - Orden correcto sobre la ruta (recogida antes que destino).
- Si un miembro **no cumple**: se **saca del grupo** o se **reasigna a otro grupo compatible** si existe.

---

## 2. Fecha y hora — exacto

- Agrupación también por **requested_date** (y opcional ventana de hora).
- Sin esto se mezclarían “misma ruta, otro día”.

---

## 3. Tope 15 y varias agrupaciones — exacto

- Máximo **15 usuarios por grupo**.
- **Si se llena** → se **crea otra agrupación** (nueva base o misma lógica con otro grupo).
- Habrá **varias agrupaciones** porque las polylines no serán idénticas (distintos orígenes/destinos, distintas fechas, etc.).

**Ayuda al sistema para filtrar por ciudad (origen):**

- Como habrá muchas agrupaciones, el listado debe poder **filtrarse por ciudad (y departamento/barrio)** del **origen** (y opcionalmente destino).
- Formas de soportarlo:
  - **Guardar en cada solicitud y en cada grupo** la **descripción de ciudad** (y opcional barrio) del origen (y destino), ej. `origin_city`, `origin_department`, `origin_barrio` (y lo mismo para destino). Al listar agrupaciones, el backend filtra por `origin_city` (y opcional barrio). Así el pasajero/conductor elige “Asunción” o “San Lorenzo” y solo ve rutas cuyo **origen** está en esa ciudad.
  - **Índice/etiqueta por grupo:** Cada grupo tiene `origin_city`, `destination_city` (y opcional barrio) derivados de la polyline base (reverse geocode del primer y último punto, o de la solicitud base). El listado de “rutas con demanda” acepta filtros `origin_city`, `origin_barrio` (opcional), `destination_city`, etc., y devuelve solo grupos que coincidan.
- Con eso el sistema **filtra por ciudad los puntos de origen** (y opcional barrio) y reduce la lista a lo relevante.

---

## 4. Todo basado en OSRM polyline — exacto

- Cada polyline (por solicitud y base de grupo) se obtiene vía **OSRM** (`/api/route/polyline` o equivalente).
- Longitud, solapamiento y “extensión” se calculan sobre esas polylines (distancias a lo largo de la línea, posición relativa, etc.).

---

## 5. Guardar con descripción de ciudad; barrio opcional — exacto

- Se guarda con **descripción de ciudad**, ej. **"San Lorenzo - Asunción"** (origen - destino a nivel ciudad).
- **Barrio opcional** (para el pasajero y para el filtro): si está disponible (reverse geocode o búsqueda), se guarda; el filtro por barrio es opcional.

---

## 6. Carga de datos al generar la solicitud — exacto

- **En el momento de generar la solicitud la carga el usuario**: origen, destino (y paradas si aplica), fecha, etc. A partir de eso se genera la polyline (OSRM) y se asigna/crea agrupación.

---

## 7. Pasajeros ven agrupaciones y marcan puntos — OK

- Listado de rutas con demanda (filtrable por ciudad/origen/barrio) → detalle con mapa (polyline base + puntos de pasajeros) → el pasajero marca recogida y destino → validación ≤2 km y orden → alta en el grupo o solicitud vinculada.

---

## 8. Orden recogida/bajada — OK

- Recogida antes que destino sobre la polyline base; validación con `getPositionAlongPolyline` (o equivalente) al agregar al grupo.

---

## 9. Resumen de criterios de rebase (recordatorio)

- **No** usar solo “extremos cerca”.
- **Sí** usar:
  1. Origen nuevo **anclado** al origen actual (umbral corto).
  2. **Solapamiento real** del trazado en el tramo compartido.
  3. **Extensión forward** del destino (nuevo destino “después” del actual).
- Luego: revalidar todos los miembros contra la nueva base (≤2 km, orden); sacar o reasignar a quien no cumpla.

---

## 10. Filtro por ciudad (origen) — resumen

- **Problema:** Hay muchas agrupaciones; hay que poder filtrar.
- **Solución:** Cada solicitud y cada grupo tienen **origen/destino con descripción de ciudad** (ej. San Lorenzo, Asunción); **barrio opcional**. Al listar agrupaciones, el backend filtra por **ciudad de origen** (y opcional barrio). El usuario elige ciudad (y opcional barrio) y solo ve rutas cuyo origen está en esa ciudad.

---

## 11. Decisiones cerradas A–J (implementable)

Las decisiones concretas están en **`AGRUPACION_DECISIONES_A_J.md`**. Resumen:

| # | Tema | Pregunta / decisión |
|---|------|----------------------|
| **A** | **Umbral “origen anclado”** | ¿Qué distancia máxima entre el **inicio de la nueva polyline** y el **origen de la base** para considerar que “mantiene el origen”? (Ej. 500 m, 1 km.) |
| **B** | **Umbral de solapamiento** | En el tramo compartido, ¿qué distancia punto-a-polyline se acepta para decir que la nueva ruta “recorre el mismo corredor”? ¿Los mismos 2 km del corredor de pasajeros o un umbral más estricto (ej. 500 m)? |
| **C** | **“Extiende destino” en números** | ¿Cómo se mide “el nuevo destino cae después del actual”? Propuesta: posición del **último punto de la nueva polyline** sobre la **base actual** > posición del **destino actual** (o sobre la nueva polyline: el nuevo destino está más adelante que el destino de la base proyectado). Definir si se usa la base actual o la nueva para medir posición y con qué tolerancia. |
| **D** | **Algoritmo de solapamiento** | Cómo se calcula “solapa en el tramo compartido”: p. ej. tomar puntos de la nueva polyline, proyectar sobre la base, ver qué fracción de la base queda cubierta (o qué fracción de la nueva está a menos de X m de la base). Hace falta una regla concreta (ej. “≥ 70 % de la longitud de la base tiene algún punto de la nueva a &lt; 500 m”). |
| **E** | **Conductor publica viaje para un grupo** | Cuando el conductor “agarra” una ruta agrupada y publica un viaje: ¿las solicitudes de ese grupo se marcan como **aceptadas/vinculadas** (y salen del listado de demanda)? ¿O siguen visibles hasta que cada pasajero confirme? Definir transición grupo → ride (estado de las `trip_requests`). |
| **F** | **Cancelación de la solicitud que era base** | Si quien tenía la polyline **base** del grupo **cancela**, ¿se recalcula la base entre las solicitudes que quedan (elegir la polyline más larga que siga cumpliendo extensión respecto al resto) y se revalida el grupo? |
| **G** | **Ventana de hora** | ¿Misma **requested_date** pero **requested_time** distinta (ej. 06:00 vs 18:00) = **mismo grupo** o **grupos distintos**? (Ej. “misma ruta, mismo día, cualquier hora” vs “misma ruta, mismo día, misma franja de 2 h”). |
| **H** | **Varios grupos con misma “ruta” (ej. ambos 15/15)** | Cuando hay dos agrupaciones con la misma base (o base muy parecida) y misma fecha porque la primera se llenó: ¿cómo se muestran en el listado? (Ej. “Asunción → CDE, 15 mar, 15/15” y “Asunción → CDE, 15 mar, 3/15” con etiqueta “Grupo 2” o “Segunda salida”.) |
| **I** | **Filtro por destino** | ¿El listado de agrupaciones filtra solo por **ciudad de origen** (y barrio) o también por **ciudad de destino**? (Ej. “Origen: Asunción, Destino: Ciudad del Este”.) |
| **J** | **Origen de barrio** | ¿De dónde sale el barrio: reverse geocode (Nominatim `address.neighbourhood` o similar) al guardar origen/destino, o el usuario lo elige de una lista? |

**Decisiones A–J cerradas:** ver **`AGRUPACION_DECISIONES_A_J.md`** (umbrales 500 m, extensión ≥ 1 km, solapamiento 80 %, estados provisionales, ventana 90 min, Salida 1/2, filtro origen+destino, barrio por geocode + manual). MVP: 500 m para base; 2 km solo para pertenencia al grupo.
