import { PurchasesClient, statusFromCustomerInfo, TerminalProService, TerminalProDependencies } from '../../services/terminalPro';

const freeInfo = { entitlements: { verification: 'VERIFIED', active: {} } } as const;
const proInfo = { entitlements: { verification: 'VERIFIED', active: { terminal_pro: { isActive: true, verification: 'VERIFIED' } } } } as const;
const unverifiedInfo = { entitlements: { verification: 'FAILED', active: { terminal_pro: { isActive: true, verification: 'FAILED' } } } } as const;
const monthly = { identifier: '$rc_monthly', product: { identifier: 'com.btc.trustless.terminal.pro.monthly', priceString: '€4,99', introPrice: { price: 0, cycles: 1, periodUnit: 'DAY', periodNumberOfUnits: 14 } } };
const annual = { identifier: '$rc_annual', product: { identifier: 'com.btc.trustless.terminal.pro.annual', priceString: '€49,99', introPrice: null } };

function harness(options: Partial<TerminalProDependencies> = {}) {
  let infoListener: ((info: any) => void) | undefined;
  const client = {
    ENTITLEMENT_VERIFICATION_MODE: { INFORMATIONAL: 'INFORMATIONAL' },
    INTRO_ELIGIBILITY_STATUS: { INTRO_ELIGIBILITY_STATUS_ELIGIBLE: 'ELIGIBLE' },
    PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: '1', PAYMENT_PENDING_ERROR: '20' },
    isConfigured: jest.fn().mockResolvedValue(false),
    configure: jest.fn(),
    addCustomerInfoUpdateListener: jest.fn((listener) => { infoListener = listener; }),
    removeCustomerInfoUpdateListener: jest.fn(),
    getCustomerInfo: jest.fn().mockResolvedValue(freeInfo),
    getOfferings: jest.fn().mockResolvedValue({ all: { terminal_pro: { identifier: 'terminal_pro', availablePackages: [monthly, annual] } } }),
    checkTrialOrIntroductoryPriceEligibility: jest.fn().mockResolvedValue({
      [monthly.product.identifier]: { status: 'ELIGIBLE' },
      [annual.product.identifier]: { status: 'INELIGIBLE' },
    }),
    purchasePackage: jest.fn().mockResolvedValue({ customerInfo: proInfo }),
    restorePurchases: jest.fn().mockResolvedValue(proInfo),
    showManageSubscriptions: jest.fn().mockResolvedValue(undefined),
  };
  const deps: TerminalProDependencies = {
    platform: 'ios', iosKey: 'appl_public', isDev: false,
    loadClient: jest.fn().mockResolvedValue(client), openURL: jest.fn().mockResolvedValue(undefined),
    ...options,
  };
  const service = new TerminalProService(deps);
  return { service, client, deps, emit: (info: any) => infoListener?.(info) };
}

afterEach(() => jest.clearAllMocks());

it('requires trusted verification for both the entitlement set and active Pro entitlement', () => {
  expect(statusFromCustomerInfo(proInfo)).toBe('pro');
  expect(statusFromCustomerInfo(freeInfo)).toBe('free');
  expect(statusFromCustomerInfo(unverifiedInfo)).toBe('unavailable');
  expect(statusFromCustomerInfo({ entitlements: { verification: 'VERIFIED', active: { terminal_pro: { isActive: true, verification: 'NOT_REQUESTED' } } } })).toBe('unavailable');
  expect(statusFromCustomerInfo({ entitlements: { verification: 'VERIFIED_ON_DEVICE', active: { terminal_pro: { isActive: true, verification: 'VERIFIED_ON_DEVICE' } } } })).toBe('pro');
});

it('fails safely without a public key or a native SDK', async () => {
  const missingKey = harness({ iosKey: undefined });
  await missingKey.service.initialize();
  expect(missingKey.service.getSnapshot().status).toBe('unavailable');
  expect(missingKey.deps.loadClient).not.toHaveBeenCalled();
  const missingNative = harness({ loadClient: jest.fn().mockRejectedValue(new Error('Native module missing')) });
  await missingNative.service.initialize();
  expect(missingNative.service.getSnapshot().status).toBe('unavailable');
});

it('configures anonymous verified SDK access and follows customer updates', async () => {
  const { service, client, emit } = harness();
  await service.initialize();
  expect(client.configure).toHaveBeenCalledWith({ apiKey: 'appl_public', entitlementVerificationMode: 'INFORMATIONAL', shouldShowInAppMessagesAutomatically: false, diagnosticsEnabled: false, automaticDeviceIdentifierCollectionEnabled: false });
  expect(service.getSnapshot().status).toBe('free');
  emit(proInfo);
  expect(service.getSnapshot().status).toBe('pro');
  service.dispose();
  expect(client.removeCustomerInfoUpdateListener).toHaveBeenCalledTimes(1);
});

it('keeps a verified Pro result when a later fetch fails, but honors a verified revocation', async () => {
  const { service, client, emit } = harness();
  await service.initialize();
  emit(proInfo);
  client.getCustomerInfo.mockRejectedValueOnce(new Error('offline'));
  await service.refresh();
  expect(service.getSnapshot().status).toBe('pro');
  emit(freeInfo);
  expect(service.getSnapshot().status).toBe('free');
});

it('uses localized store prices and only displays a confirmed eligible trial', async () => {
  const { service, client } = harness();
  await service.initialize();
  await service.loadPlans();
  expect(service.getSnapshot().plans).toEqual([
    { id: 'monthly', price: '€4,99', periodLabel: 'month', renewalLabel: '€4,99 per month', trialLabel: '14 days free trial' },
    { id: 'annual', price: '€49,99', periodLabel: 'year', renewalLabel: '€49,99 per year' },
  ]);
  client.checkTrialOrIntroductoryPriceEligibility.mockRejectedValueOnce(new Error('unknown'));
  await service.loadPlans();
  expect(service.getSnapshot().plans[0].trialLabel).toBeUndefined();
});

it('allows explicit development Test Store product IDs and rejects test keys in release', async () => {
  const testMonthly = { ...monthly, product: { ...monthly.product, identifier: 'monthly' } };
  const testAnnual = { ...annual, product: { ...annual.product, identifier: 'yearly' } };
  const dev = harness({ isDev: true, testKey: 'test_public' });
  dev.client.getOfferings.mockResolvedValueOnce({ all: { terminal_pro: { identifier: 'terminal_pro', availablePackages: [testMonthly, testAnnual] } } });
  await dev.service.initialize();
  await dev.service.loadPlans();
  expect(dev.client.configure).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'test_public' }));
  expect(dev.service.getSnapshot().plans.map(plan => plan.id)).toEqual(['monthly', 'annual']);
  const release = harness({ iosKey: 'test_public', isDev: false });
  await release.service.initialize();
  expect(release.service.getSnapshot().status).toBe('unavailable');
  expect(release.deps.loadClient).not.toHaveBeenCalled();
});

it('does not grant access on cancelled, pending, or unverified purchases and blocks a second purchase', async () => {
  const { service, client, emit } = harness();
  await service.initialize();
  await service.loadPlans();
  client.purchasePackage.mockRejectedValueOnce({ userCancelled: true, code: '1' });
  expect(await service.purchase('monthly')).toBe(false);
  expect(service.getSnapshot().error).toBeNull();
  client.purchasePackage.mockRejectedValueOnce({ code: '20' });
  expect(await service.purchase('monthly')).toBe(false);
  expect(service.getSnapshot().pending).toBe(true);
  expect(service.getSnapshot().error).toBeNull();
  expect(await service.purchase('annual')).toBe(false);
  expect(client.purchasePackage).toHaveBeenCalledTimes(2);
  emit(proInfo);
  emit(freeInfo);
  client.purchasePackage.mockResolvedValueOnce({ customerInfo: unverifiedInfo });
  expect(await service.purchase('monthly')).toBe(false);
  expect(service.getSnapshot().status).toBe('unavailable');
  let release!: (value: { customerInfo: typeof proInfo }) => void;
  client.purchasePackage.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const first = service.purchase('monthly');
  await Promise.resolve();
  expect(await service.purchase('annual')).toBe(false);
  release({ customerInfo: proInfo });
  expect(await first).toBe(true);
  expect(client.purchasePackage).toHaveBeenCalledTimes(4);
});

it('restores only a verified active entitlement and opens native subscription management', async () => {
  const { service, client } = harness();
  await service.initialize();
  client.restorePurchases.mockResolvedValueOnce(freeInfo);
  expect(await service.restore()).toBe(false);
  expect(service.getSnapshot().status).toBe('free');
  expect(await service.restore()).toBe(true);
  expect(service.getSnapshot().status).toBe('pro');
  await service.manage();
  expect(client.showManageSubscriptions).toHaveBeenCalledTimes(1);
});


it('retries a failed SDK setup without restarting', async () => {
  const { service, deps, client } = harness();
  (deps.loadClient as jest.Mock).mockRejectedValueOnce(new Error('not ready'));
  await service.initialize();
  expect(service.getSnapshot().status).toBe('unavailable');
  await service.refresh();
  expect(client.configure).toHaveBeenCalledTimes(1);
  expect(service.getSnapshot().status).toBe('free');
});

it('does not let an older fetch revoke a newer verified listener result', async () => {
  const { service, client, emit } = harness();
  await service.initialize();
  let resolve!: (info: typeof freeInfo) => void;
  client.getCustomerInfo.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const refreshing = service.refresh();
  await Promise.resolve();
  emit(proInfo);
  resolve(freeInfo);
  await refreshing;
  expect(service.getSnapshot().status).toBe('pro');
});

it('honors signed SDK activity during the store billing grace period', () => {
  expect(statusFromCustomerInfo({ entitlements: { verification: 'VERIFIED', active: { terminal_pro: { isActive: true, verification: 'VERIFIED', expirationDateMillis: Date.now() - 1000 } } } })).toBe('pro');
});

it('accepts a newer verified purchase despite an intervening cached free callback', async () => {
  const { service, client, emit } = harness();
  await service.initialize();
  await service.loadPlans();
  let resolve!: (info: any) => void;
  client.purchasePackage.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const purchasing = service.purchase('annual');
  await Promise.resolve();
  emit({ ...freeInfo, requestDateMillis: 100 });
  resolve({ customerInfo: { ...proInfo, requestDateMillis: 200 } });
  expect(await purchasing).toBe(true);
  emit({ ...freeInfo, requestDateMillis: 150 });
  expect(service.getSnapshot().status).toBe('pro');
  emit({ ...freeInfo, requestDateMillis: 300 });
  expect(service.getSnapshot().status).toBe('free');
});

it('shares the initial subscription check across concurrent Pro opens', async () => {
  const { service, client } = harness();
  let resolve!: (info: typeof freeInfo) => void;
  let started!: () => void;
  const requested = new Promise<void>(done => { started = done; });
  client.getCustomerInfo.mockImplementationOnce(() => {
    started();
    return new Promise(done => { resolve = done; });
  });
  const opening = service.refresh();
  const reopening = service.refresh();
  const plans = service.loadPlans();
  await requested;
  expect(client.getCustomerInfo).toHaveBeenCalledTimes(1);
  resolve(freeInfo);
  await Promise.all([opening, reopening, plans]);
  expect(client.getCustomerInfo).toHaveBeenCalledTimes(1);
  expect(service.getSnapshot().status).toBe('free');
  service.dispose();
});

it('shares an in-flight refresh and permits a fresh check after failure', async () => {
  const { service, client } = harness();
  await service.initialize();
  let reject!: (reason: Error) => void;
  client.getCustomerInfo.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const first = service.refresh();
  const second = service.refresh();
  expect(client.getCustomerInfo).toHaveBeenCalledTimes(2);
  reject(new Error('offline'));
  await Promise.all([first, second]);
  expect(service.getSnapshot().status).toBe('unavailable');
  await service.refresh();
  expect(client.getCustomerInfo).toHaveBeenCalledTimes(3);
  expect(service.getSnapshot().status).toBe('free');
  service.dispose();
});

it('keeps management busy and prevents overlapping management, purchase and restore', async () => {
  const { service, client } = harness();
  await service.initialize();
  let finish!: () => void;
  client.showManageSubscriptions.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const managing = service.manage();
  expect(service.getSnapshot().busy).toBe(true);
  await Promise.resolve();
  await service.manage();
  expect(await service.purchase('monthly')).toBe(false);
  expect(await service.restore()).toBe(false);
  expect(client.showManageSubscriptions).toHaveBeenCalledTimes(1);
  expect(client.purchasePackage).not.toHaveBeenCalled();
  expect(client.restorePurchases).not.toHaveBeenCalled();
  finish();
  await managing;
  expect(service.getSnapshot().busy).toBe(false);
  service.dispose();
});

it('releases management loading after an error and allows retry', async () => {
  const { service, client } = harness();
  await service.initialize();
  await service.loadPlans();
  client.showManageSubscriptions.mockRejectedValueOnce(new Error('unavailable'));
  await service.manage();
  expect(service.getSnapshot()).toMatchObject({ busy: false, error: 'Could not open subscription management.' });
  await service.manage();
  expect(client.showManageSubscriptions).toHaveBeenCalledTimes(2);
  expect(service.getSnapshot()).toMatchObject({ busy: false, error: null });
  service.dispose();
});

it('shares management URL lookup with a pending foreground refresh', async () => {
  const { service, client, deps } = harness({ platform: 'android', androidKey: 'goog_public' });
  await service.initialize();
  await service.loadPlans();
  let resolve!: (info: any) => void;
  client.getCustomerInfo.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const refreshing = service.refresh();
  const managing = service.manage();
  await Promise.resolve();
  expect(client.getCustomerInfo).toHaveBeenCalledTimes(2);
  resolve({ ...freeInfo, managementURL: 'https://play.google.com/store/account/subscriptions?package=com.btc.trustless' });
  await Promise.all([refreshing, managing]);
  expect(client.getCustomerInfo).toHaveBeenCalledTimes(2);
  expect(deps.openURL).toHaveBeenCalledWith('https://play.google.com/store/account/subscriptions?package=com.btc.trustless');
  expect(service.getSnapshot().busy).toBe(false);
  service.dispose();
});
