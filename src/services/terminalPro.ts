import { Linking, Platform } from 'react-native';

export type ProStatus = 'loading' | 'free' | 'pro' | 'unavailable';
export type ProPlanId = 'monthly' | 'annual';
export type ProPlan = {
  id: ProPlanId;
  price: string;
  periodLabel: string;
  trialLabel?: string;
  renewalLabel?: string;
};
export type TerminalProSnapshot = {
  status: ProStatus;
  pending: boolean;
  plans: ProPlan[];
  loadingPlans: boolean;
  busy: boolean;
  error: string | null;
};

export const TERMINAL_PRO_ENTITLEMENT = 'terminal_pro';
export const TERMINAL_PRO_OFFERING = 'terminal_pro';
export const TERMINAL_PRO_PRODUCTS: Record<ProPlanId, string> = {
  monthly: 'com.btc.trustless.terminal.pro.monthly',
  annual: 'com.btc.trustless.terminal.pro.annual',
};

type Verification = 'VERIFIED' | 'VERIFIED_ON_DEVICE' | 'FAILED' | 'NOT_REQUESTED';
type CustomerInfo = {
  requestDateMillis?: number;
  requestDate?: string;
  entitlements?: {
    verification?: Verification;
    active?: Record<string, { isActive?: boolean; verification?: Verification; expirationDateMillis?: number | null }>;
  };
  managementURL?: string | null;
};
type StorePackage = {
  identifier: string;
  product: {
    identifier: string;
    priceString: string;
    introPrice?: { price?: number; cycles?: number; periodUnit?: string; periodNumberOfUnits?: number } | null;
    defaultOption?: { freePhase?: { billingCycleCount?: number | null; billingPeriod?: { unit?: string; value?: number } } | null } | null;
  };
};
type Offering = { identifier: string; availablePackages: StorePackage[] };
export type PurchasesClient = {
  ENTITLEMENT_VERIFICATION_MODE: { INFORMATIONAL: string };
  INTRO_ELIGIBILITY_STATUS: { INTRO_ELIGIBILITY_STATUS_ELIGIBLE: string };
  PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: string; PAYMENT_PENDING_ERROR: string };
  isConfigured(): Promise<boolean>;
  configure(options: { apiKey: string; entitlementVerificationMode: string; shouldShowInAppMessagesAutomatically: boolean; diagnosticsEnabled: boolean; automaticDeviceIdentifierCollectionEnabled: boolean }): void | Promise<void>;
  addCustomerInfoUpdateListener(listener: (info: CustomerInfo) => void): void;
  removeCustomerInfoUpdateListener(listener: (info: CustomerInfo) => void): void;
  getCustomerInfo(): Promise<CustomerInfo>;
  getOfferings(): Promise<{ all?: Record<string, Offering>; current?: Offering | null }>;
  checkTrialOrIntroductoryPriceEligibility(ids: string[]): Promise<Record<string, { status: string }>>;
  purchasePackage(pkg: StorePackage): Promise<{ customerInfo: CustomerInfo }>;
  restorePurchases(): Promise<CustomerInfo>;
  showManageSubscriptions?(): Promise<void>;
};

export type TerminalProDependencies = {
  platform: string;
  iosKey?: string;
  androidKey?: string;
  testKey?: string;
  isDev: boolean;
  loadClient: () => Promise<PurchasesClient>;
  openURL: (url: string) => Promise<unknown>;
};

const trusted = (result: Verification | undefined): boolean => result === 'VERIFIED' || result === 'VERIFIED_ON_DEVICE';

/** A verified empty entitlement set means free; missing verification means unavailable. */
export function statusFromCustomerInfo(info: CustomerInfo): ProStatus {
  const entitlements = info.entitlements;
  if (!entitlements || !trusted(entitlements.verification)) return 'unavailable';
  const pro = entitlements.active?.[TERMINAL_PRO_ENTITLEMENT];
  if (pro && !trusted(pro.verification)) return 'unavailable';
  if (pro?.isActive && trusted(pro.verification)) return 'pro';
  return 'free';
}

function trialDuration(value: number | undefined, unit: string | undefined, cycles = 1): string | undefined {
  if (!Number.isInteger(value) || !Number.isInteger(cycles) || !value || !cycles || value < 1 || cycles < 1) return undefined;
  const count = value * cycles;
  const unitName = ({ DAY: 'day', WEEK: 'week', MONTH: 'month', YEAR: 'year' } as Record<string, string>)[unit ?? ''];
  return unitName ? `${count} ${unitName}${count === 1 ? '' : 's'}` : undefined;
}

function publicKey(deps: TerminalProDependencies): string | undefined {
  const platformKey = deps.platform === 'ios' ? deps.iosKey : deps.platform === 'android' ? deps.androidKey : undefined;
  const key = (deps.isDev ? deps.testKey?.trim() : undefined) || platformKey?.trim();
  if (!key || (!deps.isDev && key.startsWith('test_'))) return undefined;
  return key;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
}

function cancelled(error: unknown, client: PurchasesClient): boolean {
  return (typeof error === 'object' && error !== null && 'userCancelled' in error && error.userCancelled === true)
    || errorCode(error) === client.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR;
}

export class TerminalProService {
  private snapshot: TerminalProSnapshot = { status: 'loading', pending: false, plans: [], loadingPlans: false, busy: false, error: null };
  private listeners = new Set<(snapshot: TerminalProSnapshot) => void>();
  private client: PurchasesClient | null = null;
  private initPromise: Promise<void> | null = null;
  private plansPromise: Promise<void> | null = null;
  private packages = new Map<ProPlanId, StorePackage>();
  private lastInfo: CustomerInfo | null = null;
  private testStore = false;
  private expirationTimer: ReturnType<typeof setTimeout> | null = null;
  private infoRevision = 0;
  private mutating = false;
  private disposed = false;
  private readonly onCustomerInfo = (info: CustomerInfo) => this.acceptCustomerInfo(info);

  constructor(private readonly deps: TerminalProDependencies) {}

  getSnapshot = (): TerminalProSnapshot => this.snapshot;

  subscribe = (listener: (snapshot: TerminalProSnapshot) => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(change: Partial<TerminalProSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach(listener => listener(this.snapshot));
  }

  private acceptCustomerInfo(info: CustomerInfo): void {
    if (this.disposed) return;
    const timestamp = (value: CustomerInfo | null) => value?.requestDateMillis ?? (value?.requestDate ? Date.parse(value.requestDate) : NaN);
    // Store callbacks and foreground reads can complete out of order. The SDK's
    // signed response date takes precedence over callback arrival order.
    if (Number.isFinite(timestamp(info)) && Number.isFinite(timestamp(this.lastInfo)) && timestamp(info) < timestamp(this.lastInfo)) return;
    ++this.infoRevision;
    this.lastInfo = info;
    if (this.expirationTimer) clearTimeout(this.expirationTimer);
    this.scheduleExpiration(info);
    const status = statusFromCustomerInfo(info);
    this.publish({ status, ...(status === 'pro' ? { pending: false } : {}) });
  }

  private scheduleExpiration(info: CustomerInfo): void {
    const expiresAt = info.entitlements?.active?.[TERMINAL_PRO_ENTITLEMENT]?.expirationDateMillis;
    if (!expiresAt || expiresAt <= Date.now() || this.disposed) return;
    this.expirationTimer = setTimeout(() => {
      void this.refresh();
    }, Math.min(expiresAt - Date.now() + 1, 2_147_483_647));
  }

  initialize = (): Promise<void> => {
    if (this.initPromise) return this.initPromise;
    if (this.client) return Promise.resolve();
    const apiKey = publicKey(this.deps);
    if (!apiKey || this.disposed) {
      this.publish({ status: 'unavailable' });
      return Promise.resolve();
    }
    this.testStore = this.deps.isDev && apiKey.startsWith('test_');
    this.initPromise = (async () => {
      try {
        const client = await this.deps.loadClient();
        if (this.disposed) return;
        if (!(await client.isConfigured())) {
          await client.configure({ apiKey, entitlementVerificationMode: client.ENTITLEMENT_VERIFICATION_MODE.INFORMATIONAL, shouldShowInAppMessagesAutomatically: false, diagnosticsEnabled: false, automaticDeviceIdentifierCollectionEnabled: false });
        }
        if (this.disposed) return;
        this.client = client;
        client.addCustomerInfoUpdateListener(this.onCustomerInfo);
        await this.fetchCustomerInfo();
        void this.loadPlans();
      } catch {
        this.publish({ status: this.snapshot.status === 'pro' ? 'pro' : 'unavailable', error: 'Subscriptions are unavailable right now.' });
      }
    })().finally(() => { this.initPromise = null; });
    return this.initPromise;
  };

  private async fetchCustomerInfo(): Promise<void> {
    if (!this.client) return;
    const revision = this.infoRevision;
    try {
      const info = await this.client.getCustomerInfo();
      if (revision !== this.infoRevision) return;
      this.acceptCustomerInfo(info);
      this.publish({ error: null });
    } catch {
      if (revision !== this.infoRevision) return;
      // The SDK controls cached entitlement expiry. A failed fetch cannot revoke a verified result.
      this.publish({ status: this.snapshot.status === 'pro' ? 'pro' : 'unavailable', error: 'Could not check your subscription. Please try again.' });
    }
  }

  refresh = async (): Promise<void> => {
    await this.initialize();
    await this.fetchCustomerInfo();
  };

  loadPlans = (): Promise<void> => {
    if (this.plansPromise) return this.plansPromise;
    this.plansPromise = this.loadPlansImpl().finally(() => { this.plansPromise = null; });
    return this.plansPromise;
  };

  private async loadPlansImpl(): Promise<void> {
    await this.initialize();
    if (!this.client || this.disposed) return;
    this.publish({ loadingPlans: true });
    try {
      const offerings = await this.client.getOfferings();
      const offering = offerings.all?.[TERMINAL_PRO_OFFERING]
        ?? (offerings.current?.identifier === TERMINAL_PRO_OFFERING ? offerings.current : undefined);
      if (!offering) throw new Error('Terminal Pro offering missing');
      const packages = new Map<ProPlanId, StorePackage>();
      for (const pkg of offering.availablePackages) {
        for (const id of ['monthly', 'annual'] as const) {
          const productId = this.testStore ? (id === 'monthly' ? 'monthly' : 'yearly') : TERMINAL_PRO_PRODUCTS[id];
          const matches = pkg.product.identifier === productId || (!this.testStore && this.deps.platform === 'android' && pkg.product.identifier.startsWith(`${productId}:`));
          if (matches && pkg.product.priceString) packages.set(id, pkg);
        }
      }
      if (packages.size === 0) throw new Error('Terminal Pro products missing');
      let eligibility: Record<string, { status: string }> = {};
      if (this.deps.platform === 'ios') {
        try { eligibility = await this.client.checkTrialOrIntroductoryPriceEligibility([...packages.values()].map(pkg => pkg.product.identifier)); }
        catch { /* Unknown eligibility never creates a trial claim. */ }
      }
      this.packages = packages;
      const plans: ProPlan[] = [...packages.entries()].map(([id, pkg]) => {
        const periodLabel = id === 'monthly' ? 'month' : 'year';
        const iosTrial = this.deps.platform === 'ios'
          && pkg.product.introPrice?.price === 0
          && eligibility[pkg.product.identifier]?.status === this.client?.INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE;
        const androidFreePhase = this.deps.platform === 'android' ? pkg.product.defaultOption?.freePhase : null;
        const duration = iosTrial
          ? trialDuration(pkg.product.introPrice?.periodNumberOfUnits, pkg.product.introPrice?.periodUnit, pkg.product.introPrice?.cycles)
          : androidFreePhase
            ? trialDuration(androidFreePhase.billingPeriod?.value, androidFreePhase.billingPeriod?.unit, androidFreePhase.billingCycleCount ?? undefined)
            : undefined;
        return {
          id,
          price: pkg.product.priceString,
          periodLabel,
          renewalLabel: `${pkg.product.priceString} per ${periodLabel}`,
          ...(duration ? { trialLabel: `${duration} free trial` } : {}),
        };
      });
      this.publish({ plans, error: null });
    } catch {
      this.packages.clear();
      this.publish({ plans: [], error: 'Could not load subscription options. Please try again.' });
    } finally {
      this.publish({ loadingPlans: false });
    }
  }

  purchase = async (id: ProPlanId): Promise<boolean> => {
    if (this.mutating || this.disposed || this.snapshot.pending) return false;
    this.mutating = true;
    this.publish({ busy: true, error: null });
    try {
      await this.initialize();
      if (!this.client) throw new Error('Subscriptions unavailable');
      if (!this.packages.has(id)) await this.loadPlans();
      const pkg = this.packages.get(id);
      if (!pkg) throw new Error('Plan unavailable');
      const result = await this.client.purchasePackage(pkg);
      this.acceptCustomerInfo(result.customerInfo);
      const success = this.snapshot.status === 'pro';
      if (!success) this.publish({ error: 'Your purchase is pending or could not be verified yet. Please try Restore Purchases later.' });
      return success;
    } catch (error) {
      if (this.client && cancelled(error, this.client)) return false;
      if (this.client && errorCode(error) === this.client.PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) {
        this.publish({ pending: true, error: null });
      } else {
        this.publish({ error: 'Purchase could not be completed. Please try again.' });
      }
      return false;
    } finally {
      this.mutating = false;
      this.publish({ busy: false });
    }
  };

  restore = async (): Promise<boolean> => {
    if (this.mutating || this.disposed) return false;
    this.mutating = true;
    this.publish({ busy: true, error: null });
    try {
      await this.initialize();
      if (!this.client) throw new Error('Subscriptions unavailable');
      const info = await this.client.restorePurchases();
      this.acceptCustomerInfo(info);
      if (this.snapshot.status === 'free') this.publish({ pending: false });
      const success = this.snapshot.status === 'pro';
      if (!success) this.publish({ error: statusFromCustomerInfo(info) === 'free' ? 'No active Terminal Pro subscription was found.' : 'Your subscription could not be verified. Please try again.' });
      return success;
    } catch {
      this.publish({ error: 'Could not restore purchases. Please try again.' });
      return false;
    } finally {
      this.mutating = false;
      this.publish({ busy: false });
    }
  };

  manage = async (): Promise<void> => {
    await this.initialize();
    if (!this.client) {
      this.publish({ error: 'Subscription management is unavailable right now.' });
      return;
    }
    try {
      if (this.deps.platform === 'ios' && this.client.showManageSubscriptions) {
        await this.client.showManageSubscriptions();
        return;
      }
      const url = this.lastInfo?.managementURL ?? (await this.client.getCustomerInfo()).managementURL;
      if (url?.startsWith('https://')) {
        await this.deps.openURL(url);
      } else if (this.deps.platform === 'android') {
        await this.deps.openURL('https://play.google.com/store/account/subscriptions');
      } else {
        throw new Error('No management URL');
      }
    } catch {
      this.publish({ error: 'Could not open subscription management.' });
    }
  };

  dispose(): void {
    this.disposed = true;
    if (this.expirationTimer) clearTimeout(this.expirationTimer);
    this.client?.removeCustomerInfoUpdateListener(this.onCustomerInfo);
    this.listeners.clear();
  }
}

export function createTerminalProService(): TerminalProService {
  return new TerminalProService({
    platform: Platform.OS,
    iosKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
    androidKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY,
    testKey: process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY,
    isDev: __DEV__,
    loadClient: async () => (await import('react-native-purchases')).default as unknown as PurchasesClient,
    openURL: url => Linking.openURL(url),
  });
}
