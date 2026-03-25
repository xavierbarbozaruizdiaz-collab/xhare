/**
 * Login (and optional sign-up). Supabase email/password.
 * Incluye "¿Olvidaste tu contraseña?" → reset por email.
 * On success, AuthContext updates and RootNavigator switches to Main.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { supabase, isEnvConfigured } from '../backend/supabase';
import { useAuth } from '../auth/AuthContext';

export function LoginScreen() {
  const { refreshSession } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleSubmit() {
    if (!isEnvConfigured()) {
      setMessage('Configurá EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY en .env');
      return;
    }
    setLoading(true);
    setMessage('');
    setResetSent(false);
    try {
      // Diagnóstico: en release a veces falla la inicialización del cliente.
      // Si un método no existe, mostramos un error claro en vez de "undefined is not a function".
      const authAny = supabase.auth as any;
      console.log('[SUPABASE_DEBUG]', {
        hasAuth: Boolean(supabase.auth),
        signInWithPassword: typeof authAny?.signInWithPassword,
        signUp: typeof authAny?.signUp,
        getSession: typeof authAny?.getSession,
      });

      if (isSignUp) {
        if (typeof (authAny?.signUp) !== 'function') {
          throw new Error('Supabase auth no tiene signUp');
        }
        const { data, error } = await supabase.auth.signUp({ email, password });
        console.log('MOBILE signUp result:', !!data?.session, error);
        if (error) throw error;
        setMessage('Revisá tu correo para confirmar la cuenta.');
      } else {
        if (typeof (authAny?.signInWithPassword) !== 'function') {
          throw new Error('Supabase auth no tiene signInWithPassword');
        }
        // No usar `raceWithTimeout` corto aquí: si el POST tarda (red móvil) devolvíamos TIMEOUT
        // aunque Supabase igual persistía la sesión → error en pantalla pero al reabrir ya entraba.
        // El tope real lo pone la carga de `profiles` en `getSessionProfileFromSession` (timeout + perfil mínimo).
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        console.log('MOBILE signInWithPassword result:', !!data?.session, error);
        if (error) throw error;
        await refreshSession((data as any)?.session ?? null);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error';
      setMessage(msg.includes('422') ? 'Email ya registrado o contraseña inválida (mín. 6 caracteres).' : msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    const e = email.trim();
    if (!e) {
      setMessage('Ingresá tu email para enviarte el enlace de restablecimiento.');
      return;
    }
    if (!isEnvConfigured()) {
      setMessage('Configuración de Supabase faltante.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const authAny = supabase.auth as any;
      if (typeof authAny?.resetPasswordForEmail !== 'function') {
        throw new Error('Supabase auth no tiene resetPasswordForEmail');
      }
      const { error } = await supabase.auth.resetPasswordForEmail(e, {
        redirectTo: undefined,
      });
      if (error) throw error;
      setResetSent(true);
      setMessage('Revisá tu correo. Te enviamos un enlace para restablecer la contraseña. Si no aparece, revisá la carpeta de spam.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'No se pudo enviar el enlace.');
    } finally {
      setLoading(false);
    }
  }

  function showForgotPasswordPrompt() {
    Alert.alert(
      '¿Olvidaste tu contraseña?',
      'Ingresá el email de tu cuenta y te enviamos un enlace para restablecer la contraseña.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Enviar enlace',
          onPress: () => {
            if (email.trim()) {
              handleForgotPassword();
            } else {
              setMessage('Escribí tu email arriba y tocá de nuevo "¿Olvidaste tu contraseña?"');
            }
          },
        },
      ]
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
      accessibilityLabel="Pantalla de inicio de sesión"
    >
      <View style={styles.card}>
        <Text style={styles.title} accessibilityRole="header">Xhare</Text>
        <Text style={styles.subtitle}>App móvil</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#888"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!loading}
          accessibilityLabel="Correo electrónico"
          accessibilityHint="Escribí tu email para iniciar sesión o recuperar contraseña"
        />
        <TextInput
          style={styles.input}
          placeholder="Contraseña"
          placeholderTextColor="#888"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!loading}
          accessibilityLabel="Contraseña"
          accessibilityHint="Tu contraseña de la cuenta"
        />

        {message ? <Text style={[styles.message, resetSent && styles.messageSuccess]} accessibilityLiveRegion="polite">{message}</Text> : null}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
          accessibilityLabel={isSignUp ? 'Crear cuenta' : 'Iniciar sesión'}
          accessibilityHint="Toca para entrar con email y contraseña"
          accessibilityRole="button"
        >
          {loading ? (
            <ActivityIndicator color="#fff" accessibilityLabel="Cargando" />
          ) : (
            <Text style={styles.buttonText}>{isSignUp ? 'Crear cuenta' : 'Iniciar sesión'}</Text>
          )}
        </TouchableOpacity>

        {!isSignUp && (
          <TouchableOpacity
            style={styles.forgotLink}
            onPress={showForgotPasswordPrompt}
            disabled={loading}
            accessibilityLabel="¿Olvidaste tu contraseña?"
            accessibilityHint="Recibir enlace por email para restablecer la contraseña"
            accessibilityRole="button"
          >
            <Text style={styles.forgotLinkText}>¿Olvidaste tu contraseña?</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.switch}
          onPress={() => { setIsSignUp(!isSignUp); setMessage(''); setResetSent(false); }}
          disabled={loading}
          accessibilityLabel={isSignUp ? 'Ya tenés cuenta, ir a iniciar sesión' : 'No tenés cuenta, crear cuenta'}
          accessibilityRole="button"
        >
          <Text style={styles.switchText}>
            {isSignUp ? '¿Ya tenés cuenta? Iniciar sesión' : '¿No tenés cuenta? Crear cuenta'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#166534',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
    color: '#111',
  },
  message: {
    fontSize: 13,
    color: '#b91c1c',
    marginBottom: 12,
  },
  messageSuccess: {
    color: '#166534',
  },
  forgotLink: {
    marginTop: 12,
    alignItems: 'center',
  },
  forgotLinkText: {
    fontSize: 14,
    color: '#166534',
    fontWeight: '500',
  },
  button: {
    backgroundColor: '#166534',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  switch: {
    marginTop: 16,
    alignItems: 'center',
  },
  switchText: {
    color: '#666',
    fontSize: 14,
  },
});
