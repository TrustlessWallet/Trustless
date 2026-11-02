# Terminal Pro

## Bundle and data boundary

Terminal Pro includes Reports (comparisons, item performance, presets and report exports), new receipt logos and reusable template application/creation/replacement. The owner enters through Terminal Settings → Terminal Pro or the requested paid feature. Cashier mode has no purchase entry.

Checkout, fiat pricing, items/basket, cashier lock, all Sales records and filters, refunds, raw Sales CSV, basic receipt text/PDF sharing and encrypted backup/restore remain free. Existing receipt branding continues rendering after expiry. Owners can remove logos and delete templates without upgrading. No records are deleted or remotely uploaded when a subscription changes. Receipt drafts and selected report periods survive upgrade cancellation. Verified upgrade resumes the intended tool after the native purchase sheet dismisses; wallet changes, cashier locking and leaving the originating screen cancel deferred actions.

RevenueCat gets an anonymous purchase ID and store transaction information. The integration sends no wallet ID, seed, xpub, address, balance, sale, item, receipt or customer content. No app account, attribution SDK, custom customer attributes or own billing backend is introduced. The SDK initializes only when an owner opens Pro; ordinary wallet startup and checkout make no billing request. Automatic billing messages and optional diagnostics/device-identifier collection are disabled. Future cloud features must authenticate and authorize their own operations on the server; a local entitlement must never grant wallet signing authority.

## Store configuration

| Setting | Value |
| --- | --- |
| RevenueCat entitlement / offering | `terminal_pro` / `terminal_pro` |
| App Store bundle ID | `com.btc.trustless` |
| Monthly product | `com.btc.trustless.terminal.pro.monthly` |
| Annual product | `com.btc.trustless.terminal.pro.annual` |
| Packages | `$rc_monthly`, `$rc_annual` |
| Approved US base prices | $5.99/month; $49.99/year |
| Introductory trial | Two weeks for eligible new subscribers |

App Store Connect: group `Terminal Pro` (`22536941`), monthly Apple ID `6829703247`, annual Apple ID `6829752309`. Both products use service level 1. English US display names/descriptions, 175-territory availability and two-week introductory offers starting November 2, 2026 with no scheduled end were configured. Apple calculates local storefront prices; the app displays the actual store price, without hardcoded currency conversions or trial promises. Products are not submitted for review or released by this change.

RevenueCat project: Trustless (`a7935f45`). The existing entitlement is reused. Offering `terminal_pro` was created with monthly and annual packages using the existing Test Store products (`monthly`, `yearly`). Production connection still requires the Apple In-App Purchase key, live products attached to the same entitlement/packages, and the iOS public SDK key in the build environment. Do not upload private Apple keys into the repository. Google Play configuration is separate and is not provisioned by the iOS setup.

## Verification and availability

The native SDK is pinned to `react-native-purchases` 10.16.0 (CocoaPods hybrid 19.17.0). Only `VERIFIED` / `VERIFIED_ON_DEVICE` active entitlement information grants Pro. Signed SDK `isActive` remains authoritative during store grace periods. The SDK owns persistent caching and purchase identity; the app does not store an `isPro` flag or tie a purchase to a wallet. Customer updates and foreground refreshes update access without reconnecting the wallet. Older dated SDK responses cannot replace newer entitlement data. Failed billing fetches do not revoke an already verified cached Pro result; failed signatures never newly grant access.

Subscription state and product-price loading are independent. Missing keys/native modules, failed requests, cancellation, pending approval and unverified purchases fail safely. Pending payments cannot unlock Pro or start another simultaneous purchase. Restore checks the store account explicitly. A verified empty restore clears the local pending UI so a declined request can be retried. Purchasing and restoring never send Bitcoin.

## CocoaPods compatibility

RevenueCat 11.0.0 requires PurchasesHybridCommon 20.1.0, which is not published during the November 1–7, 2026 CocoaPods freeze. RevenueCat explicitly recommends 10.x for Expo during this period. Keep the exact 10.16.0 pin and committed lockfile; its required hybrid 19.17.0 and RevenueCat 5.99.0 specs are published. Do not override the pod version independently of the JavaScript bridge or migrate this Expo project to experimental Swift Package Manager integration to bypass this release gap.

After pulling the corrected package/lockfile, run `npm ci --legacy-peer-deps`, then `cd ios && pod install --repo-update && cd ..`. Run the device build only if pod installation succeeds. The later sandbox/Podfile.lock error is a consequence of the earlier failed installation. No generated native files are changed by the compatibility fix.

## Release checklist

- Connect a dedicated Apple purchase-validation key in RevenueCat, attach both live products to `terminal_pro`, and configure the production public SDK key. Do not use Test Store credentials in release builds.
- Complete Apple review metadata/screenshots and publish a matching public privacy policy. Verify App Privacy answers against the installed RevenueCat SDK and actual data use. No legal agreement is accepted automatically.
- Build a new app binary containing the native purchases SDK. Metro reload alone is insufficient.
- Use Apple sandbox/TestFlight to verify actual purchase, cancellation, renewal, expiry/grace, pending approval and restore after reinstall using the same store account. Use simulated store responses only for UI/state regression testing; they do not prove StoreKit wiring.
- Submit the first subscriptions with the next app version. This PR does not submit or release the app or charge a real customer.
