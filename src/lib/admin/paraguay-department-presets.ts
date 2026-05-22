/**
 * Departamentos de Paraguay (17 + Distrito Capital) para importación de polígonos en admin.
 * Ciudades = cabeceras y localidades habituales en Nominatim; podés ampliar la lista por departamento.
 */

export type ParaguayDepartmentPreset = {
  id: string;
  /** Nombre para el desplegable del admin */
  label: string;
  /** Texto en consultas Nominatim: "{ciudad}, {nominatimDepartment}, Paraguay" */
  nominatimDepartment: string;
  idPrefix: string;
  cities: readonly string[];
  /** Ciudades que se parten en Norte/Sur por latitud media (opcional) */
  splitNorthSouth?: readonly string[];
  /** Solo Central: Asunción Centro / Norte por Mariscal López */
  importAsuncionSplit?: boolean;
  /** Bbox aproximado para crear una fila vacía en `corridors` */
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
};

export const PARAGUAY_DEPARTMENT_PRESETS: Record<string, ParaguayDepartmentPreset> = {
  asuncion: {
    id: 'asuncion',
    label: 'Asunción (Distrito Capital)',
    nominatimDepartment: 'Asunción',
    idPrefix: 'asuncion',
    cities: ['Asunción'],
    importAsuncionSplit: true,
    bbox: { minLat: -25.38, maxLat: -25.22, minLng: -57.68, maxLng: -57.52 },
  },
  central: {
    id: 'central',
    label: 'Central',
    nominatimDepartment: 'Central',
    idPrefix: 'central',
    cities: [
      'Lambare',
      'Fernando de la Mora',
      'San Lorenzo',
      'Luque',
      'Mariano Roque Alonso',
      'Limpio',
      'Nemby',
      'Villa Elisa',
      'Capiata',
      'Itaugua',
      'Ypane',
      'Guarambare',
      'Ita',
      'Aregua',
      'Nueva Italia',
      'Villeta',
      'J. Augusto Saldivar',
      'San Antonio',
    ],
    splitNorthSouth: ['Luque', 'Limpio', 'Aregua', 'Capiata', 'Itaugua', 'Ita', 'Villeta', 'Nueva Italia'],
    importAsuncionSplit: true,
    bbox: { minLat: -25.55, maxLat: -25.12, minLng: -57.75, maxLng: -57.35 },
  },
  alto_parana: {
    id: 'alto_parana',
    label: 'Alto Paraná',
    nominatimDepartment: 'Alto Paraná',
    idPrefix: 'alto-parana',
    cities: [
      'Ciudad del Este',
      'Presidente Franco',
      'Hernandarias',
      'Minga Guazú',
      'Santa Rita',
      'San Alberto',
      "Juan E. O'Leary",
      'Doctor Juan León Mallorquín',
      'Itakyry',
      'Yguazú',
      'Santa Rosa del Monday',
      'Los Cedrales',
      'Naranjal',
      'Mbaracayú',
      'San Cristóbal',
    ],
    splitNorthSouth: ['Ciudad del Este', 'Presidente Franco', 'Hernandarias'],
    bbox: { minLat: -25.65, maxLat: -24.45, minLng: -55.45, maxLng: -54.35 },
  },
  itapua: {
    id: 'itapua',
    label: 'Itapúa',
    nominatimDepartment: 'Itapúa',
    idPrefix: 'itapua',
    cities: [
      'Encarnación',
      'Carmen del Paraná',
      'Fram',
      'Coronel Bogado',
      'Bella Vista Sur',
      'Cambyreta',
      'Capitán Meza',
      'Obligado',
      'Pirapo',
      'General Delgado',
      'Hohenau',
      'Trinidad',
      'Natalio',
      'Edelira',
      'La Paz',
      'Yatytay',
    ],
    splitNorthSouth: ['Encarnación'],
    bbox: { minLat: -27.55, maxLat: -26.35, minLng: -56.55, maxLng: -55.45 },
  },
  amambay: {
    id: 'amambay',
    label: 'Amambay',
    nominatimDepartment: 'Amambay',
    idPrefix: 'amambay',
    cities: ['Pedro Juan Caballero', 'Bella Vista Norte', 'Capitán Bado', 'Karapaí', 'Zanja Pytá'],
    splitNorthSouth: ['Pedro Juan Caballero'],
    bbox: { minLat: -23.15, maxLat: -22.25, minLng: -56.25, maxLng: -55.55 },
  },
  canindeyu: {
    id: 'canindeyu',
    label: 'Canindeyú',
    nominatimDepartment: 'Canindeyú',
    idPrefix: 'canindeyu',
    cities: ['Salto del Guairá', 'Curuguaty', 'Corpus Christi', 'Villa Ygatimí', 'La Paloma', 'Katueté', 'Ypejhú'],
    bbox: { minLat: -24.25, maxLat: -23.65, minLng: -55.85, maxLng: -54.75 },
  },
  concepcion: {
    id: 'concepcion',
    label: 'Concepción',
    nominatimDepartment: 'Concepción',
    idPrefix: 'concepcion',
    cities: ['Concepción', 'Horqueta', 'Loreto', 'Belén', 'San Carlos del Apa', 'Vallemí', 'Yby Yaú'],
    bbox: { minLat: -23.55, maxLat: -22.05, minLng: -58.15, maxLng: -57.05 },
  },
  san_pedro: {
    id: 'san_pedro',
    label: 'San Pedro',
    nominatimDepartment: 'San Pedro',
    idPrefix: 'san-pedro',
    cities: [
      'San Pedro de Ycuamandiyú',
      'Santa Rosa del Aguaray',
      'Choré',
      'Lima',
      'General Elizardo Aquino',
      'Puerto Rosario',
      'Capiibary',
    ],
    bbox: { minLat: -24.35, maxLat: -23.55, minLng: -57.05, maxLng: -55.85 },
  },
  cordillera: {
    id: 'cordillera',
    label: 'Cordillera',
    nominatimDepartment: 'Cordillera',
    idPrefix: 'cordillera',
    cities: [
      'Caacupé',
      'Altos',
      'Arroyos y Esteros',
      'Emboscada',
      'Itacurubí de la Cordillera',
      'Eusebio Ayala',
      'Piribebuy',
      'San Bernardino',
      'Tobatí',
      'Atyrá',
    ],
    bbox: { minLat: -25.55, maxLat: -25.05, minLng: -57.45, maxLng: -56.85 },
  },
  guaira: {
    id: 'guaira',
    label: 'Guairá',
    nominatimDepartment: 'Guairá',
    idPrefix: 'guaira',
    cities: ['Villarrica', 'Coronel Martínez', 'Borja', 'Mbocayaty', 'Independencia', 'Itapé', 'Colonia Independencia'],
    bbox: { minLat: -26.05, maxLat: -25.35, minLng: -56.65, maxLng: -56.05 },
  },
  caaguazu: {
    id: 'caaguazu',
    label: 'Caaguazú',
    nominatimDepartment: 'Caaguazú',
    idPrefix: 'caaguazu',
    cities: [
      'Coronel Oviedo',
      'Caaguazú',
      'Repatriación',
      'San José de los Arroyos',
      'Yhú',
      'Doctor Juan Manuel Frutos',
      'Santa Rosa del Mbutuy',
      'Carayaó',
      'Nueva Londres',
    ],
    bbox: { minLat: -25.55, maxLat: -24.75, minLng: -56.55, maxLng: -55.65 },
  },
  caazapa: {
    id: 'caazapa',
    label: 'Caazapá',
    nominatimDepartment: 'Caazapá',
    idPrefix: 'caazapa',
    cities: ['Caazapá', 'San Juan Bautista de las Misiones', 'Yuty', 'Fulgencio Yegros', 'Buena Vista', 'Tavaí', 'Abaí'],
    bbox: { minLat: -26.65, maxLat: -25.85, minLng: -56.55, maxLng: -55.75 },
  },
  paraguari: {
    id: 'paraguari',
    label: 'Paraguarí',
    nominatimDepartment: 'Paraguarí',
    idPrefix: 'paraguari',
    cities: [
      'Paraguarí',
      'Carapeguá',
      'Quiindy',
      'Yaguarón',
      'Sapucai',
      'Caapucú',
      'Pirayú',
      'Ybycuí',
      'Acahay',
      'La Colmena',
    ],
    bbox: { minLat: -26.05, maxLat: -25.45, minLng: -57.45, maxLng: -56.75 },
  },
  misiones: {
    id: 'misiones',
    label: 'Misiones',
    nominatimDepartment: 'Misiones',
    idPrefix: 'misiones',
    cities: ['San Juan Bautista', 'San Miguel', 'Santa María', 'Santa Rosa', 'Santiago', 'Yabebyry'],
    bbox: { minLat: -27.35, maxLat: -26.65, minLng: -57.35, maxLng: -56.75 },
  },
  neembucu: {
    id: 'neembucu',
    label: 'Ñeembucú',
    nominatimDepartment: 'Ñeembucú',
    idPrefix: 'neembucu',
    cities: ['Pilar', 'Humaitá', 'Ayolas', 'San Juan Bautista de Ñeembucú', 'Villa Oliva', 'Villa Franca', 'Alberdi'],
    bbox: { minLat: -27.25, maxLat: -26.55, minLng: -58.35, maxLng: -57.55 },
  },
  presidente_hayes: {
    id: 'presidente_hayes',
    label: 'Presidente Hayes',
    nominatimDepartment: 'Presidente Hayes',
    idPrefix: 'presidente-hayes',
    cities: ['Villa Hayes', 'Benjamín Aceval', 'Nanawa', 'Pozo Colorado', 'Teniente 1ro Manuel Irala Fernández'],
    bbox: { minLat: -25.55, maxLat: -22.85, minLng: -59.05, maxLng: -57.55 },
  },
  boqueron: {
    id: 'boqueron',
    label: 'Boquerón',
    nominatimDepartment: 'Boquerón',
    idPrefix: 'boqueron',
    cities: ['Filadelfia', 'Loma Plata', 'Mariscal Estigarribia', 'Neuland', 'Menno'],
    bbox: { minLat: -23.55, maxLat: -20.85, minLng: -62.05, maxLng: -58.85 },
  },
  alto_paraguay: {
    id: 'alto_paraguay',
    label: 'Alto Paraguay',
    nominatimDepartment: 'Alto Paraguay',
    idPrefix: 'alto-paraguay',
    cities: ['Fuerte Olimpo', 'Carmelo Peralta', 'Bahía Negra', 'Puerto Casado'],
    bbox: { minLat: -23.15, maxLat: -19.35, minLng: -61.55, maxLng: -57.55 },
  },
};

export type CorridorImportDepartmentId =
  | 'asuncion'
  | 'central'
  | 'alto_parana'
  | 'alto_paraguay'
  | 'amambay'
  | 'boqueron'
  | 'caaguazu'
  | 'caazapa'
  | 'canindeyu'
  | 'concepcion'
  | 'cordillera'
  | 'guaira'
  | 'itapua'
  | 'misiones'
  | 'neembucu'
  | 'paraguari'
  | 'presidente_hayes'
  | 'san_pedro';

export const CORRIDOR_IMPORT_DEPARTMENTS: { id: CorridorImportDepartmentId; label: string }[] = (
  Object.values(PARAGUAY_DEPARTMENT_PRESETS) as ParaguayDepartmentPreset[]
)
  .map((p) => ({ id: p.id as CorridorImportDepartmentId, label: p.label }))
  .sort((a, b) => a.label.localeCompare(b.label, 'es'));

export function isCorridorImportDepartmentId(v: unknown): v is CorridorImportDepartmentId {
  return typeof v === 'string' && v in PARAGUAY_DEPARTMENT_PRESETS;
}

/** Slug de zona metro local sugerido al crear fila en `corridors` */
export function departmentMetroSlug(departmentId: CorridorImportDepartmentId): string {
  return `${departmentId}_metro_local`;
}

export function departmentMetroName(preset: ParaguayDepartmentPreset): string {
  if (preset.id === 'asuncion') return 'Asunción (Distrito Capital) — viaje local';
  return `${preset.label} — viaje local`;
}
