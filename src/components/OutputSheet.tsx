import { useCallback, useEffect, useState } from 'react';
import { AudioOutput, getNativeOutputs, isNative, openBluetoothSettings } from '../lib/native';
import { audio, usePlayer } from '../store/player';
import { toast } from '../store/toast';
import { IconBluetooth, IconCheck, IconSettings, IconSpeaker } from './Icons';
import { MenuItem, Sheet } from './Sheet';

type MediaDevicesExt = MediaDevices & { selectAudioOutput?: (o?: { deviceId?: string }) => Promise<MediaDeviceInfo> };

const md = () => navigator.mediaDevices as MediaDevicesExt | undefined;
const canPick = () => typeof md()?.selectAudioOutput === 'function';
const canSink = () => 'setSinkId' in HTMLMediaElement.prototype;

/** Appareil de sortie actuellement utilisé (pour l'affichage). */
export function useOutputLabel(open: boolean) {
  const sinkLabel = usePlayer((s) => s.sinkLabel);
  const [native, setNative] = useState<AudioOutput | null>(null);

  useEffect(() => {
    if (!isNative()) return;
    let alive = true;
    const refresh = () =>
      getNativeOutputs().then((outs) => {
        if (!alive) return;
        setNative(outs.find((o) => o.type === 'bluetooth') ?? outs.find((o) => o.type === 'wired' || o.type === 'usb') ?? null);
      });
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open]);

  if (sinkLabel) return { label: sinkLabel, bluetooth: true };
  if (native) return { label: native.name, bluetooth: native.type === 'bluetooth' };
  return { label: null, bluetooth: false };
}

export function OutputSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setSink = usePlayer((s) => s.setSink);
  const current = useOutputLabel(open);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [nativeOutputs, setNativeOutputs] = useState<AudioOutput[]>([]);
  const activeSink = (audio as HTMLAudioElement & { sinkId?: string }).sinkId ?? '';

  const listDevices = useCallback(async () => {
    if (!canSink() || !md()?.enumerateDevices) return;
    const all = await md()!.enumerateDevices();
    setDevices(all.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications'));
  }, []);

  useEffect(() => {
    if (!open) return;
    void listDevices();
    if (isNative()) getNativeOutputs().then(setNativeOutputs);
  }, [open, listDevices]);

  const pick = async () => {
    try {
      const device = await md()!.selectAudioOutput!();
      await setSink(device.deviceId, device.label || 'Appareil externe');
      toast(`Lecture sur ${device.label || "l'appareil choisi"}`, 'success');
      onClose();
    } catch (e) {
      if ((e as DOMException).name !== 'NotAllowedError' && (e as DOMException).name !== 'AbortError') {
        toast("Impossible d'utiliser cet appareil", 'error');
      }
    }
  };

  const unlockLabels = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await listDevices();
    } catch {
      toast("Autorisation refusée : impossible d'afficher le nom des appareils", 'error');
    }
  };

  const choose = async (d: MediaDeviceInfo | null) => {
    try {
      await setSink(d?.deviceId ?? '', d ? d.label || 'Appareil externe' : null);
      toast(d ? `Lecture sur ${d.label || "l'appareil choisi"}` : 'Sortie par défaut', 'success');
      onClose();
    } catch {
      toast("Impossible d'utiliser cet appareil", 'error');
    }
  };

  const labelsHidden = devices.length > 0 && devices.every((d) => !d.label);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Sortie audio"
      description={
        current.label ? (
          <>
            Lecture en cours sur <strong>{current.label}</strong>.
          </>
        ) : (
          'Lecture sur la sortie par défaut de votre appareil.'
        )
      }
    >
      {/* Android natif : appareils connectés détectés par le système */}
      {isNative() && (
        <>
          {nativeOutputs.map((o) => (
            <MenuItem
              key={o.name + o.type}
              icon={o.type === 'bluetooth' ? <IconBluetooth /> : <IconSpeaker />}
              label={o.name}
              hint={o.type === 'bluetooth' ? 'Bluetooth — connecté' : 'Connecté'}
              onClick={onClose}
            />
          ))}
          <MenuItem
            icon={<IconSettings />}
            label="Connecter un appareil Bluetooth"
            hint="Ouvre les réglages Bluetooth d'Android"
            onClick={() => void openBluetoothSettings()}
          />
        </>
      )}

      {/* Navigateur : choix explicite d'une sortie (Chrome, Edge, Firefox…) */}
      {!isNative() && canPick() && (
        <MenuItem
          icon={<IconBluetooth />}
          label="Choisir un appareil…"
          hint="Casque, enceinte Bluetooth, sortie USB…"
          onClick={() => void pick()}
        />
      )}

      {!isNative() && !canPick() && canSink() && (
        <>
          <MenuItem
            icon={!activeSink ? <IconCheck /> : <IconSpeaker />}
            label="Sortie par défaut du système"
            onClick={() => void choose(null)}
          />
          {devices.map((d) => (
            <MenuItem
              key={d.deviceId}
              icon={activeSink === d.deviceId ? <IconCheck /> : /bluetooth|bt|airpods|buds|jbl|bose|sony/i.test(d.label) ? <IconBluetooth /> : <IconSpeaker />}
              label={d.label || 'Appareil audio'}
              onClick={() => void choose(d)}
            />
          ))}
          {labelsHidden && (
            <MenuItem icon={<IconSettings />} label="Afficher le nom des appareils" hint="Nécessite une autorisation du navigateur" onClick={() => void unlockLabels()} />
          )}
        </>
      )}

      {!isNative() && canPick() && activeSink && (
        <MenuItem icon={<IconSpeaker />} label="Revenir à la sortie par défaut" onClick={() => void choose(null)} />
      )}

      <div className="banner" style={{ marginTop: 16, marginBottom: 0 }}>
        <IconBluetooth style={{ color: 'var(--accent)' }} />
        <span>
          Une fois votre casque ou votre enceinte Bluetooth connecté(e) au téléphone, Soundy l'utilise automatiquement. Ses
          boutons (lecture, pause, suivant, précédent) pilotent aussi Soundy.
        </span>
      </div>
    </Sheet>
  );
}
