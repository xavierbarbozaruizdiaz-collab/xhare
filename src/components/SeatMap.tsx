'use client';

import { buildSeatIdsFromRows, type SeatLayout } from '@/lib/seat-layout';

type SeatMapProps = {
  layout: SeatLayout;
  takenSeatIds?: string[];
  selectedSeatIds?: string[];
  maxSelect?: number;
  onSelect?: (seatIds: string[]) => void;
  /** Solo lectura (ej. en onboarding para mostrar distribución) */
  readOnly?: boolean;
};

export default function SeatMap({
  layout,
  takenSeatIds = [],
  selectedSeatIds = [],
  maxSelect = 1,
  onSelect,
  readOnly = false,
}: SeatMapProps) {
  const rows = layout.rows;
  const seatIds = buildSeatIdsFromRows(rows);
  const takenSet = new Set(takenSeatIds);
  const selectedSet = new Set(selectedSeatIds);

  function toggle(seatId: string) {
    if (readOnly || takenSet.has(seatId)) return;
    if (!onSelect) return;
    const next = selectedSet.has(seatId)
      ? selectedSeatIds.filter((id) => id !== seatId)
      : selectedSeatIds.length >= maxSelect
        ? [...selectedSeatIds.slice(0, -1), seatId]
        : [...selectedSeatIds, seatId];
    onSelect(next);
  }

  const maxCols = Math.max(...rows);

  return (
    <div className="inline-block p-4 bg-gray-100 rounded-xl border border-gray-200">
      {/* Parte delantera del vehículo */}
      <div className="flex justify-center mb-3">
        <div className="w-16 h-8 bg-gray-400 rounded-t-lg flex items-center justify-center text-white text-xs font-medium">
          Frente
        </div>
      </div>
      {/* Filas de asientos */}
      <div className="space-y-2" style={{ width: maxCols * 44 + 32 }}>
        {rows.map((seatCount, rowIndex) => {
          const rowNum = rowIndex + 1;
          return (
            <div key={rowIndex} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-6 text-right">{rowNum}</span>
              <div className="flex gap-1 justify-center" style={{ width: maxCols * 44 }}>
                {Array.from({ length: seatCount }, (_, colIndex) => {
                  const seatId = `${rowNum}${'ABCDEFGHIJ'[colIndex]}`;
                  const taken = takenSet.has(seatId);
                  const selected = selectedSet.has(seatId);
                  return (
                    <button
                      key={seatId}
                      type="button"
                      disabled={readOnly || taken}
                      onClick={() => toggle(seatId)}
                      className={`
                        w-10 h-10 rounded-lg text-xs font-medium transition
                        ${taken ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : ''}
                        ${!taken && selected ? 'bg-green-600 text-white ring-2 ring-green-700' : ''}
                        ${!taken && !selected && !readOnly ? 'bg-white border-2 border-gray-400 hover:border-green-500 hover:bg-green-50' : ''}
                        ${readOnly && !taken ? 'bg-white border-2 border-gray-400' : ''}
                      `}
                      title={taken ? `Ocupado (${seatId})` : selected ? `Elegido (${seatId})` : seatId}
                    >
                      {seatId.slice(-1)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-500 mt-2 text-center">
        {readOnly ? 'Distribución de asientos' : 'Hacé clic para elegir tus asientos'}
        {!readOnly && maxSelect > 1 && ` (máx. ${maxSelect})`}
      </p>
    </div>
  );
}
