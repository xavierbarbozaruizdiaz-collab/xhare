'use client';

import { useState, useEffect, useMemo } from 'react';
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

type DriverDocumentType = 'passenger_insurance' | 'dinatran_permit' | 'cedula_verde';
type DriverDocumentStatus = 'pending' | 'approved' | 'rejected';
type DriverDocument = {
  id: string;
  driver_id: string;
  doc_type: DriverDocumentType;
  storage_bucket: string;
  storage_path: string;
  file_name: string | null;
  status: DriverDocumentStatus;
  review_notes: string | null;
  expires_at: string | null;
  updated_at: string;
};

const DOC_TYPE_LABEL: Record<DriverDocumentType, string> = {
  passenger_insurance: 'Seguro pasajero',
  dinatran_permit: 'Habilitación DINATRAN',
  cedula_verde: 'Cédula verde',
};

export default function AdminDriversPage() {
  const [pending, setPending] = useState<Profile[]>([]);
  const [approved, setApproved] = useState<Array<Profile & { account?: DriverAccount | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [uploadingAvatarFor, setUploadingAvatarFor] = useState<string | null>(null);
  const [uploadingVehiclePhotoFor, setUploadingVehiclePhotoFor] = useState<string | null>(null);
  const [docsByDriver, setDocsByDriver] = useState<Record<string, DriverDocument[]>>({});
  const [reviewingDocId, setReviewingDocId] = useState<string | null>(null);
  const [showAllDriverDocs, setShowAllDriverDocs] = useState(false);
  const [docsQuery, setDocsQuery] = useState('');
  const [expandedDriverDocs, setExpandedDriverDocs] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadPending();
    loadApproved();
    loadDriverDocs();
  }, []);

  async function loadDriverDocs() {
    const { data } = await supabase
      .from('driver_documents')
      .select('id, driver_id, doc_type, storage_bucket, storage_path, file_name, status, review_notes, expires_at, updated_at')
      .order('updated_at', { ascending: false });
    const next: Record<string, DriverDocument[]> = {};
    (data ?? []).forEach((d) => {
      const row = d as DriverDocument;
      if (!next[row.driver_id]) next[row.driver_id] = [];
      next[row.driver_id]!.push(row);
    });
    setDocsByDriver(next);
  }

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

  async function openDocPreview(doc: DriverDocument) {
    try {
      const { data, error } = await supabase.storage
        .from(doc.storage_bucket)
        .createSignedUrl(doc.storage_path, 60 * 5);
      if (error || !data?.signedUrl) throw error ?? new Error('No se pudo generar enlace');
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      alert(err?.message ?? 'No se pudo abrir el documento.');
    }
  }

  async function reviewDriverDoc(doc: DriverDocument, status: 'approved' | 'rejected') {
    const notes =
      status === 'rejected'
        ? prompt('Motivo de rechazo (se mostrará al conductor):', doc.review_notes ?? '') ?? ''
        : '';
    if (status === 'rejected' && !notes.trim()) {
      alert('Debés ingresar el motivo de rechazo.');
      return;
    }
    setReviewingDocId(doc.id);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const nowIso = new Date().toISOString();
      const payload = {
        status,
        review_notes: status === 'rejected' ? notes.trim() : null,
        reviewed_at: nowIso,
        reviewed_by: user?.id ?? null,
        approved_at: status === 'approved' ? nowIso : null,
        rejected_at: status === 'rejected' ? nowIso : null,
      };
      const { error } = await supabase.from('driver_documents').update(payload).eq('id', doc.id);
      if (error) throw error;
      await supabase.from('driver_document_audit_logs').insert({
        driver_document_id: doc.id,
        driver_id: doc.driver_id,
        actor_id: user?.id ?? null,
        action: status === 'approved' ? 'approved' : 'rejected',
        prev_status: doc.status,
        new_status: status,
        prev_expires_at: doc.expires_at ?? null,
        new_expires_at: doc.expires_at ?? null,
        notes: status === 'rejected' ? notes.trim() : null,
      });
      await loadDriverDocs();
    } catch (err: any) {
      alert(err?.message ?? 'No se pudo guardar la revisión.');
    } finally {
      setReviewingDocId(null);
    }
  }

  async function setDriverDocExpiry(doc: DriverDocument) {
    const current = doc.expires_at ? String(doc.expires_at) : '';
    const raw = prompt('Vencimiento (YYYY-MM-DD). Dejá vacío para quitar:', current);
    if (raw == null) return;
    const v = raw.trim();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      alert('Formato inválido. Usá YYYY-MM-DD.');
      return;
    }
    setReviewingDocId(doc.id);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('driver_documents')
        .update({ expires_at: v || null })
        .eq('id', doc.id);
      if (error) throw error;
      await supabase.from('driver_document_audit_logs').insert({
        driver_document_id: doc.id,
        driver_id: doc.driver_id,
        actor_id: user?.id ?? null,
        action: 'expiry_set',
        prev_status: doc.status,
        new_status: doc.status,
        prev_expires_at: doc.expires_at ?? null,
        new_expires_at: v || null,
        notes: null,
      });
      await loadDriverDocs();
    } catch (err: any) {
      alert(err?.message ?? 'No se pudo actualizar vencimiento.');
    } finally {
      setReviewingDocId(null);
    }
  }

  const driverDocsRows = useMemo(() => {
    const requiredTypes = Object.keys(DOC_TYPE_LABEL) as DriverDocumentType[];
    const today = new Date().toISOString().slice(0, 10);
    return approved.map((driver) => {
      const docs = docsByDriver[driver.id] ?? [];
      let approvedCount = 0;
      let pendingCount = 0;
      let rejectedCount = 0;
      let missingCount = 0;
      let expiredCount = 0;
      for (const t of requiredTypes) {
        const doc = docs.find((x) => x.doc_type === t);
        if (!doc) {
          missingCount += 1;
          continue;
        }
        if (doc.status === 'approved') approvedCount += 1;
        else if (doc.status === 'rejected') rejectedCount += 1;
        else pendingCount += 1;
        if (doc.expires_at && doc.expires_at < today) expiredCount += 1;
      }
      const hasIssues = missingCount > 0 || pendingCount > 0 || rejectedCount > 0 || expiredCount > 0;
      const lowerName = String(driver.full_name ?? '').toLowerCase();
      const lowerPhone = String(driver.phone ?? '').toLowerCase();
      return {
        driver,
        docs,
        approvedCount,
        pendingCount,
        rejectedCount,
        missingCount,
        expiredCount,
        hasIssues,
        searchBlob: `${lowerName} ${lowerPhone}`.trim(),
      };
    });
  }, [approved, docsByDriver]);

  const visibleDriverDocsRows = useMemo(() => {
    const q = docsQuery.trim().toLowerCase();
    return driverDocsRows.filter((row) => {
      if (!showAllDriverDocs && !row.hasIssues) return false;
      if (!q) return true;
      return row.searchBlob.includes(q);
    });
  }, [docsQuery, driverDocsRows, showAllDriverDocs]);

  const issueRowsCount = useMemo(
    () => driverDocsRows.filter((x) => x.hasIssues).length,
    [driverDocsRows]
  );

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

      <h2 className="text-xl font-bold text-gray-900 mt-10 mb-4">Documentos de conductor</h2>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-gray-600">
          Vista por excepción: por defecto se muestran solo conductores con algo pendiente.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={docsQuery}
            onChange={(e) => setDocsQuery(e.target.value)}
            placeholder="Buscar conductor..."
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <button
            type="button"
            onClick={() => setShowAllDriverDocs((v) => !v)}
            className="text-sm font-semibold text-green-700 hover:underline"
          >
            {showAllDriverDocs ? 'Ver solo pendientes' : 'Ver todos'}
          </button>
        </div>
      </div>
      <div className="mb-4 text-sm text-gray-600">
        Mostrando {visibleDriverDocsRows.length} conductor(es){' '}
        {!showAllDriverDocs ? `(con incidencia: ${issueRowsCount})` : ''}.
      </div>
      <div className="space-y-3">
        {visibleDriverDocsRows.map((row) => {
          const d = row.driver;
          const docs = row.docs;
          const expanded = !!expandedDriverDocs[d.id];
          const statusTone =
            row.expiredCount > 0 || row.rejectedCount > 0
              ? 'bg-red-100 text-red-700'
              : row.pendingCount > 0 || row.missingCount > 0
                ? 'bg-amber-100 text-amber-700'
                : 'bg-green-100 text-green-700';
          return (
            <div key={`docs-${d.id}`} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{d.full_name || d.id.slice(0, 8)}</p>
                  <p className="text-xs text-gray-500">
                    {row.approvedCount}/3 aprobados · faltan {row.missingCount} · en revisión {row.pendingCount} · rechazados {row.rejectedCount}
                    {row.expiredCount > 0 ? ` · vencidos ${row.expiredCount}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusTone}`}>
                    {row.expiredCount > 0 || row.rejectedCount > 0
                      ? 'Con bloqueo'
                      : row.pendingCount > 0 || row.missingCount > 0
                        ? 'Pendiente'
                        : 'Completo'}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedDriverDocs((prev) => ({ ...prev, [d.id]: !prev[d.id] }))
                    }
                    className="text-sm font-semibold text-green-700 hover:underline"
                  >
                    {expanded ? 'Ocultar detalle' : 'Ver detalle'}
                  </button>
                </div>
              </div>
              {expanded ? <div className="mt-3 space-y-2">
                {(Object.keys(DOC_TYPE_LABEL) as DriverDocumentType[]).map((docType) => {
                  const doc = docs.find((x) => x.doc_type === docType);
                  const status = doc?.status ?? 'pending';
                  const statusClass =
                    status === 'approved'
                      ? 'bg-green-100 text-green-800'
                      : status === 'rejected'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-amber-100 text-amber-800';
                  return (
                    <div
                      key={`${d.id}-${docType}`}
                      className="border border-gray-100 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">{DOC_TYPE_LABEL[docType]}</p>
                        <p className="text-xs text-gray-500">
                          {doc?.file_name ? doc.file_name : 'Sin archivo cargado'}
                        </p>
                        {doc?.expires_at ? (
                          <p className="text-xs text-gray-500">
                            Vence: {new Date(`${doc.expires_at}T00:00:00`).toLocaleDateString('es-PY')}
                          </p>
                        ) : null}
                        {doc?.review_notes ? (
                          <p className="text-xs text-amber-700 mt-1">Nota: {doc.review_notes}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusClass}`}>
                          {status === 'approved' ? 'Aprobado' : status === 'rejected' ? 'Rechazado' : 'En revisión'}
                        </span>
                        {doc ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void openDocPreview(doc)}
                              className="text-blue-600 hover:underline text-sm font-medium"
                            >
                              Ver
                            </button>
                            <button
                              type="button"
                              disabled={reviewingDocId != null}
                              onClick={() => void setDriverDocExpiry(doc)}
                              className="text-indigo-700 hover:underline text-sm font-medium disabled:opacity-50"
                            >
                              {reviewingDocId === doc.id ? '...' : 'Vencimiento'}
                            </button>
                            <button
                              type="button"
                              disabled={reviewingDocId != null}
                              onClick={() => void reviewDriverDoc(doc, 'approved')}
                              className="text-green-700 hover:underline text-sm font-medium disabled:opacity-50"
                            >
                              {reviewingDocId === doc.id ? '...' : 'Aprobar'}
                            </button>
                            <button
                              type="button"
                              disabled={reviewingDocId != null}
                              onClick={() => void reviewDriverDoc(doc, 'rejected')}
                              className="text-red-700 hover:underline text-sm font-medium disabled:opacity-50"
                            >
                              {reviewingDocId === doc.id ? '...' : 'Rechazar'}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div> : null}
            </div>
          );
        })}
        {visibleDriverDocsRows.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-sm text-gray-500">
            No hay conductores para mostrar con ese filtro.
          </div>
        ) : null}
      </div>
    </div>
  );
}
