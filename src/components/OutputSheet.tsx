import { useCallback, useEffect, useState } from 'react';
import { AudioOutput, getNativeOutputs, isNative, openBluetoothSettings } from '../lib/native';
import { audio, usePlayer } from '../store/player';
import { toast } from '../store/toast';
import { IconBluetooth, IconCheck, IconSettings, IconSpeaker } from './Icons';
import { MenuItem, Sheet } from './Sheet';
import { useT } from '../i18n';

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
  const { t } = useT();
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
      await setSink(device.deviceId, device.label || t('output.external'));
      toast(t('output.playingOnToast', { device: device.label || t('output.chosenDevice') }), 'success');
      onClose();
    } catch (e) {
      if ((e as DOMException).name !== 'NotAllowedError' && (e as DOMException).name !== 'AbortError') {
        toast(t('output.cannotUse'), 'error');
      }
    }
  };

  const unlockLabels = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await listDevices();
    } catch {
      toast(t('output.denied'), 'error');
    }
  };

  const choose = async (d: MediaDeviceInfo | null) => {
    try {
      await setSink(d?.deviceId ?? '', d ? d.label || t('output.external') : null);
      toast(d ? t('output.playingOnToast', { device: d.label || t('output.chosenDevice') }) : t('output.defaultToast'), 'success');
      onClose();
    } catch {
      toast(t('output.cannotUse'), 'error');
    }
  };

  const labelsHidden = devices.length > 0 && devices.every((d) => !d.label);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('output.title')}
      description={
        current.label ? (
          <>
            {(() => {
              const [before, after] = t('output.playingOn', { device: '\u0000' }).split('\u0000');
              return (
                <>
                  {before}
                  <strong>{current.label}</strong>
                  {after}
                </>
              );
            })()}
          </>
        ) : (
          t('output.default')
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
              hint={o.type === 'bluetooth' ? t('output.btConnected') : t('output.connected')}
              onClick={onClose}
            />
          ))}
          <MenuItem
            icon={<IconSettings />}
            label={t('output.connectBt')}
            hint={t('output.connectBtHint')}
            onClick={() => void openBluetoothSettings()}
          />
        </>
      )}

      {/* Navigateur : choix explicite d'une sortie (Chrome, Edge, Firefox…) */}
      {!isNative() && canPick() && (
        <MenuItem
          icon={<IconBluetooth />}
          label={t('output.choose')}
          hint={t('output.chooseHint')}
          onClick={() => void pick()}
        />
      )}

      {!isNative() && !canPick() && canSink() && (
        <>
          <MenuItem
            icon={!activeSink ? <IconCheck /> : <IconSpeaker />}
            label={t('output.systemDefault')}
            onClick={() => void choose(null)}
          />
          {devices.map((d) => (
            <MenuItem
              key={d.deviceId}
              icon={activeSink === d.deviceId ? <IconCheck /> : /bluetooth|bt|airpods|buds|jbl|bose|sony/i.test(d.label) ? <IconBluetooth /> : <IconSpeaker />}
              label={d.label || t('output.audioDevice')}
              onClick={() => void choose(d)}
            />
          ))}
          {labelsHidden && (
            <MenuItem icon={<IconSettings />} label={t('output.showNames')} hint={t('output.showNamesHint')} onClick={() => void unlockLabels()} />
          )}
        </>
      )}

      {!isNative() && canPick() && activeSink && (
        <MenuItem icon={<IconSpeaker />} label={t('output.backToDefault')} onClick={() => void choose(null)} />
      )}

      <div className="banner" style={{ marginTop: 16, marginBottom: 0 }}>
        <IconBluetooth style={{ color: 'var(--accent)' }} />
        <span>
          {t('output.help')}
        </span>
      </div>
    </Sheet>
  );
}
