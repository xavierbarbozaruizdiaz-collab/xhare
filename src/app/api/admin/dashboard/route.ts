import { NextRequest, NextResponse } from 'next/server';

/**
 * Deprecado: el dashboard usa endpoints por bloque.
 * Use: GET /api/admin/dashboard/profiles
 *      GET /api/admin/dashboard/uberpool
 *      GET /api/admin/dashboard/ratings
 *      GET /api/admin/dashboard/indriver
 */
export async function GET(_request: NextRequest) {
  return NextResponse.json(
    {
      error: 'Deprecated',
      message: 'Use /api/admin/dashboard/profiles, /uberpool, /ratings, /indriver instead',
    },
    { status: 410 }
  );
}
