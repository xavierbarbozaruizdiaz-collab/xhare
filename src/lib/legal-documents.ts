export type LegalDocumentType = 'terms' | 'privacy';

export const LEGAL_SETTINGS_KEYS = {
  termsContent: 'legal_terms_content',
  termsVersion: 'legal_terms_version',
  privacyContent: 'legal_privacy_content',
  privacyVersion: 'legal_privacy_version',
} as const;

export const DEFAULT_TERMS_VERSION = 'v1.0';
export const DEFAULT_PRIVACY_VERSION = 'v1.0';

export const DEFAULT_TERMS_CONTENT = `# Terminos y Condiciones de ÑandeBus

Ultima actualizacion: {{DATE}}
Version: {{VERSION}}

## 1. Naturaleza del servicio
ÑandeBus opera como plataforma tecnologica de intermediacion entre pasajeros y conductores independientes. ÑandeBus no presta directamente el servicio de transporte.

## 2. Conductores independientes
El conductor es un prestador independiente y responsable de mantener vigente su licencia, habilitacion, cedula verde y seguro aplicable.

## 3. Verificacion y habilitacion
ÑandeBus puede solicitar y validar documentos antes de habilitar conductores. ÑandeBus puede suspender o rechazar cuentas por documentacion incompleta, inconsistente o vencida.

## 4. Uso de la plataforma
El usuario se compromete a brindar informacion veraz, no suplantar identidad y no usar la plataforma para fines ilicitos.

## 5. Pagos y cancelaciones
Las condiciones de precio, comisiones y cancelaciones se informan en la aplicacion y pueden variar segun configuracion vigente.

## 6. Seguridad y conducta
Pasajeros y conductores deben mantener conducta respetuosa y cumplir normas de seguridad y transito.

## 7. Limitacion de responsabilidad
En la maxima medida permitida por la ley aplicable, ÑandeBus no sera responsable por hechos imputables al conductor, pasajero o terceros durante el servicio de transporte.

## 8. Cumplimiento normativo
Este contrato se interpreta conforme a la normativa paraguaya aplicable, incluyendo marco de comercio electronico y defensa del consumidor.

## 9. Modificaciones
ÑandeBus puede actualizar estos terminos. La version vigente se publica en la plataforma y/o landing.

---
Aviso: este texto base es operativo para MVP y debe ser revisado por asesoria legal local antes de escalamiento.`;

export const DEFAULT_PRIVACY_CONTENT = `# Politica de Privacidad de ÑandeBus

Ultima actualizacion: {{DATE}}
Version: {{VERSION}}

## 1. Datos que recopilamos
- Identificacion y contacto del usuario.
- Datos de viaje (origen, destino, horario, reservas).
- Geolocalizacion durante uso de funcionalidades de viaje y tracking.
- Mensajeria interna entre usuarios.
- Documentacion de verificacion de conductores (cuando corresponda).

## 2. Finalidades
Usamos los datos para operar la app, asignar viajes, mejorar seguridad, prevenir fraude, atender soporte y cumplir obligaciones legales.

## 3. Base legal y consentimiento
El uso de la plataforma implica consentimiento para el tratamiento de datos conforme a la normativa paraguaya aplicable y a esta politica.

## 4. Comparticion de datos
Compartimos datos minimos necesarios entre pasajero y conductor para ejecutar viajes. Tambien podemos compartir datos con proveedores tecnologicos y autoridades cuando la ley lo exija.

## 5. Conservacion
Conservamos datos por el plazo necesario para operar, auditar y cumplir obligaciones legales o regulatorias.

## 6. Seguridad
Aplicamos medidas tecnicas y organizativas razonables para proteger la informacion, incluyendo controles de acceso y monitoreo.

## 7. Derechos del titular
El usuario puede solicitar acceso, correccion y actualizacion de datos conforme a la normativa paraguaya vigente.

## 8. Cookies y analitica web
La web puede usar tecnologias de sesion y analitica para funcionamiento y mejora del servicio.

## 9. Cambios
Podemos actualizar esta politica. Publicaremos la version vigente en la plataforma y/o landing.

## 10. Contacto
Para consultas de privacidad, usar el canal oficial informado por ÑandeBus.

---
Aviso: este texto base es operativo para MVP y debe ser revisado por asesoria legal local antes de escalamiento.`;

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

export function interpolateLegalTemplate(template: string, version: string) {
  return template
    .replaceAll('{{DATE}}', todayYmd())
    .replaceAll('{{VERSION}}', version.trim() || 'v1.0');
}
