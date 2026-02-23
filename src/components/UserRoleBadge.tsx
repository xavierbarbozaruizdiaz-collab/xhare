'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';

interface UserRoleBadgeProps {
  userId?: string;
  className?: string;
}

export default function UserRoleBadge({ userId, className = '' }: UserRoleBadgeProps) {
  const [role, setRole] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUserRole();
  }, [userId]);

  async function loadUserRole() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('id', userId || user.id)
        .single();

      if (profileError) {
        setLoading(false);
        return;
      }

      if (profile) {
        setRole(profile.role);
        const name = (profile.full_name ?? '').trim();
        setDisplayName(name || user.email || null);
      }
    } catch (_) {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className={`inline-flex items-center px-2 py-1 rounded text-xs bg-gray-100 ${className}`}>
        <span className="animate-pulse">Cargando...</span>
      </div>
    );
  }

  if (!role) {
    return null;
  }

  const roleConfig: Record<string, { label: string; bgColor: string; textColor: string; borderColor: string; icon: string }> = {
    passenger: {
      label: 'Pasajero',
      bgColor: 'bg-green-100',
      textColor: 'text-green-800',
      borderColor: 'border-green-300',
      icon: '👤',
    },
    driver: {
      label: 'Chofer',
      bgColor: 'bg-green-100',
      textColor: 'text-green-800',
      borderColor: 'border-green-300',
      icon: '🚗',
    },
    admin: {
      label: 'Administrador',
      bgColor: 'bg-purple-100',
      textColor: 'text-purple-800',
      borderColor: 'border-purple-300',
      icon: '👑',
    },
  };

  const config = roleConfig[role] || roleConfig.passenger;
  const label = displayName ? `${displayName} · ${config.label}` : config.label;

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${config.bgColor} ${config.textColor} ${config.borderColor} ${className}`}
    >
      <span className="text-sm">{config.icon}</span>
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}
