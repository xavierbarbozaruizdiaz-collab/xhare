'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';

export default function TestMigrationPage() {
  const [checks, setChecks] = useState<Record<string, { status: 'checking' | 'ok' | 'error'; message: string }>>({});

  useEffect(() => {
    runChecks();
  }, []);

  async function runChecks() {
    const results: Record<string, { status: 'checking' | 'ok' | 'error'; message: string }> = {};

    // Check 1: Rides table has new columns
    setChecks(prev => ({ ...prev, ridesColumns: { status: 'checking', message: 'Verificando columnas...' } }));
    try {
      const { data, error } = await supabase
        .from('rides')
        .select('origin_lat, origin_lng, origin_label, destination_lat, destination_lng, destination_label, price_per_seat, available_seats')
        .limit(1);

      if (error) {
        const errorMsg = (error && typeof error === 'object' && 'message' in error) ? String(error.message) : String(error || 'Error desconocido');
        if (errorMsg.includes('column') || errorMsg.includes('does not exist')) {
          results.ridesColumns = { status: 'error', message: `❌ Columnas faltantes: ${errorMsg}` };
        } else {
          results.ridesColumns = { status: 'ok', message: '✅ Columnas nuevas existen (error de query normal)' };
        }
      } else {
        results.ridesColumns = { status: 'ok', message: '✅ Todas las columnas nuevas existen en rides' };
      }
    } catch (error: any) {
      const errorMsg = (error && typeof error === 'object' && 'message' in error) ? String(error.message) : String(error || 'Error desconocido');
      results.ridesColumns = { status: 'error', message: `❌ Error: ${errorMsg}` };
    }
    setChecks(prev => ({ ...prev, ...results }));

    // Check 2: Bookings table exists
    setChecks(prev => ({ ...prev, ...results, bookingsTable: { status: 'checking', message: 'Verificando tabla bookings...' } }));
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select('id')
        .limit(1);

      if (error) {
        const errorMsg = (error && typeof error === 'object' && 'message' in error) ? String(error.message) : String(error || 'Error desconocido');
        if (errorMsg.includes('does not exist')) {
          results.bookingsTable = { status: 'error', message: '❌ Tabla bookings no existe' };
        } else {
          results.bookingsTable = { status: 'ok', message: '✅ Tabla bookings existe' };
        }
      } else {
        results.bookingsTable = { status: 'ok', message: '✅ Tabla bookings existe' };
      }
    } catch (error: any) {
      const errorMsg = (error && typeof error === 'object' && 'message' in error) ? String(error.message) : String(error || 'Error desconocido');
      results.bookingsTable = { status: 'error', message: `❌ Error: ${errorMsg}` };
    }
    setChecks(prev => ({ ...prev, ...results }));

    // Check 3: Reviews table exists
    setChecks(prev => ({ ...prev, ...results, reviewsTable: { status: 'checking', message: 'Verificando tabla reviews...' } }));
    try {
      const { data, error } = await supabase
        .from('reviews')
        .select('id')
        .limit(1);

      if (error) {
        const errorMsg = (error && typeof error === 'object' && 'message' in error) ? String(error.message) : String(error || 'Error desconocido');
        if (errorMsg.includes('does not exist')) {
          results.reviewsTable = { status: 'error', message: '❌ Tabla reviews no existe' };
        } else {
          results.reviewsTable = { status: 'ok', message: '✅ Tabla reviews existe' };
        }
      } else {
        results.reviewsTable = { status: 'ok', message: '✅ Tabla reviews existe' };
      }
    } catch (error: any) {
      const errorMsg = (error && typeof error === 'object' && 'message' in error) ? String(error.message) : String(error || 'Error desconocido');
      results.reviewsTable = { status: 'error', message: `❌ Error: ${errorMsg}` };
    }
    setChecks(prev => ({ ...prev, ...results }));

    // Check 4: Messages table exists
    setChecks(prev => ({ ...prev, ...results, messagesTable: { status: 'checking', message: 'Verificando tabla messages...' } }));
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('id')
        .limit(1);

      if (error) {
        const errorMsg = (error && typeof error === 'object' && 'message' in error) ? String(error.message) : String(error || 'Error desconocido');
        if (errorMsg.includes('does not exist')) {
          results.messagesTable = { status: 'error', message: '❌ Tabla messages no existe' };
        } else {
          results.messagesTable = { status: 'ok', message: '✅ Tabla messages existe' };
        }
      } else {
        results.messagesTable = { status: 'ok', message: '✅ Tabla messages existe' };
      }
    } catch (error: any) {
      const errorMsg = (error && typeof error === 'object' && 'message' in error) ? String(error.message) : String(error || 'Error desconocido');
      results.messagesTable = { status: 'error', message: `❌ Error: ${errorMsg}` };
    }
    setChecks(prev => ({ ...prev, ...results }));

    // Check 5: Profiles has new columns
    setChecks(prev => ({ ...prev, ...results, profilesColumns: { status: 'checking', message: 'Verificando columnas de profiles...' } }));
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('avatar_url, bio, rating_average, rating_count, verified')
        .limit(1);

      if (error) {
        const errorMsg = (error && typeof error === 'object' && 'message' in error) ? String(error.message) : String(error || 'Error desconocido');
        if (errorMsg.includes('column') || errorMsg.includes('does not exist')) {
          results.profilesColumns = { status: 'error', message: `❌ Columnas faltantes: ${errorMsg}` };
        } else {
          results.profilesColumns = { status: 'ok', message: '✅ Columnas nuevas existen en profiles (error de query normal)' };
        }
      } else {
        results.profilesColumns = { status: 'ok', message: '✅ Columnas nuevas existen en profiles' };
      }
    } catch (error: any) {
      const errorMsg = (error && typeof error === 'object' && 'message' in error) ? String(error.message) : String(error || 'Error desconocido');
      results.profilesColumns = { status: 'error', message: `❌ Error: ${errorMsg}` };
    }
    setChecks(prev => ({ ...prev, ...results }));

    // Check 6: Can query published rides
    setChecks(prev => ({ ...prev, ...results, publishedRides: { status: 'checking', message: 'Verificando viajes publicados...' } }));
    try {
      const { data, error } = await supabase
        .from('rides')
        .select('id')
        .eq('status', 'published')
        .limit(1);

      if (error) {
        const errorMsg = (error && typeof error === 'object' && 'message' in error) ? String(error.message) : String(error || 'Error desconocido');
        results.publishedRides = { status: 'error', message: `❌ Error: ${errorMsg}` };
      } else {
        results.publishedRides = { status: 'ok', message: `✅ Puede consultar viajes publicados (${data?.length || 0} encontrados)` };
      }
    } catch (error: any) {
      const errorMsg = (error && typeof error === 'object' && 'message' in error) ? String(error.message) : String(error || 'Error desconocido');
      results.publishedRides = { status: 'error', message: `❌ Error: ${errorMsg}` };
    }
    setChecks(prev => ({ ...prev, ...results }));
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <a href="/" className="text-2xl font-bold text-green-600">
            Xhare
          </a>
          <div className="flex gap-4">
            <a
              href="/"
              className="px-4 py-2 text-gray-700 hover:text-green-600 transition"
            >
              Volver al inicio
            </a>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-6 text-gray-900">Verificación de Migración</h1>
          
          <div className="bg-white rounded-lg shadow-lg p-6 space-y-4">
            <h2 className="text-xl font-semibold mb-4">Estado de la Migración</h2>
            
            {Object.entries(checks).map(([key, check]) => (
              <div key={key} className={`p-4 border rounded-lg transition-colors ${
                check.status === 'ok' ? 'border-green-200 bg-green-50' :
                check.status === 'error' ? 'border-red-200 bg-red-50' :
                'border-gray-200 bg-gray-50'
              }`}>
                <div className="flex items-center gap-3">
                  {check.status === 'checking' && (
                    <span className="animate-spin text-green-600">⏳</span>
                  )}
                  {check.status === 'ok' && (
                    <span className="text-green-600 text-xl">✅</span>
                  )}
                  {check.status === 'error' && (
                    <span className="text-red-600 text-xl">❌</span>
                  )}
                  <span className={`font-medium ${
                    check.status === 'error' ? 'text-red-700' : 
                    check.status === 'ok' ? 'text-green-700' : 
                    'text-gray-700'
                  }`}>
                    {check.message}
                  </span>
                </div>
              </div>
            ))}

            {Object.keys(checks).length === 0 && (
              <p className="text-gray-500">Ejecutando verificaciones...</p>
            )}

            <div className="mt-6 pt-6 border-t border-gray-200">
              <h3 className="font-semibold mb-3 text-gray-900">Instrucciones:</h3>
              <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
                <li>Si ves errores, vuelve a ejecutar la migración en Supabase SQL Editor</li>
                <li>Limpia la caché del navegador (Ctrl+Shift+R o Cmd+Shift+R)</li>
                <li>Recarga esta página para verificar nuevamente</li>
                <li>Si todo está OK, ve a la homepage y prueba publicar un viaje</li>
              </ol>
            </div>

            <div className="mt-6 flex gap-4">
              <button
                onClick={runChecks}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium"
              >
                Verificar nuevamente
              </button>
              <a
                href="/"
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-medium"
              >
                Ir al inicio
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
