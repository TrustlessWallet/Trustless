export interface BtcMapTags {
  name?: string;
  amenity?: string;
  category?: string;
  'addr:street'?: string;
  'addr:housenumber'?: string;
  'addr:city'?: string;
  'addr:postcode'?: string;
  'payment:lightning'?: string;
  'payment:onchain'?: string;
  'payment:lightning_contactless'?: string;
  opening_hours?: string;
  website?: string;
  [key: string]: any;
}

export interface BtcMapElement {
  id: string | number;
  lat: number;
  lon: number;
  tags?: BtcMapTags;
}

export const BTC_MAP_API_URL = 'https://api.btcmap.org/v2/elements';

export const btcMapFetcher = async (url: string): Promise<BtcMapElement[]> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`BTCMap API Error: ${response.status}`);
  }
  return response.json();
};