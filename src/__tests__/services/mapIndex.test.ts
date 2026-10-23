import type { BtcMapElement } from '../../services/btcmap';
import { FILTER_GROUPS, getMapIndex, peekMapIndex } from '../../services/mapIndex';

const merchants = (index: ReturnType<typeof getMapIndex>) =>
  index.getClusters([-180, -90, 180, 90], 17)
    .filter(feature => !feature.properties.cluster)
    .map(feature => feature.properties.element as BtcMapElement);

describe('map index reuse', () => {
  const elements: BtcMapElement[] = [
    { id: 'food', lat: 0, lon: 0, tags: { amenity: 'restaurant' } },
    { id: 'hotel', lat: 1, lon: 1, tags: { tourism: 'hotel' } },
    { id: 'unknown', lat: 2, lon: 2, tags: { name: 'Unnamed category' } },
  ];

  it('reuses indexes on revisits and evicts the least recently used of two', () => {
    expect(peekMapIndex(elements, 'food')).toBeNull();
    const food = getMapIndex(elements, 'food');
    const hotels = getMapIndex(elements, 'Hotels');
    expect(getMapIndex(elements, 'food')).toBe(food);
    getMapIndex(elements, 'shopping');
    expect(peekMapIndex(elements, 'Hotels')).toBeNull();
    expect(peekMapIndex(elements, 'food')).toBe(food);
    expect(getMapIndex(elements, 'Hotels')).not.toBe(hotels);
    expect(merchants(food).map(element => element.id)).toEqual(['food']);
  });

  it('rebuilds for a replacement dataset and clears markers for an empty one', () => {
    const original = getMapIndex(elements, null);
    const replacement = [...elements];
    expect(peekMapIndex(replacement, null)).toBeNull();
    expect(getMapIndex(replacement, null)).not.toBe(original);
    expect(merchants(getMapIndex([], null))).toEqual([]);
  });

  it('preserves all six filter definitions and rejects unknown IDs', () => {
    expect(FILTER_GROUPS.map(group => group.id)).toEqual([
      'food', 'shopping', 'services', 'Hotels', 'transport', 'entertainment',
    ]);
    expect(merchants(getMapIndex(elements, null)).map(element => element.id)).toEqual(['food', 'hotel', 'unknown']);
    expect(merchants(getMapIndex(elements, 'Hotels')).map(element => element.id)).toEqual(['hotel']);
    expect(() => getMapIndex(elements, 'hotels')).toThrow('Unknown map filter');
    expect(() => peekMapIndex(elements, 'hotels')).toThrow('Unknown map filter');
  });
});

describe('map point preparation', () => {
  it('classifies only when filtering and remembers categories after index eviction', () => {
    let categoryReads = 0;
    const source: BtcMapElement[] = [{
      id: 'lazy', lat: 1, lon: 2,
      tags: { category: { toString: () => { categoryReads++; return 'restaurant'; } } },
    }];

    expect(merchants(getMapIndex(source, null)).map(merchant => merchant.id)).toEqual(['lazy']);
    expect(categoryReads).toBe(0);
    expect(merchants(getMapIndex(source, 'food')).map(merchant => merchant.id)).toEqual(['lazy']);
    expect(categoryReads).toBe(1);
    getMapIndex(source, 'Hotels');
    getMapIndex(source, 'shopping');
    getMapIndex(source, 'food');
    expect(categoryReads).toBe(1);
  });

  it('reads source coordinates and tags only once per dataset across filter eviction', () => {
    const reads = { lat: 0, lon: 0, tags: 0 };
    const element: BtcMapElement = {
      id: 'observed',
      get lat() { reads.lat++; return 1; },
      get lon() { reads.lon++; return 2; },
      get tags() { reads.tags++; return { amenity: 'restaurant' }; },
    };
    const source = [element];

    expect(merchants(getMapIndex(source, 'food')).map(merchant => merchant.id)).toEqual(['observed']);
    const preparedReads = { ...reads };
    getMapIndex(source, 'Hotels');
    getMapIndex(source, 'shopping'); // Evicts the food index.
    getMapIndex(source, 'food'); // Rebuilds the index from prepared points.
    expect(reads).toEqual(preparedReads);

    getMapIndex([...source], 'food');
    expect(reads.lat).toBeGreaterThan(preparedReads.lat);
    expect(reads.lon).toBeGreaterThan(preparedReads.lon);
    expect(reads.tags).toBeGreaterThan(preparedReads.tags);
  });

  it('uses OSM coordinate precedence, merges tags, and leaves source records untouched', () => {
    const source: BtcMapElement[] = [
      {
        id: 42, lat: 12, lon: 13,
        osm_json: { lat: 0, lon: 0, tags: { amenity: 'restaurant', name: 'OSM' } },
        tags: { name: 'Local' },
      },
      {
        id: 'center', lat: 12, lon: 13,
        osm_json: { center: { lat: 3, lon: 4 }, tags: { tourism: 'hotel' } },
      },
      { id: 'numeric-string', lat: ' -3.5 ', lon: '4.5', tags: { amenity: 'cafe' } },
    ];
    const before = JSON.stringify(source);
    const all = merchants(getMapIndex(source, null));
    expect(all.map(element => [element.id, element.lat, element.lon])).toEqual([
      [42, 0, 0], ['center', 3, 4], ['numeric-string', -3.5, 4.5],
    ]);
    expect(all[0].tags).toEqual({ amenity: 'restaurant', name: 'Local' });
    expect(merchants(getMapIndex(source, 'food')).map(element => element.id)).toEqual([42, 'numeric-string']);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('rejects blanks, non-finite values, and out-of-range coordinates', () => {
    const source: BtcMapElement[] = [
      null as unknown as BtcMapElement,
      { id: 'blank', lat: '', lon: 0 },
      { id: 'whitespace', lat: '  ', lon: 0 },
      { id: 'nan', lat: NaN, lon: 0 },
      { id: 'infinite', lat: Infinity, lon: 0 },
      { id: 'latitude-range', lat: 90.1, lon: 0 },
      { id: 'longitude-range', lat: 0, lon: 180.1 },
      { id: 'valid-boundary', lat: -90, lon: 180 },
    ];
    expect(merchants(getMapIndex(source, null)).map(element => element.id)).toEqual(['valid-boundary']);
  });
});
