package com.xhare.app;

import android.content.Intent;
import android.net.Uri;

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

    @PluginMethod
    public void openWithChooser(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url es obligatoria");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Intent chooser = Intent.createChooser(intent, "Abrir con");
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo abrir: " + (e.getMessage() != null ? e.getMessage() : "error desconocido"));
        }
    }
}
