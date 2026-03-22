export const MAP_STYLE_SOFT: any[] = [
  // Reduce visual noise (Uber-like)
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'simplified' }, { lightness: 35 }] },
  { featureType: 'administrative', elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f7f7f7' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cfe6ff' }] },
];

