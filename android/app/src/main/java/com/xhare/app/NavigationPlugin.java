package com.xhare.app;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

/**
 * Navegación: abre URLs geo:/google.navigation/waze:// usando Intents.
 * También expone getAvailableApps para que la UI decida preferencia.
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
        String preferPackage = call.getString("package");
        try {
            Log.d(TAG, "openWithChooser start, url=" + url + ", package=" + preferPackage);

            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));

            // Si hay preferencia de app, abrir esa app directamente con el destino
            boolean useChooser = true;
            if (preferPackage != null && !preferPackage.isEmpty()) {
                intent.setPackage(preferPackage);
                if (intent.resolveActivity(getContext().getPackageManager()) != null) {
                    useChooser = false;
                } else {
                    Log.w(TAG, "Preferred app not installed, falling back to chooser");
                    intent.setPackage(null);
                }
            }

            if (intent.resolveActivity(getContext().getPackageManager()) == null) {
                Log.e(TAG, "No activity found to handle navigation intent for url=" + url);
                call.reject("No hay aplicaciones disponibles para abrir la navegación");
                return;
            }

            Intent toLaunch = useChooser ? Intent.createChooser(intent, "Abrir con") : intent;
            try {
                if (getActivity() != null) {
                    getActivity().startActivity(toLaunch);
                } else {
                    toLaunch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(toLaunch);
                }
            } catch (Exception e) {
                Log.e(TAG, "Error using activity context, retrying with application context", e);
                toLaunch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(toLaunch);
            }
            Log.d(TAG, "Navigation launched successfully");
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Error launching navigation", e);
            call.reject("No se pudo abrir: " + (e.getMessage() != null ? e.getMessage() : "error desconocido"));
        }
    }

    @PluginMethod
    public void getAvailableApps(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();

            boolean hasGoogleMaps = isPackageInstalled(pm, "com.google.android.apps.maps");
            boolean hasWaze = isPackageInstalled(pm, "com.waze");

            JSArray arr = new JSArray();

            JSObject google = new JSObject();
            google.put("id", "google_maps");
            google.put("label", "Google Maps");
            google.put("available", hasGoogleMaps);
            arr.put(google);

            JSObject waze = new JSObject();
            waze.put("id", "waze");
            waze.put("label", "Waze");
            waze.put("available", hasWaze);
            arr.put(waze);

            JSObject browser = new JSObject();
            browser.put("id", "browser");
            browser.put("label", "Navegador");
            browser.put("available", true);
            arr.put(browser);

            JSObject result = new JSObject();
            result.put("value", arr);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Error in getAvailableApps", e);
            call.reject("No se pudieron detectar las apps de navegación");
        }
    }

    private boolean isPackageInstalled(PackageManager pm, String packageName) {
        try {
            pm.getPackageInfo(packageName, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
