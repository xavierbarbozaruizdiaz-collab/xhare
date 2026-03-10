package com.xhare.app;

import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

/**
 * Abre una URL (p. ej. geo:lat,lng) usando el selector del sistema
 * para que el usuario elija con qué app navegar (Maps, Waze, etc.).
 */
@CapacitorPlugin(name = "Navigation")
public class NavigationPlugin extends Plugin {

    private static final String TAG = "NAV_NATIVE_DEBUG";

    @PluginMethod
    public void openWithChooser(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            Log.e(TAG, "openWithChooser called without url");
            call.reject("url es obligatoria");
            return;
        }
        try {
            Log.d(TAG, "openWithChooser start, url=" + url);

            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));

            // Verificar que exista al menos una app que pueda manejar el intent
            if (intent.resolveActivity(getContext().getPackageManager()) == null) {
                Log.e(TAG, "No activity found to handle navigation intent for url=" + url);
                call.reject("No hay aplicaciones disponibles para abrir la navegación");
                return;
            }

            Intent chooser = Intent.createChooser(intent, "Abrir con");
            Log.d(TAG, "Launching chooser for navigation using activity context");
            try {
                // Preferir actividad actual para no necesitar FLAG_ACTIVITY_NEW_TASK
                if (getActivity() != null) {
                    getActivity().startActivity(chooser);
                } else {
                    Log.w(TAG, "getActivity() is null, falling back to application context with NEW_TASK flag");
                    chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(chooser);
                }
            } catch (Exception e) {
                Log.e(TAG, "Error using activity context, retrying with application context", e);
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(chooser);
            }
            Log.d(TAG, "Chooser launched successfully");
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Error launching navigation chooser", e);
            call.reject("No se pudo abrir: " + (e.getMessage() != null ? e.getMessage() : "error desconocido"));
        }
    }
}
