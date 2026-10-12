import { loadApprovedWorldArt } from './approvedArt';

const urls = new Map<string, string>();
const listeners = new Set<() => void>();
let started = false;
/** One shared decode and one URL per item, regardless of the number of inventory slots. */
export function subscribeItemIcons(listener: () => void): () => void {
  listeners.add(listener);
  if (!started && typeof document !== 'undefined') {
    started = true;
    void loadApprovedWorldArt()
      .then((art) => {
        for (const [id, source] of art.icons) urls.set(id, source.toDataURL('image/png'));
        for (const notify of listeners) notify();
      })
      .catch(() => {
        started = false;
      });
  }
  return () => {
    listeners.delete(listener);
  };
}
export function itemIconUrl(id: string): string | undefined {
  return urls.get(id);
}
