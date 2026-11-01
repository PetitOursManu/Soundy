package fr.soundy.app;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.Window;

import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashSet;
import java.util.Set;

/**
 * Pont entre l'application web et Android :
 *  - liste des sorties audio connectées (Bluetooth, filaire, USB)
 *  - ouverture des réglages Bluetooth
 *  - service de lecture en arrière-plan + notification + boutons multimédia
 */
@CapacitorPlugin(name = "SoundyAudio")
public class SoundyAudioPlugin extends Plugin {

    @Override
    public void load() {
        PlaybackService.listener = action -> {
            JSObject data = new JSObject();
            data.put("action", action);
            notifyListeners("mediaAction", data);
        };
    }

    @Override
    protected void handleOnDestroy() {
        PlaybackService.listener = null;
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
    }

    @PluginMethod
    public void getOutputs(PluginCall call) {
        JSArray outputs = new JSArray();
        if (Build.VERSION.SDK_INT >= 23) {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            Set<String> seen = new HashSet<>();
            for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                String type = typeOf(d.getType());
                if (type == null) continue;
                // Nom vide = l'application affiche un nom traduit selon la langue choisie
                CharSequence productName = d.getProductName();
                String name = productName != null && productName.length() > 0 ? productName.toString() : "";
                if (type.equals("speaker")) name = "";
                if (!seen.add(type + ":" + name)) continue;
                JSObject o = new JSObject();
                o.put("name", name);
                o.put("type", type);
                outputs.put(o);
            }
        }
        JSObject ret = new JSObject();
        ret.put("outputs", outputs);
        call.resolve(ret);
    }

    @PluginMethod
    public void openBluetoothSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Impossible d'ouvrir les réglages Bluetooth", e);
        }
    }

    @PluginMethod
    public void updatePlayback(PluginCall call) {
        Context ctx = getContext();
        if (call.getBoolean("stop", false)) {
            ctx.stopService(new Intent(ctx, PlaybackService.class));
            call.resolve();
            return;
        }
        String lang = call.getString("lang", null);
        if (lang != null) PlaybackService.lang = lang;
        PlaybackService.State state = new PlaybackService.State(
            call.getString("title", ""),
            call.getString("artist", ""),
            call.getString("album", ""),
            call.getBoolean("playing", false),
            (long) (call.getDouble("position", 0d) * 1000),
            (long) (call.getDouble("duration", 0d) * 1000)
        );
        PlaybackService.pendingState = state;
        PlaybackService service = PlaybackService.instance;
        if (service != null) {
            service.update(state);
        } else if (state.playing) {
            // Démarré uniquement quand la lecture commence (application au premier plan)
            ContextCompat.startForegroundService(ctx, new Intent(ctx, PlaybackService.class));
        }
        call.resolve();
    }

    /**
     * Barres système (barre d'état en haut, barre de navigation en bas) de la
     * couleur du thème choisi dans Soundy, avec des icônes lisibles :
     * sombres sur fond clair, claires sur fond sombre.
     */
    @PluginMethod
    public void setSystemBars(PluginCall call) {
        final String hex = call.getString("color", "");
        final boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        final int color;
        try {
            color = Color.parseColor(hex);
        } catch (IllegalArgumentException e) {
            call.reject("Couleur invalide : " + hex);
            return;
        }
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            window.setStatusBarColor(color);
            window.setNavigationBarColor(color);
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
            controller.setAppearanceLightStatusBars(!dark);
            controller.setAppearanceLightNavigationBars(!dark);
            call.resolve();
        });
    }

    /**
     * Petite vibration (retour haptique du système) :
     *  - "tick"  : très léger, défilement des titres
     *  - "click" : appui sur un bouton
     *  - "heavy" : appui long
     */
    @PluginMethod
    public void haptic(PluginCall call) {
        final String type = call.getString("type", "tick");
        getActivity().runOnUiThread(() -> {
            View view = getBridge().getWebView();
            int constant;
            switch (type) {
                case "click": constant = HapticFeedbackConstants.VIRTUAL_KEY; break;
                case "heavy": constant = HapticFeedbackConstants.LONG_PRESS; break;
                default: constant = HapticFeedbackConstants.CLOCK_TICK;
            }
            boolean done = view != null && view.performHapticFeedback(constant);
            if (!done) vibrateFallback(type);
        });
        call.resolve();
    }

    private void vibrateFallback(String type) {
        Vibrator vibrator = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) return;
        if (Build.VERSION.SDK_INT >= 29) {
            int effect = "heavy".equals(type) ? VibrationEffect.EFFECT_HEAVY_CLICK
                : "click".equals(type) ? VibrationEffect.EFFECT_CLICK : VibrationEffect.EFFECT_TICK;
            vibrator.vibrate(VibrationEffect.createPredefined(effect));
        } else if (Build.VERSION.SDK_INT >= 26) {
            vibrator.vibrate(VibrationEffect.createOneShot("heavy".equals(type) ? 30 : 10, 90));
        } else {
            vibrator.vibrate("heavy".equals(type) ? 30 : 10);
        }
    }

    private static String typeOf(int t) {
        switch (t) {
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
            case 26: // TYPE_BLE_HEADSET (API 31)
            case 27: // TYPE_BLE_SPEAKER (API 31)
                return "bluetooth";
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_LINE_ANALOG:
                return "wired";
            case AudioDeviceInfo.TYPE_USB_DEVICE:
            case AudioDeviceInfo.TYPE_USB_HEADSET:
                return "usb";
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:
                return "speaker";
            default:
                return null;
        }
    }

}
