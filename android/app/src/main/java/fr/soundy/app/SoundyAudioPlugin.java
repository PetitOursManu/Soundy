package fr.soundy.app;

import android.content.Context;
import android.content.Intent;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

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
                CharSequence productName = d.getProductName();
                String name = productName != null && productName.length() > 0 ? productName.toString() : defaultName(type);
                if (type.equals("speaker")) name = "Haut-parleur du téléphone";
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

    private static String defaultName(String type) {
        switch (type) {
            case "bluetooth": return "Appareil Bluetooth";
            case "wired": return "Casque filaire";
            case "usb": return "Appareil USB";
            default: return "Sortie audio";
        }
    }
}
