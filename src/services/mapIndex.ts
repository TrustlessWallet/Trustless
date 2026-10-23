import Supercluster from 'supercluster';
import type { BtcMapElement } from './btcmap';
import { getCategoryIcon } from './mapCategory';

export const FILTER_GROUPS = [
  { id: 'food', label: 'Food & Drink', icon: 'restaurant', icons: ['restaurant', 'local-cafe', 'local-bar', 'fastfood', 'bakery-dining', 'icecream'] },
  { id: 'shopping', label: 'Shopping', icon: 'local-grocery-store', icons: ['local-grocery-store', 'checkroom', 'devices', 'menu-book', 'card-giftcard', 'chair', 'visibility', 'hardware', 'toys', 'pets', 'watch', 'videogame-asset', 'music-note', 'storefront'] },
  { id: 'services', label: 'Services', icon: 'account-balance', icons: ['account-balance', 'local-pharmacy', 'local-hospital', 'content-cut', 'spa', 'real-estate-agent', 'gavel', 'design-services', 'business', 'school', 'plumbing', 'bolt', 'construction'] },
  { id: 'Hotels', label: 'Hotels', icon: 'hotel', icons: ['hotel', 'apartment'] },
  { id: 'transport', label: 'Transport', icon: 'directions-car', icons: ['pedal-bike', 'two-wheeler', 'directions-car', 'directions-boat', 'local-gas-station', 'local-parking'] },
  { id: 'entertainment', label: 'Entertainment', icon: 'attractions', icons: ['flight', 'movie', 'casino', 'museum', 'fitness-center', 'pool', 'park', 'attractions'] }
] as const;

type MapPoint = Supercluster.PointFeature<{ cluster: false; element: BtcMapElement }>;
type PreparedPoint = { point: MapPoint; icon?: ReturnType<typeof getCategoryIcon> };
type DatasetCache = { prepared: PreparedPoint[]; indexes: Map<string | null, Supercluster> };

// The caller replaces the array reference when its contents change. Weak keys allow old
// SWR datasets to be collected; each live dataset retains at most two loaded indexes.
const datasets = new WeakMap<readonly BtcMapElement[], DatasetCache>();
const MAX_INDEXES_PER_DATASET = 2;

const filterGroup = (filterId: string | null) => {
  if (filterId === null) return null;
  const group = FILTER_GROUPS.find(group => group.id === filterId);
  if (!group) throw new Error(`Unknown map filter: ${filterId}`);
  return group;
};

const coordinate = (value: unknown, limit: number): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
};

const prepare = (elements: readonly BtcMapElement[]): PreparedPoint[] => {
  const prepared: PreparedPoint[] = [];
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue;
    const lat = coordinate(element.osm_json?.lat ?? element.osm_json?.center?.lat ?? element.lat, 90);
    const lon = coordinate(element.osm_json?.lon ?? element.osm_json?.center?.lon ?? element.lon, 180);
    if (lat === null || lon === null) continue;

    const tags = { ...(element.osm_json?.tags || {}), ...(element.tags || {}) };
    const cleanElement: BtcMapElement = { ...element, lat, lon, tags };
    prepared.push({
      point: {
        type: 'Feature',
        properties: { cluster: false, element: cleanElement },
        geometry: { type: 'Point', coordinates: [lon, lat] },
      },
    });
  }
  return prepared;
};

const datasetCache = (elements: readonly BtcMapElement[]): DatasetCache => {
  let cache = datasets.get(elements);
  if (!cache) {
    cache = { prepared: prepare(elements), indexes: new Map() };
    datasets.set(elements, cache);
  }
  return cache;
};

export const peekMapIndex = (elements: readonly BtcMapElement[], filterId: string | null): Supercluster | null => {
  filterGroup(filterId);
  return datasets.get(elements)?.indexes.get(filterId) ?? null;
};

export const getMapIndex = (elements: readonly BtcMapElement[], filterId: string | null): Supercluster => {
  const group = filterGroup(filterId);
  const cache = datasetCache(elements);
  const existing = cache.indexes.get(filterId);
  if (existing) {
    cache.indexes.delete(filterId);
    cache.indexes.set(filterId, existing);
    return existing;
  }

  const points = group
    ? cache.prepared.filter(prepared => {
      prepared.icon ??= getCategoryIcon(prepared.point.properties.element.tags);
      return (group.icons as readonly string[]).includes(prepared.icon);
    }).map(({ point }) => point)
    : cache.prepared.map(({ point }) => point);
  const index = new Supercluster({ radius: 70, maxZoom: 16 });
  index.load(points);
  cache.indexes.set(filterId, index);
  if (cache.indexes.size > MAX_INDEXES_PER_DATASET) {
    cache.indexes.delete(cache.indexes.keys().next().value!);
  }
  return index;
};
