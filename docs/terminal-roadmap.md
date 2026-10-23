# Terminal: free core and future Premium

This is the product boundary for development, not a shipped subscription or pricing announcement. No feature is paywalled in the current app.

## Free core

A merchant must be able to accept a payment, verify it, find it later, return funds safely, and take their records elsewhere without a subscription.

Keep the functionality already delivered available free:

- Fixed-amount Lightning checkout in sats, BTC, USD, EUR, and CHF.
- Payment recovery and verification, local sales history, Today/All, and period filters.
- Receipts, owner-authorized full or partial refunds, and basic CSV exports.
- Local cashier lock and the current quick-sale catalog and basket.
- Access to existing records and exports after any future subscription expires.

The catalog currently has a 30-item safety limit; this document does not remove it or promise unlimited products. The local cashier lock is not a delegated wallet or a multi-device staff account.

## Next increment: period reporting

Extend the existing Sales sheet with Today, 7 days, Month, and All. This remains free. Avoid a separate dashboard, charts, promotional labels, or changes to the checkout screen.

A period controls the same data in the summary, activity list, refund total, and CSV. Seven days includes today and the preceding six local calendar days. Month starts on the first of the current month. Bounded periods end at the next local midnight, with an exclusive upper bound. Calendar boundaries must handle daylight-saving changes without assuming 24-hour days.

Paid sales are grouped by the first local observation of completion (`receivedAt`); other requests by creation time. Refunds use the local status-observation time (`updatedAt`). These are not guaranteed settlement timestamps. A completed refund can belong to the period even when the sale itself does not. Gross fiat amounts retain their original currency and rate snapshot. Refund totals stay separate in sats; do not infer a fiat net revenue from current exchange rates.

## Proposed Premium boundary

Premium should sell business management and shared services, not access to funds or basic payment reliability.

| Capability | Free | Proposed Premium addition |
| --- | --- | --- |
| Reporting | Period totals, history, raw CSV | Previous-period comparisons, item performance, custom and saved reports |
| Receipts | Standard payment receipt | Business branding and reusable receipt templates |
| Staff | Owner-device cashier lock | Named staff, limited roles, revocation, and an auditable activity trail |
| Devices and locations | One device's local workflow | Paired terminals, shared catalog, and consolidated reporting |
| Record portability | Access to records and basic exports | Optional encrypted synchronization and automatic backup |

Do not quietly move existing functionality into Premium. Date filters alone are not enough differentiation. Do not add a Premium badge or checkout interruption before a real paid benefit exists.

## Delivery order

1. **Reporting foundation:** shared period rules and matching CSV; keep the existing screen fast and quiet.
2. **Premium Reports prototype:** comparisons and item performance from immutable sale/basket snapshots. Validate gross/refund treatment, mixed currencies, manual sales, renamed/deleted products, and incomplete records before charging for it.
3. **Explicit product decision:** choose the initial paid bundle and price based on merchant use. Define what remains usable offline and after expiry. Keep cloud services separately costed rather than promising them with an unfinished local feature.
4. **Subscription infrastructure:** implement entitlement verification and purchase/restore only after the bundle and applicable platform purchase requirements are settled.
5. **Optional shared services:** design pairing, staff permissions, encrypted metadata synchronization, conflict handling, and revocation before implementing multi-device access. Never transmit seed phrases or private keys to provide reporting or subscription access.

## Infrastructure requirements for the later paid phase

Use stable capabilities such as `reports.comparisons`, `reports.items`, and `receipts.branding` rather than scattering checks for a product name through screens. Map purchased products to capabilities in one entitlement layer. Do not introduce that layer until it has a real consumer; this increment adds no billing SDK, account requirement, entitlement flag, or fake upgrade screen.

The later service must verify purchases on the server, process lifecycle events idempotently, support restore, and return a signed, expiring entitlement snapshot tied to a separate merchant account/device identity. Keep wallet seed material out of that identity. Cache verified access for a defined offline grace period; do not trust an editable local boolean as proof of purchase. Test expiry, refunds, cancellation, restore, offline use, duplicate events, account/device changes, and clock changes.

Expiry or a billing outage must never block creating or receiving a basic payment, accessing funds, refund safety checks, viewing existing records, or basic export. Cloud permissions must be enforced on the server as well as in the UI. A subscription alone must never grant signing authority to another device.

## Data and verification limits

Sales, original prices, basket snapshots, and refund journals are currently saved locally per wallet and network. They are not synchronized to a merchant backend, and restoring a wallet seed does not recreate all local Terminal metadata. Do not imply otherwise in reports or paid-tier messaging. Before optional cloud backup, define a portable recovery format and a secure key-recovery design.

Use focused calendar/filter/export/state tests and simulator checks with fixture data. Keep fixture UI checks distinct from live Lightning settlement and native biometric testing. No native or dependency changes are required for period reporting.

## Reference

[BTCPay's reporting documentation](https://docs.btcpayserver.org/Reporting/) separates payments and products-sold reporting. It is a useful benchmark for later business reports; the proposed Trustless tier boundary above is a product decision, not a claim about competitors' pricing.
