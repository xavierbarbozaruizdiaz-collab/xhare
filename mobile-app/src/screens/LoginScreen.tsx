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
  Linking,
  Image,
} from 'react-native';
import { appBrand } from '../ui/theme/brand';
import { supabase, isEnvConfigured } from '../backend/supabase';
import { useAuth } from '../auth/AuthContext';
import { env } from '../core/env';

export function LoginScreen() {
  const { refreshSession } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const termsUrl = `${env.apiBaseUrl?.trim().replace(/\/$/, '') || ''}/legal/terms`;
  const privacyUrl = `${env.apiBaseUrl?.trim().replace(/\/$/, '') || ''}/legal/privacy`;

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
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });
        console.log('MOBILE signUp result:', !!data?.session, error);
        if (error) throw error;
        setMessage('Cuenta creada. Antes de continuar te pediremos aceptar TyC y Privacidad.');
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
        <Image
          source={appBrand.logo}
          style={styles.logoImage}
          resizeMode="contain"
          accessibilityLabel={appBrand.appName}
        />
        <Text style={styles.tagline}>{appBrand.tagline}</Text>

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
        {isSignUp && (
          <View style={styles.legalWrap}>
            <Text style={styles.legalText}>
              Al crear tu cuenta, te mostraremos una sola pantalla para aceptar TyC y Privacidad.
            </Text>
            <View style={styles.legalLinksRow}>
              <TouchableOpacity onPress={() => { if (env.apiBaseUrl) void Linking.openURL(termsUrl); }}>
                <Text style={styles.legalLink}>Ver TyC</Text>
              </TouchableOpacity>
              <Text style={styles.legalSeparator}>•</Text>
              <TouchableOpacity onPress={() => { if (env.apiBaseUrl) void Linking.openURL(privacyUrl); }}>
                <Text style={styles.legalLink}>Ver Privacidad</Text>
              </TouchableOpacity>
            </View>
          </View>
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
    backgroundColor: appBrand.colors.background,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: appBrand.colors.surface,
    borderRadius: 12,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  logoImage: {
    width: '100%',
    height: 140,
    marginBottom: 4,
  },
  tagline: {
    fontSize: 14,
    color: appBrand.colors.textMuted,
    fontFamily: appBrand.fonts.medium,
    textAlign: 'center',
    marginBottom: 24,
  },
  input: {
    borderWidth: 1,
    borderColor: appBrand.colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
    color: appBrand.colors.text,
    fontFamily: appBrand.fonts.regular,
  },
  message: {
    fontSize: 13,
    color: appBrand.colors.danger,
    marginBottom: 12,
    fontFamily: appBrand.fonts.regular,
  },
  messageSuccess: {
    color: appBrand.colors.primary,
  },
  forgotLink: {
    marginTop: 12,
    alignItems: 'center',
  },
  forgotLinkText: {
    fontSize: 14,
    color: appBrand.colors.primary,
    fontFamily: appBrand.fonts.medium,
  },
  button: {
    backgroundColor: appBrand.colors.primary,
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
    color: appBrand.colors.white,
    fontSize: 16,
    fontFamily: appBrand.fonts.semibold,
  },
  switch: {
    marginTop: 16,
    alignItems: 'center',
  },
  switchText: {
    color: appBrand.colors.textMuted,
    fontSize: 14,
    fontFamily: appBrand.fonts.regular,
  },
  legalWrap: {
    marginTop: 12,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: appBrand.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: appBrand.colors.primary,
    borderColor: appBrand.colors.primary,
  },
  checkboxTick: {
    color: appBrand.colors.white,
    fontSize: 12,
    fontFamily: appBrand.fonts.semibold,
  },
  legalText: {
    color: appBrand.colors.text,
    fontSize: 13,
    flex: 1,
    marginLeft: 8,
    fontFamily: appBrand.fonts.regular,
  },
  legalLinksRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  legalLink: {
    color: appBrand.colors.primary,
    fontSize: 13,
    fontFamily: appBrand.fonts.semibold,
    marginHorizontal: 6,
  },
  legalSeparator: {
    color: appBrand.colors.textMuted,
  },
});
