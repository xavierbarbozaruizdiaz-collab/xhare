'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';

type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  avatar_url: string | null;
  vehicle_photo_url: string | null;
  role: string;
  created_at?: string;
};

type DriverAccount = {
  driver_id: string;
  account_status: string;
  debt_pyg: number;
  debt_limit_pyg: number;
  updated_at: string;
};

export default function AdminDriversPage() {
  const [pending, setPending] = useState<Profile[]>([]);
  const [approved, setApproved] = useState<Array<Profile & { account?: DriverAccount | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [uploadingAvatarFor, setUploadingAvatarFor] = useState<string | null>(null);
  const [uploadingVehiclePhotoFor, setUploadingVehiclePhotoFor] = useState<string | null>(null);

  useEffect(() => {
    loadPending();
    loadApproved();
  }, []);

  async function loadApproved() {
    const { data: drivers } = await supabase
      .from('profiles')
      .select('id, full_name, phone, address, city, avatar_url, vehicle_photo_url, role, created_at')
      .eq('role', 'driver')
      .order('full_name');
    const { data: accounts } = await supabase
      .from('driver_accounts')
      .select('driver_id, account_status, debt_pyg, debt_limit_pyg, updated_at');
    const accountByDriver: Record<string, DriverAccount> = {};
    (accounts ?? []).forEach((a: DriverAccount) => { accountByDriver[a.driver_id] = a; });
    setApproved((drivers ?? []).map((d) => ({ ...d, account: accountByDriver[d.id] ?? null })));
  }

  async function loadPending() {
    setLoading(true);
    let { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone, address, city, avatar_url, vehicle_photo_url, role, created_at')
      .eq('role', 'driver_pending')
      .order('created_at', { ascending: false });
    if (error?.code === '42703' || error?.message?.includes('column')) {
      const res = await supabase
        .from('profiles')
        .select('id, full_name, phone, avatar_url, vehicle_photo_url, role, created_at')
        .eq('role', 'driver_pending')
        .order('created_at', { ascending: false });
      data = (res.data ?? []).map((r) => ({ ...r, address: null, city: null, avatar_url: null, vehicle_photo_url: null }));
    }
    setPending(data ?? []);
    setLoading(false);
  }

  async function approve(id: string) {
    setActing(id);
    const { error } = await supabase
      .from('profiles')
      .update({ role: 'driver', driver_approved_at: new Date().toISOString() })
      .eq('id', id);
    setActing(null);
    if (error) alert(error.message);
    else loadPending();
  }

  async function reject(id: string) {
    setActing(id);
    const { error } = await supabase.from('profiles').update({ role: 'passenger' }).eq('id', id);
    setActing(null);
    if (error) alert(error.message);
    else loadPending();
  }

  async function setAccountStatus(driverId: string, status: 'active' | 'suspended') {
    setActing(driverId);
    const { data: existing } = await supabase.from('driver_accounts').select('driver_id').eq('driver_id', driverId).maybeSingle();
    if (existing) {
      await supabase.from('driver_accounts').update({ account_status: status, updated_at: new Date().toISOString() }).eq('driver_id', driverId);
    } else {
      await supabase.from('driver_accounts').insert({ driver_id: driverId, account_status: status, debt_pyg: 0, debt_limit_pyg: 50000 });
    }
    setActing(null);
    loadApproved();
  }

  function extFromFile(file: File): string {
    if (file.type === 'image/png') return 'png';
    if (file.type === 'image/webp') return 'webp';
    return 'jpg';
  }

  function pathFromPublicUrl(url: string | null, bucket: string): string | null {
    if (!url) return null;
    const marker = `/storage/v1/object/public/${bucket}/`;
    const idx = url.indexOf(marker);
    if (idx < 0) return null;
    const tail = url.slice(idx + marker.length);
    return tail ? tail.split('?')[0] : null;
  }

  async function uploadAvatar(driver: Profile, file: File) {
    const isImage = file.type === 'image/jpeg' || file.type === 'image/jpg' || file.type === 'image/png' || file.type === 'image/webp';
    if (!isImage) {
      alert('Formato no permitido. Usá JPG, PNG o WEBP.');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      alert('La imagen supera 3MB.');
      return;
    }

    setUploadingAvatarFor(driver.id);
    try {
      const ext = extFromFile(file);
      const objectPath = `drivers/${driver.id}/avatar-${Date.now()}.${ext}`;
      const oldPath = pathFromPublicUrl(driver.avatar_url, 'driver-avatars');

      const { error: upErr } = await supabase.storage.from('driver-avatars').upload(objectPath, file, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: true,
      });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from('driver-avatars').getPublicUrl(objectPath);
      const newUrl = data.publicUrl;

      const { error: profileErr } = await supabase.from('profiles').update({ avatar_url: newUrl }).eq('id', driver.id);
      if (profileErr) throw profileErr;

      if (oldPath && oldPath !== objectPath) {
        await supabase.storage.from('driver-avatars').remove([oldPath]);
      }

      await loadApproved();
    } catch (err: any) {
      alert(err?.message ?? 'No se pudo subir la foto.');
    } finally {
      setUploadingAvatarFor(null);
    }
  }

  async function removeAvatar(driver: Profile) {
    setUploadingAvatarFor(driver.id);
    try {
      const oldPath = pathFromPublicUrl(driver.avatar_url, 'driver-avatars');
      const { error: profileErr } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', driver.id);
      if (profileErr) throw profileErr;
      if (oldPath) {
        await supabase.storage.from('driver-avatars').remove([oldPath]);
      }
      await loadApproved();
    } catch (err: any) {
      alert(err?.message ?? 'No se pudo quitar la foto.');
    } finally {
      setUploadingAvatarFor(null);
    }
  }

  async function uploadVehiclePhoto(driver: Profile, file: File) {
    const isImage = file.type === 'image/jpeg' || file.type === 'image/jpg' || file.type === 'image/png' || file.type === 'image/webp';
    if (!isImage) {
      alert('Formato no permitido. Usá JPG, PNG o WEBP.');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      alert('La imagen supera 3MB.');
      return;
    }

    setUploadingVehiclePhotoFor(driver.id);
    try {
      const ext = extFromFile(file);
      const objectPath = `drivers/${driver.id}/vehicle-${Date.now()}.${ext}`;
      const oldPath = pathFromPublicUrl(driver.vehicle_photo_url, 'driver-vehicles');

      const { error: upErr } = await supabase.storage.from('driver-vehicles').upload(objectPath, file, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: true,
      });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from('driver-vehicles').getPublicUrl(objectPath);
      const newUrl = data.publicUrl;

      const { error: profileErr } = await supabase.from('profiles').update({ vehicle_photo_url: newUrl }).eq('id', driver.id);
      if (profileErr) throw profileErr;

      if (oldPath && oldPath !== objectPath) {
        await supabase.storage.from('driver-vehicles').remove([oldPath]);
      }

      await loadApproved();
    } catch (err: any) {
      alert(err?.message ?? 'No se pudo subir la foto del vehículo.');
    } finally {
      setUploadingVehiclePhotoFor(null);
    }
  }

  async function removeVehiclePhoto(driver: Profile) {
    setUploadingVehiclePhotoFor(driver.id);
    try {
      const oldPath = pathFromPublicUrl(driver.vehicle_photo_url, 'driver-vehicles');
      const { error: profileErr } = await supabase.from('profiles').update({ vehicle_photo_url: null }).eq('id', driver.id);
      if (profileErr) throw profileErr;
      if (oldPath) {
        await supabase.storage.from('driver-vehicles').remove([oldPath]);
      }
      await loadApproved();
    } catch (err: any) {
      alert(err?.message ?? 'No se pudo quitar la foto del vehículo.');
    } finally {
      setUploadingVehiclePhotoFor(null);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Solicitudes de conductores</h1>
      <p className="text-gray-600 mb-6">
        Los pasajeros pueden usar la app sin aprobación. Quienes se registraron como conductores aparecen aquí hasta que los aprobés o rechacés.
      </p>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
        </div>
      ) : pending.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          No hay solicitudes pendientes.
        </div>
      ) : (
        <ul className="space-y-3">
          {pending.map((p) => (
            <li
              key={p.id}
              className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-center justify-between gap-4"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900">{p.full_name || 'Sin nombre'}</p>
                <p className="text-sm text-gray-600">{p.phone || 'Sin teléfono'}</p>
                {(p.address || p.city) && (
                  <p className="text-sm text-gray-500 mt-1">
                    {[p.address, p.city].filter(Boolean).join(', ') || 'Sin domicilio'}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-1">ID: {p.id}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={acting !== null}
                  onClick={() => approve(p.id)}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {acting === p.id ? 'Espera...' : 'Aprobar'}
                </button>
                <button
                  type="button"
                  disabled={acting !== null}
                  onClick={() => reject(p.id)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Rechazar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="text-xl font-bold text-gray-900 mt-10 mb-4">Conductores aprobados</h2>
      <p className="text-gray-600 mb-4">
        Deuda y estado de cuenta. Podés suspender o reactivar. Para marcar pagos, usá <Link href="/admin/billing" className="text-green-600 hover:underline">Billing</Link>.
      </p>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left p-3">Nombre</th>
              <th className="text-right p-3">Deuda (PYG)</th>
              <th className="text-right p-3">Límite</th>
              <th className="text-left p-3">Estado</th>
              <th className="text-left p-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {approved.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-gray-500">No hay conductores aprobados.</td>
              </tr>
            ) : (
              approved.map((d) => (
                <tr key={d.id} className="border-b border-gray-100">
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      {d.avatar_url ? (
                        <img src={d.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border border-gray-200" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-xs text-gray-500">
                          {(d.full_name || '?').charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span>{d.full_name || d.id.slice(0, 8)}</span>
                    </div>
                  </td>
                  <td className="p-3 text-right">{(d.account?.debt_pyg ?? 0).toLocaleString('es-PY')}</td>
                  <td className="p-3 text-right">{(d.account?.debt_limit_pyg ?? 50000).toLocaleString('es-PY')}</td>
                  <td className="p-3">
                    <span className={d.account?.account_status === 'suspended' ? 'text-amber-700 font-medium' : 'text-green-700'}>
                      {d.account?.account_status === 'suspended' ? 'Suspendido' : 'Activo'}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      {d.account?.account_status === 'suspended' ? (
                        <button
                          type="button"
                          disabled={acting !== null}
                          onClick={() => setAccountStatus(d.id, 'active')}
                          className="text-green-600 hover:underline text-sm font-medium disabled:opacity-50"
                        >
                          {acting === d.id ? '...' : 'Reactivar'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={acting !== null}
                          onClick={() => setAccountStatus(d.id, 'suspended')}
                          className="text-amber-600 hover:underline text-sm font-medium disabled:opacity-50"
                        >
                          {acting === d.id ? '...' : 'Suspender'}
                        </button>
                      )}
                      <label className="text-blue-600 hover:underline text-sm font-medium cursor-pointer">
                        {uploadingAvatarFor === d.id ? 'Subiendo...' : 'Subir foto perfil'}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          disabled={uploadingAvatarFor !== null || uploadingVehiclePhotoFor !== null}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.currentTarget.value = '';
                            if (file) uploadAvatar(d, file);
                          }}
                        />
                      </label>
                      {d.avatar_url ? (
                        <button
                          type="button"
                          disabled={uploadingAvatarFor !== null}
                          onClick={() => removeAvatar(d)}
                          className="text-red-600 hover:underline text-sm font-medium disabled:opacity-50"
                        >
                          Quitar foto
                        </button>
                      ) : null}
                      <label className="text-indigo-600 hover:underline text-sm font-medium cursor-pointer">
                        {uploadingVehiclePhotoFor === d.id ? 'Subiendo...' : 'Subir foto vehículo'}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          disabled={uploadingAvatarFor !== null || uploadingVehiclePhotoFor !== null}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.currentTarget.value = '';
                            if (file) uploadVehiclePhoto(d, file);
                          }}
                        />
                      </label>
                      {d.vehicle_photo_url ? (
                        <>
                          <a
                            href={d.vehicle_photo_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-gray-600 hover:underline text-sm font-medium"
                          >
                            Ver foto vehículo
                          </a>
                          <button
                            type="button"
                            disabled={uploadingAvatarFor !== null || uploadingVehiclePhotoFor !== null}
                            onClick={() => removeVehiclePhoto(d)}
                            className="text-red-700 hover:underline text-sm font-medium disabled:opacity-50"
                          >
                            Quitar foto vehículo
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
