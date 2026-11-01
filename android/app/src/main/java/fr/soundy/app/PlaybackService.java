package fr.soundy.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/**
 * Service de premier plan qui maintient Soundy actif pendant la lecture
 * (écran éteint, application en arrière-plan) et expose une MediaSession :
 * notification avec contrôles, écran de verrouillage, boutons des casques
 * et enceintes Bluetooth, commandes de la voiture…
 */
public class PlaybackService extends Service {

    public interface Listener { void onAction(String action); }

    public static final class State {
        final String title, artist, album;
        final boolean playing;
        final long positionMs, durationMs;

        State(String title, String artist, String album, boolean playing, long positionMs, long durationMs) {
            this.title = title;
            this.artist = artist;
            this.album = album;
            this.playing = playing;
            this.positionMs = positionMs;
            this.durationMs = durationMs;
        }
    }

    static final String CHANNEL_ID = "soundy_playback";
    static final int NOTIFICATION_ID = 1101;
    static final String ACTION_MEDIA = "fr.soundy.app.MEDIA";
    static final String EXTRA_ACTION = "action";

    static volatile Listener listener;
    static volatile PlaybackService instance;
    static volatile State pendingState;

    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaSessionCompat session;
    private State state;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        session = new MediaSessionCompat(this, "Soundy");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { emit("play"); }
            @Override public void onPause() { emit("pause"); }
            @Override public void onSkipToNext() { emit("nexttrack"); }
            @Override public void onSkipToPrevious() { emit("previoustrack"); }
            @Override public void onStop() { emit("pause"); }
        });
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        session.setSessionActivity(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        session.setActive(true);
        instance = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_MEDIA.equals(intent.getAction())) {
            String action = intent.getStringExtra(EXTRA_ACTION);
            if ("close".equals(action)) {
                emit("pause");
                stopSelf();
                return START_NOT_STICKY;
            }
            if (action != null) emit(action);
            if (state == null) stopSelf();
            return START_NOT_STICKY;
        }
        State s = pendingState != null ? pendingState : new State("Soundy", "", "", false, 0, 0);
        update(s);
        return START_NOT_STICKY;
    }

    /** Met à jour la session et la notification. */
    public void update(State s) {
        main.post(() -> {
            state = s;
            session.setMetadata(new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, s.title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, s.artist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, s.album)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, s.durationMs)
                .build());
            session.setPlaybackState(new PlaybackStateCompat.Builder()
                .setActions(PlaybackStateCompat.ACTION_PLAY
                    | PlaybackStateCompat.ACTION_PAUSE
                    | PlaybackStateCompat.ACTION_PLAY_PAUSE
                    | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                    | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                    | PlaybackStateCompat.ACTION_STOP)
                .setState(s.playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                    s.positionMs, s.playing ? 1f : 0f)
                .build());

            Notification n = buildNotification(s);
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
        });
    }

    private Notification buildNotification(State s) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_soundy)
            .setContentTitle(s.title)
            .setContentText(s.artist)
            .setSubText(s.album)
            .setContentIntent(content)
            .setOngoing(s.playing)
            .setSilent(true)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .addAction(android.R.drawable.ic_media_previous, "Précédent", mediaIntent("previoustrack", 1))
            .addAction(s.playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                s.playing ? "Pause" : "Lecture", mediaIntent(s.playing ? "pause" : "play", 2))
            .addAction(android.R.drawable.ic_media_next, "Suivant", mediaIntent("nexttrack", 3))
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Fermer", mediaIntent("close", 4))
            .setDeleteIntent(mediaIntent("close", 5))
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2));
        return b.build();
    }

    private PendingIntent mediaIntent(String action, int requestCode) {
        Intent i = new Intent(this, PlaybackService.class).setAction(ACTION_MEDIA).putExtra(EXTRA_ACTION, action);
        return PendingIntent.getService(this, requestCode, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Lecture en cours", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Contrôles de lecture de Soundy");
            ch.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private void emit(String action) {
        Listener l = listener;
        if (l != null) main.post(() -> l.onAction(action));
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
    }

    @Override
    public void onDestroy() {
        instance = null;
        if (session != null) {
            session.setActive(false);
            session.release();
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
