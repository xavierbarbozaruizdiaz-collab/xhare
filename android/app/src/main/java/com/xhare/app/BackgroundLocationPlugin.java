package com.xhare.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

/**
 * Plugin Capacitor para iniciar/detener LocationService y abrir ajustes.
 * Emite evento "sessionExpired" cuando el servicio recibe HTTP 401.
 */
@CapacitorPlugin(name = "BackgroundLocation")
public class BackgroundLocationPlugin extends Plugin {

    private BroadcastReceiver sessionExpiredReceiver;

    @PluginMethod
    public void startTracking(PluginCall call) {
        String serverUrl = call.getString("serverUrl");
        String rideId = call.getString("rideId");
        String token = call.getString("token");
        Long intervalMs = call.getLong("intervalMs", 15000L);

        if (serverUrl == null || rideId == null || token == null) {
            call.reject("serverUrl, rideId y token son obligatorios");
            return;
        }

        registerSessionExpiredReceiver();

        Intent intent = new Intent(getContext(), LocationService.class);
        intent.putExtra(LocationService.EXTRA_SERVER_URL, serverUrl);
        intent.putExtra(LocationService.EXTRA_RIDE_ID, rideId);
        intent.putExtra(LocationService.EXTRA_TOKEN, token);
        intent.putExtra(LocationService.EXTRA_INTERVAL, intervalMs);

        getContext().startForegroundService(intent);

        JSObject ret = new JSObject();
        ret.put("started", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void stopTracking(PluginCall call) {
        unregisterSessionExpiredReceiver();
        Intent intent = new Intent(getContext(), LocationService.class);
        getContext().stopService(intent);
        JSObject ret = new JSObject();
        ret.put("stopped", true);
        call.resolve(ret);
    }

    private void registerSessionExpiredReceiver() {
        if (sessionExpiredReceiver != null) return;
        sessionExpiredReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                notifyListeners("sessionExpired", new JSObject());
            }
        };
        IntentFilter filter = new IntentFilter("com.xhare.app.SESSION_EXPIRED");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(sessionExpiredReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(sessionExpiredReceiver, filter);
        }
    }

    private void unregisterSessionExpiredReceiver() {
        if (sessionExpiredReceiver != null) {
            try {
                getContext().unregisterReceiver(sessionExpiredReceiver);
            } catch (Exception ignored) {}
            sessionExpiredReceiver = null;
        }
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void getDeviceInfo(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("manufacturer", Build.MANUFACTURER != null ? Build.MANUFACTURER : "");
        call.resolve(ret);
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
        } catch (Exception ignored) {}
        call.resolve();
    }

    /** Solicita al sistema mostrar el diálogo "Permitir ignorar optimización de batería" para esta app. */
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            call.resolve();
            return;
        }
        try {
            Intent intent = new Intent();
            intent.setAction(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception ignored) {}
        call.resolve();
    }
}

