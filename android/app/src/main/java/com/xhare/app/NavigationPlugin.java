package com.xhare.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.util.Log;
import android.widget.Toast;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

/**
 * Navegación 100% nativa: preferencia en SharedPreferences, apertura de Maps/Waze/chooser en UI thread.
 */
@CapacitorPlugin(name = "Navigation")
public class NavigationPlugin extends Plugin {

    private static final String TAG = "NAV_NATIVE_DEBUG";

    static {
        Log.d(TAG, "NavigationPlugin class loaded (native)");
    }
    private static final String PREF_KEY = "xhare_navigation_preference";
    private static final String DEFAULT_PREF = "ask_every_time";
    private static final String GOOGLE_MAPS_PACKAGE = "com.google.android.apps.maps";
    private static final String WAZE_PACKAGE = "com.waze";

    private SharedPreferences getPrefs() {
        return getContext().getSharedPreferences("NavigationPlugin", android.content.Context.MODE_PRIVATE);
    }

    private String getStoredPreference() {
        String v = getPrefs().getString(PREF_KEY, DEFAULT_PREF);
        if ("google_maps".equals(v) || "waze".equals(v) || "browser".equals(v) || "ask_every_time".equals(v)) {
            return v;
        }
        return DEFAULT_PREF;
    }

    /** Abre navegación según preferencia guardada (100% nativo). */
    @PluginMethod
    public void openNativeNavigation(final PluginCall call) {
        Double lat = call.getDouble("lat");
        Double lng = call.getDouble("lng");
        if (lat == null || lng == null || !Double.isFinite(lat) || !Double.isFinite(lng)) {
            Log.e(TAG, "openNativeNavigation: lat/lng inválidos");
            call.reject("lat y lng son obligatorios");
            return;
        }
        final double latVal = lat;
        final double lngVal = lng;
        final String pref = getStoredPreference();
        Log.d(TAG, "openNativeNavigation start lat=" + latVal + " lng=" + lngVal + " pref=" + pref);

        final android.app.Activity activity = getActivity();
        if (activity == null || activity.isFinishing()) {
            Log.e(TAG, "Activity no disponible");
            call.reject("Activity no disponible");
            return;
        }

        activity.runOnUiThread(() -> {
            try {
                String uri = null;
                String pkg = null;
                if ("google_maps".equals(pref)) {
                    uri = "google.navigation:q=" + latVal + "," + lngVal;
                    pkg = GOOGLE_MAPS_PACKAGE;
                } else if ("waze".equals(pref)) {
                    uri = "waze://?ll=" + latVal + "," + lngVal + "&navigate=yes";
                    pkg = WAZE_PACKAGE;
                } else if ("browser".equals(pref)) {
                    uri = "https://www.google.com/maps/dir/?api=1&destination=" + latVal + "," + lngVal;
                    Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
                    Intent chooserBrowser = Intent.createChooser(browser, "Abrir con");
                    activity.startActivity(chooserBrowser);
                    Log.d(TAG, "Navigation launched (browser chooser)");
                    call.resolve();
                    return;
                } else {
                    // ask_every_time: URL web para que el chooser muestre Maps + Chrome, Firefox, etc.
                    uri = "https://www.google.com/maps/dir/?api=1&destination=" + latVal + "," + lngVal;
                    pkg = null;
                }

                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
                if (pkg != null && !pkg.isEmpty()) {
                    intent.setPackage(pkg);
                }
                Intent chooser = Intent.createChooser(intent, "Abrir con");
                activity.startActivity(chooser);
                Log.d(TAG, "Navigation launched successfully");
                call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "Error launching navigation", e);
                Toast.makeText(getContext(), "No se pudo abrir navegación", Toast.LENGTH_SHORT).show();
                call.reject("No se pudo abrir: " + (e.getMessage() != null ? e.getMessage() : "error"));
            }
        });
    }

    @PluginMethod
    public void getPreference(PluginCall call) {
        try {
            JSObject ret = new JSObject();
            ret.put("value", getStoredPreference());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "getPreference error", e);
            call.reject("No se pudo leer preferencia");
        }
    }

    @PluginMethod
    public void setPreference(PluginCall call) {
        String value = call.getString("value");
        if (value == null) value = "";
        if ("google_maps".equals(value) || "waze".equals(value) || "browser".equals(value) || "ask_every_time".equals(value)) {
            getPrefs().edit().putString(PREF_KEY, value).apply();
            Log.d(TAG, "setPreference: " + value);
        }
        call.resolve();
    }

    @PluginMethod
    public void openWithChooser(final PluginCall call) {
        final String url = call.getString("url");
        final String packageName = call.getString("package");

        if (url == null || url.isEmpty()) {
            Log.e(TAG, "openWithChooser called without url");
            call.reject("url es obligatoria");
            return;
        }

        Log.d(TAG, "openWithChooser start, url=" + url + ", package=" + packageName);

        final android.app.Activity activity = getActivity();
        if (activity == null || activity.isFinishing()) {
            Log.e(TAG, "openWithChooser: Activity is null or finishing, cannot launch chooser on UI thread");
            call.reject("No se pudo abrir navegación: Activity no disponible");
            return;
        }

        activity.runOnUiThread(() -> {
            try {
                Log.d(TAG, "Lanzando selector desde UI Thread");

                Uri uri = Uri.parse(url);
                Intent intent = new Intent(Intent.ACTION_VIEW, uri);

                if (packageName != null && !packageName.isEmpty()) {
                    Log.d(TAG, "Forzando paquete: " + packageName);
                    intent.setPackage(packageName);
                }

                Intent chooser = Intent.createChooser(intent, "Abrir con");

                Log.d(TAG, "Launching chooser from Activity context");
                activity.startActivity(chooser);

                Log.d(TAG, "Navigation launched successfully");
                call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "Error launching navigation", e);
                call.reject("No se pudo abrir: " + (e.getMessage() != null ? e.getMessage() : "error desconocido"));
            }
        });
    }

    /**
     * Devuelve solo las opciones que el dispositivo puede abrir: Google Maps y Waze si están instalados,
     * más Navegador y Preguntar cada vez (siempre disponibles).
     */
    @PluginMethod
    public void getAvailableApps(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            JSArray arr = new JSArray();

            // Google Maps: intent explícito para que resolveActivity solo devuelva si Maps está instalado
            boolean mapsAvailable = false;
            try {
                Intent mapsIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=0,0"));
                mapsIntent.setPackage(GOOGLE_MAPS_PACKAGE);
                if (pm.resolveActivity(mapsIntent, PackageManager.MATCH_DEFAULT_ONLY) != null) {
                    mapsAvailable = true;
                }
            } catch (Exception e) {
                Log.w(TAG, "resolveActivity google_maps", e);
            }
            JSObject google = new JSObject();
            google.put("id", "google_maps");
            google.put("label", "Google Maps");
            google.put("available", mapsAvailable);
            arr.put(google);

            // Waze
            boolean wazeAvailable = false;
            try {
                Intent wazeIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("waze://?ll=0,0&navigate=yes"));
                wazeIntent.setPackage(WAZE_PACKAGE);
                if (pm.resolveActivity(wazeIntent, PackageManager.MATCH_DEFAULT_ONLY) != null) {
                    wazeAvailable = true;
                }
            } catch (Exception e) {
                Log.w(TAG, "resolveActivity waze", e);
            }
            JSObject waze = new JSObject();
            waze.put("id", "waze");
            waze.put("label", "Waze");
            waze.put("available", wazeAvailable);
            arr.put(waze);

            JSObject browser = new JSObject();
            browser.put("id", "browser");
            browser.put("label", "Navegador");
            browser.put("available", true);
            arr.put(browser);

            JSObject askEveryTime = new JSObject();
            askEveryTime.put("id", "ask_every_time");
            askEveryTime.put("label", "Preguntar cada vez");
            askEveryTime.put("available", true);
            arr.put(askEveryTime);

            JSObject result = new JSObject();
            result.put("value", arr);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Error in getAvailableApps", e);
            call.reject("No se pudieron detectar las apps de navegación");
        }
    }
}
