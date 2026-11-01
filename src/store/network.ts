import { create } from 'zustand';

interface NetworkState {
  online: boolean;
}

export const useNetwork = create<NetworkState>(() => ({ online: navigator.onLine }));

window.addEventListener('online', () => useNetwork.setState({ online: true }));
window.addEventListener('offline', () => useNetwork.setState({ online: false }));
