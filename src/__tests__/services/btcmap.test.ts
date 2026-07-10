import { btcMapFetcher, BTC_MAP_API_URL, BtcMapElement } from '../../services/btcmap';

// Mock the global fetch function
global.fetch = jest.fn();

describe('btcMapFetcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches and returns btc map elements on a successful response', async () => {
    const mockData: BtcMapElement[] = [
      {
        id: '12345',
        lat: 45.0,
        lon: 9.0,
        tags: {
          name: 'Test Merchant',
          'payment:lightning': 'yes',
        },
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    const result = await btcMapFetcher(BTC_MAP_API_URL);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(BTC_MAP_API_URL);
    expect(result).toEqual(mockData);
  });

  it('throws an error when the response status is not ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    await expect(btcMapFetcher(BTC_MAP_API_URL)).rejects.toThrow('BTCMap API Error: 500');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('bubbles up standard network errors', async () => {
    const networkError = new Error('Network request failed');
    
    (global.fetch as jest.Mock).mockRejectedValueOnce(networkError);

    await expect(btcMapFetcher(BTC_MAP_API_URL)).rejects.toThrow('Network request failed');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});