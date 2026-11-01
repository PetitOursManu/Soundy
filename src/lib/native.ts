// Pont vers le code natif Android (plugin « SoundyAudio », voir
// android/app/src/main/java/fr/soundy/app/SoundyAudioPlugin.java).
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface AudioOutput {
  name: string;
  type: 'bluetooth' | 'wired' | 'speaker' | 'usb' | 'other';
}

export interface PlaybackInfo {
  title?: string;
  artist?: string;
  album?: string;
  playing?: boolean;
  position?: number; // secondes
  duration?: number; // secondes
  stop?: boolean;
}

interface SoundyAudioPlugin {
  getOutputs(): Promise<{ outputs: AudioOutput[] }>;
  openBluetoothSettings(): Promise<void>;
  updatePlayback(info: PlaybackInfo): Promise<void>;
  haptic(opts: { type: 'tick' | 'click' | 'heavy' }): Promise<void>;
  addListener(event: 'mediaAction', cb: (e: { action: string }) => void): Promise<{ remove: () => Promise<void> }>;
}

const SoundyAudio = registerPlugin<SoundyAudioPlugin>('SoundyAudio');

export const isNative = () => Capacitor.isNativePlatform();

export async function getNativeOutputs(): Promise<AudioOutput[]> {
  if (!isNative()) return [];
  try {
    return (await SoundyAudio.getOutputs()).outputs;
  } catch {
    return [];
  }
}

export async function openBluetoothSettings() {
  if (isNative()) await SoundyAudio.openBluetoothSettings();
}

export function updateNativePlayback(info: PlaybackInfo) {
  if (isNative()) SoundyAudio.updatePlayback(info).catch(() => {});
}

export function onNativeMediaAction(cb: (action: string) => void) {
  if (isNative()) void SoundyAudio.addListener('mediaAction', (e) => cb(e.action));
}

export function nativeHaptic(type: 'tick' | 'click' | 'heavy') {
  SoundyAudio.haptic({ type }).catch(() => {});
}
