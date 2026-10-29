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

## Delivered: period reporting

Extend the existing Sales sheet with Today, 7 days, Month, All, and Custom. This remains free. Avoid a separate dashboard, charts, promotional labels, or changes to the checkout screen.

A period controls the same data in the summary, activity list, refund total, and CSV. Seven days includes today and the preceding six local calendar days. Month starts on the first of the current month. Bounded periods end at the next local midnight, with an exclusive upper bound. Calendar boundaries must handle daylight-saving changes without assuming 24-hour days.

Paid sales are grouped by the first local observation of completion (`receivedAt`); other requests by creation time. Refunds use the local status-observation time (`updatedAt`). These are not guaranteed settlement timestamps. A completed refund can belong to the period even when the sale itself does not. Gross fiat amounts retain their original currency and rate snapshot. Refund totals stay separate in sats; do not infer a fiat net revenue from current exchange rates.

## CSV exchange rates

New invoices retain an independent reporting-rate snapshot: the selected currency for fiat pricing and USD for sats/BTC pricing. Refunds capture their own snapshot at reservation, rather than copying the sale's old rate. Reporting metadata does not turn Bitcoin-priced sales into fiat-priced sales or change totals. CSV includes `btc_fiat_rate` (units of `rate_currency` per 1 BTC), `rate_fetched_at_utc`, `rate_currency`, `rate_status`, and `rate_source`.

Status is frozen with the record: `fresh` is a current quote; `stale` is the last known reporting quote under 24 hours old when the provider is slow or unavailable; `unavailable` means the lookup had no usable quote; `not_recorded` identifies older Bitcoin-priced sales/refunds without a snapshot. Existing fiat quotes export their original price rate with status `quoted`. No historical rates are fabricated or fetched at export time. Rate time is a local fetch observation, not a settlement timestamp.

The Coinbase request is shared across concurrent callers and cached for 60 seconds, with optional disk persistence for restart recovery. Failed requests enter a bounded exponential cooldown; a valid `Retry-After` response extends it (up to 24 hours). Fresh quotes are required for fiat conversion. Bitcoin-priced invoice generation and refund reporting wait at most one extra second for metadata and continue with a stale or unavailable reporting snapshot if necessary. Price-provider failure must not stop accepting a known Bitcoin amount. No retry loop runs merely to fill old records later.

## Indexed local history

Sales and refunds now live in a dedicated `trustless_terminal.db` SQLite database using the existing app dependency. Indexed wallet/network, activity-time, invoice and sale-ID queries replace whole-document AsyncStorage reads and rewrites. Receipt observation time orders paid sales; creation time orders other requests. List pages contain 50 rows with a timestamp/ID cursor, while SQL calculates totals for the entire selected period using exact integer limbs. Virtualized rows remain in place. Silent updates preserve the already-loaded row budget; wallet, period and manual refresh changes restart paging safely.

Refund reservation checks the stored paid sale, remaining funds and unresolved attempts in one serialized transaction. Scoped invoice uniqueness and a partial unique index prevent duplicate records and multiple unresolved attempts for one sale. Payment reconciliation queries only the supplied invoices rather than loading the journal. Each row retains its original price, basket and reporting-rate snapshots.

CSV export atomically copies both selected journals to an ephemeral SQLite snapshot, releases the payment transaction, then reads and writes 100-row batches to a private CSV file. Later payment updates cannot move or duplicate exported rows. Snapshot and file cleanup run on success, cancellation and failure; abandoned snapshot rows are cleared on database open. No complete ledger is assembled in JavaScript for export.

There is deliberately **no migration** from the old AsyncStorage sales/refund fixtures: the Terminal was not deployed and had no merchant data, per the user's instruction. Existing test journals will not appear in the new history. Active invoice recovery, catalog/preferences and cashier state retain their existing storage and safety checks. No native or dependency upgrade is needed.

SQL summaries scan matching indexed projections; they are not precomputed constant-time totals. JavaScript retains pages the user has already loaded, not an unlimited-memory guarantee. Synthetic 1,000-row paging/index-plan tests and 10,000-row simulator fixtures are regression checks, not release-device benchmarks for every history size. Profile realistic large datasets before adding extensive analytics or a rolling in-memory window.

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

### Custom date range

Custom opens a compact calendar without changing the applied report. Apply selects inclusive local From/To dates for sales, totals, refunds, and CSV; Cancel leaves the current report intact. Same-day ranges are supported, future dates are disabled, and reversed ranges cannot be applied. CSV filenames include both dates. Calendar boundaries use the next local midnight, including daylight-saving changes.

### Period comparisons

Reports Overview compares Today with yesterday, 7 days with the preceding seven local calendar days, and Custom with the immediately preceding equal-length calendar window. Month compares month-to-date with the same dates in the previous month, clamping to its last day and disclosing a shorter baseline. All has no comparison. Exact baseline dates are shown; a current-day-ending period is marked in progress rather than implying a completed period.

The compact comparison shows previous values and exact signed changes for paid count, each original fiat currency, Bitcoin-priced sales in sats, and completed refunds separately in sats. A currency appearing only in the previous period remains visible. Zero baselines produce absolute changes, never infinite percentages. No currency conversion or fiat net revenue is inferred. Queries use indexed SQLite aggregates and never load previous-period history rows. Comparison failures cannot block the current report. This prototype introduces no subscription gate or billing dependency.

### Item performance

Reports Items shows all item/denomination groups in pages of 20, ranked by quantity or gross within one denomination in the selected Sales period. Only paid basket snapshots contribute. Stable item IDs merge renamed products; the latest paid snapshot name within that period labels the group. Deleted catalog products remain, and different IDs sharing a name remain distinct. USD/EUR/CHF remain separate; Bitcoin-priced BTC and sats lines share their sats base unit. Original line totals and quantities are summed exactly; current catalog prices and exchange rates are never used. Sales without baskets are excluded and their count is disclosed.

Refunds have no item-level allocation, so partial/full refunds do not alter these gross item quantities or amounts. Completed refunds remain separately reported in Sales, with an explicit item-report note. Ranking is by quantity, never revenue across currencies; stable ID/denomination ties are deterministic. Scoped indexed paid rows are expanded/aggregated in SQLite and captured in an ephemeral report snapshot, returning only one page at a time to JavaScript. Invalid stored basket details produce a retryable report error rather than zero-valued results. Item report failures do not block current totals/history.

### Separate Reports sheet

Sales keeps its paid totals, completed refunds, paginated history, date filters, and CSV export. A single Reports row opens a separate bottom sheet using the same header and period controls. Overview contains current aggregate totals and period comparisons; Items contains snapshot-based item performance. Opening Reports copies the applied Sales selection into serializable route parameters. Subsequent report filter/tab changes are independent, and dismissing it preserves the mounted Sales screen, filter, pagination, and scroll position. Wallet/network changes reset the scoped terminal stack.

Only the active report tab queries data: Overview uses current/previous aggregates; Items queries its own item aggregates directly. Sales no longer runs either report query. Reports handles local-midnight and foreground date updates, storage notifications, stale responses, and independent retries without reading history pages. There is no paywall, entitlement flag, account requirement, or subscription infrastructure in this change; this separation provides a clear future boundary without changing access to existing Sales records or exports.

### Complete Items report and readability

Items owns a virtualized FlatList, including the shared Reports header and date controls. All denominations may be ranked by quantity; gross ranking requires one explicit USD/EUR/CHF/sats filter, and selecting All resets to quantity. Original gross amounts are never converted across currencies. Date/sort/denomination changes reset the list to the top; storage-notification refreshes preserve the loaded row budget and position. Initial metadata is withheld until known, avoiding a false zero count during loading.

Each report transaction validates and aggregates its scoped paid snapshots once, normalizes integer limbs before numeric gross ordering, and materializes immutable ordered rows in SQLite. Cursor pages contain 20 rows, so payment updates cannot shift or duplicate an active snapshot's ranking. Replacement, stale creation, tab exit, and unmount remove owned snapshots; startup clears abandoned rows. Page retries preserve existing rows, and failed background refreshes retain the previous snapshot with an explicit retry state. This adds a SQLite table through normal app schema setup, with no native dependency or build change.

Reports now uses 12–13pt labels/values/notes and 14pt item names, with more breathing room and wrapped financial values. The existing theme palette and monospace fonts are retained.

### Items CSV export

Reports → Items provides the same header download/share action as Sales. It exports all matching item/denomination groups, not just loaded pages, using the applied period, currency filter and quantity/gross order. A separate immutable SQLite snapshot streams 100-row batches into a private CSV file; changing scope, dates, currency, order or leaving the tab cancels an unfinished export. The file and snapshot are cleaned up after sharing, cancellation or failure. This leaves payment processing and report pagination independent.

CSV preserves historical item IDs/names, exact quantities and original gross amounts. Fiat rows include decimal amounts and integer minor units; Bitcoin rows use sats, with a separate gross_sats column. Each row explicitly states gross-before-refunds with no item allocation, the inclusive/exclusive UTC period bounds, and the all-currency count of paid sales without item details. No item-level net or refund amount is inferred. All-period bounds are blank. Formula-like text is neutralized and CSV fields are escaped. This adds no paywall, native code, dependencies or new theme colors.

### Saved report presets

Reports includes a compact Saved reports row with Save and an inline expandable list. Generated labels identify the period and report tab, with currency and ordering on Items presets. Applying a preset commits the period, custom dates, tab, currency and sort together and closes any unapplied calendar draft. Relative Today/7 days/This month presets resolve against the current local day; custom dates remain fixed. Saving captures only the applied report, not an unfinished date draft. Items filters also survive switching to Overview and back.

Up to ten unique configurations are stored locally per wallet and network in a validated, versioned AsyncStorage envelope. Serialized writes deduplicate identical configurations, preserve existing records after failures and never overwrite unreadable storage. A preset can be removed and saved again. Only confirmed persistence updates the saved indicator. Hidden or stale reads/writes cannot update another scope's UI. Stored custom dates and identity keys remain readable/removable after a clock rollback; new future-date saves are rejected.

These are preferences, not saved financial results or a backup. Opening a preset queries current local records; wallet seed restoration does not restore presets. No account, synchronization, entitlement or subscription gate is added, and checkout remains unchanged. The shared period controls use “Month” at the same font size and width as Today/7 days/All; the month-to-date range is unchanged.

### Item report clarity

Items uses a compact currency/result-count/info row and a full-width Sort by control labeled Quantity / Sales amount. Both metrics remain visible in every item row; sorting changes order, not the values shown. The redundant item-performance heading and default explanatory paragraphs are removed. About item reports expands the before-refund treatment and the count of paid sales without item details, explicitly across all currencies for the selected period.

Choosing Sales amount from All currencies opens four currency choices directly below the sort control without moving the tapped button or changing the report. A chevron and accessibility expanded state identify the pending choice. All currencies is omitted from this required choice; repeated taps close it. Switching to the normal currency filter works on the first tap, and leaving the screen clears the pending choice. Selecting one currency applies that filter and sales-amount sorting together; choosing Quantity or dismissing the choice cancels the pending sort. Returning to All currencies restores quantity sorting. Sort targets are at least 44 points high, saved-report labels use the same terminology, and internal preset identities and CSV gross/refund definitions remain unchanged.

### Receipt branding prototype

Owner-only Terminal Settings → Receipts opens a standard sheet with optional Business name, Contact and Footer fields, the existing highlighted inputs, a live layout preview and Save. Preview contains a neutral Payment details placeholder, never fabricated paid data. Clearing all fields restores the standard receipt. Native keyboard insets keep the focused field visible; no shared input behavior is changed.

The profile is versioned local metadata scoped by wallet and network, with serialized writes and stale-owner guards. Loading failures show retry rather than an editable empty profile; unreadable saved profiles cannot be overwritten or silently omitted during sharing. Single-line text is trimmed and bounded (80/120/160 characters), and control/newline/bidi-override injection is rejected both on persistence and direct formatting.

Sharing reads the current profile for the paid sale's scope, wraps the existing text receipt in the business identity/footer, and preserves original fiat prices, basket snapshots, local verification timestamp, payment references and separate refund statuses/amounts. Updating branding changes presentation when old receipts are shared again; it never changes their sale/refund records. Duplicate share taps are blocked, a Bitcoin-colored spinner indicates sharing, and leaving the sale/wallet invalidates an unfinished profile lookup.

This first increment brands the existing text sharing format. It adds no logo picker, PDF/printing engine, native/dependency changes, account, synchronization or subscription gate. Profiles are not restored from the wallet seed. Image branding can be considered separately when choosing the final paid receipt format.

### PDF receipts and optional logo

Paid sale details offer Share PDF receipt and Share text receipt, using one share guard. PDFs use an A5 layout, embedded app fonts, wrapped references and multi-page output. They retain the same original amounts, historical item lines, locally verified time, payment references and separate completed/pending/uncertain refund details as text receipts. Unsupported font glyphs fail explicitly with text sharing still available. Rendering and font loading run only when sharing; private temporary PDF files are removed after sharing or failure.

Receipts settings accepts an optional local PNG/JPEG logo, up to 200 KB and 1024 pixels per side. The selected bytes are validated and metadata is stripped before saving; PNG inflation is bounded and unchecked ancillary metadata cannot reach the PDF decoder. Logo changes remain a draft until Save, and clearing the logo preserves text branding. Profiles remain local per wallet/network and are not restored from a seed. The approved PDF/font and image-validation dependencies are JavaScript only; no native files or modules change.

### Receipt image sources and Sales navigation

Choose/Change logo opens a native Photos / Files / Cancel menu. Both sources use the same local importer and draft-only save flow. Images up to 20 MB and 32 megapixels are resized proportionally as needed to meet the existing 1024-pixel/200-KB stored-logo limits. PNG transparency is retained; JPEG orientation is normalized before metadata is stripped. Resizing uses one URI-based native context, with no native image-reference argument crossing the Expo bridge. Generated cache files and native image references are released on completion, failure or stale scope. A Bitcoin-colored spinner replaces the button text during preparation without changing its width.

The user-approved Expo Image Picker and Image Manipulator modules require a new development/release binary. Generated iOS/Android files remain untouched. The app config provides the Photos purpose string and disables the image picker's unused microphone permission. New native capabilities are resolved only when used, so an older development binary can still open safely.

Sales period changes retain a stable summary card and static theme-based placeholders while the new period's records and totals resolve together. Previous-period totals never appear under the newly selected period. Delayed/stale response regressions cover rapid filter changes. Sale details opens in a separate native bottom sheet above the mounted Sales screen, without period controls or duplicate history queries. Closing details returns to the existing Sales selection and list rather than dismissing Sales itself; refund notifications update only the targeted detail records in that sheet.

### Encrypted Terminal records backup

Owner-only Terminal Settings → Backup creates a password-encrypted portable file containing this wallet/network's sales, refund journals and saved item catalog, including original prices, basket snapshots, reporting rates and local observation times. Version 2 also includes the active receipt profile and logo, reusable templates and saved report presets. Cashier credentials, active checkout requests, wallet keys and SDK state remain excluded. It does not move funds or replace a wallet seed backup.

The versioned format uses PBKDF2-HMAC-SHA256 with a fresh 16-byte salt and AES-256-GCM with a fresh 12-byte IV. The clear format header is authenticated; wallet identity, source local ID, network, creation time, ordered records and final counts are encrypted. Identity uses a domain-separated hash of the full account xpub and network, allowing a reimported wallet with a different local ID to restore its own records. The xpub itself is not included. Mnemonic seeds and private keys are never read or included. Passwords are never persisted and cannot be recovered.

An immutable SQLite snapshot is exported in 100-row pages; file encryption/decryption is streamed with bounded records rather than collecting the journal in memory. Files are capped at 100 MB, financial records at 64 KB and journals at 200,000 records. The single validated preferences record has a separate 2 MB limit for embedded logos. Import first stages authenticated, validated records privately, then shows creation time and counts for explicit confirmation. Cancellation, failed authentication and stale owner scope discard staging. Restore checks current wallet identity, rejects an active checkout, nonempty destination history or nonempty item catalog, remaps only local wallet IDs, and inserts both journals and the catalog atomically. Duplicate IDs/invoices, invalid sale/refund links, excess refunds and write errors roll the entire transaction back. Version 2 additionally requires semantically empty receipt settings, templates and presets, then restores all of them in the same transaction. Reading default settings does not prevent restore. Version 1 remains readable and preserves destination preferences; its preview explicitly identifies their absence. Metadata-only backups can also be restored. Catalog and receipt/report preferences use the same SQLite transaction queue as journals; validated legacy AsyncStorage data is imported once on access. Explicit empty rows prevent older keys from resurrecting cleared preferences, and unreadable data is not overwritten. Startup already clears abandoned export staging; shared encrypted cache files are removed when sharing ends.

Every imported sale retains a restored-record marker, including after subsequent payment reconciliation and re-export. A backup can omit a refund made after its creation, so restored sales are available for history, reports and receipts but cannot initiate new refunds. The restriction is checked against the persisted sale inside refund reservation, not just in the UI. Existing unresolved refund records remain historical records; restoring never submits them. This is a local portability feature, not automatic cloud backup, synchronization, subscription access or a claim that old payment/refund statuses have been freshly verified.

Password derivation uses the approved, pinned existing @noble/hashes JavaScript library with asynchronous work slices. This adds no native module or build requirement. Export serializes only named journal/catalog fields; unrelated properties cannot enter an archive.


### Reusable receipt templates

Receipts settings includes a compact Templates disclosure. Standard or a saved name loads a copy into the current draft and preview; the existing Save button remains the only action that applies branding to shared receipts. Financial details and receipt layout stay fixed. Save as template reveals a name input without another navigation layer; saving stores a named copy, and Cancel keeps the receipt draft. A loaded template can be explicitly replaced after edits. Delete requires confirmation and preserves the current draft and active branding. Names are limited to 40 characters, compared case-insensitively after Unicode normalization, and Standard is reserved for the default receipt.

Up to five templates live in a validated, versioned collection per wallet/network, separate from the active receipt profile. Each owns its normalized logo bytes, so changing an active logo or deleting another template cannot break it. Mutations are serialized, input snapshots are copied before queuing, malformed libraries cannot be overwritten, and stale owner scopes cannot update the UI. A library loading error offers its own retry without blocking ordinary receipt editing or resetting a draft. The library is loaded only in Receipts settings, not during checkout or sharing.

Templates remain local preferences and are included in the encrypted Terminal backup along with the active receipt profile and saved reports. This adds no paywall, billing, native changes, dependencies, custom financial fields or new theme colors.


### Merchant-flow review

The receipt-template increment also closes four concrete transition/feedback gaps found while reviewing the Terminal. Item-picker validation now appears in a reserved feedback area inside its sheet, rather than behind it on checkout, and clears after a valid edit. Unresolved-refund checks show unknown/offline/error feedback outside the hidden new-refund form, with Bitcoin-colored progress spinners. Enabling Cashier now captures and copies the scoped checkout draft before the navigator changes, matching the existing unlock handoff. Wallet removal and reset clear receipt branding, report presets and template libraries; serialized deletion guards prevent queued edits from recreating removed metadata.

Regression coverage includes checkout, invoice/payment state, currencies, baskets, refunds, reports/exports, receipts and backup services, plus cashier-provider transitions. Simulator fixtures exercise actual screens, SQLite/file APIs and native sheets with synthetic SDK outcomes and authentication. Live Lightning settlement, physical-device biometrics and sustained-device performance are separate checks; coordinate-based swipe/hold gestures were unavailable to automation in this run.


### Checkout and startup follow-up

Quick item selection uses a fixed half-height scrollable sheet so the checkout amount remains visible; plus/minus controls retain their size. New item entry opens the keyboard for Name after the native presentation finishes. Receipt PDFs use separated branding, amount, item, payment, refund and footer sections while retaining every canonical detail.

Lightning restoration starts alongside first-import address discovery. Native connect/disconnect remains serialized across provider remounts. A timeout waiting for disconnect no longer skips the next initialization attempt; the queued lifecycle still owns teardown and prevents overlapping connections. On-chain wallet publication uses its independent load generation so a Lightning failure cannot prevent activation. Regression checks cover delayed discovery, rejected/slow teardown, rapid switches and provider remounts.

Sales and Reports retain the committed period until its complete query is ready; selected labels, summaries, refund totals, item snapshots and export filters change together. Overview comparisons are prepared with the new totals to avoid a second loading flash. A bounded Sales/overview cache accelerates revisits, with scoped journal notifications invalidating stale results even while Reports is hidden. Superseded queries cannot repopulate invalidated caches, and failed selections preserve the current view.

Follow-up validation: 365 Terminal, wallet-mode and Lightning regression tests passed, including complete/legacy backups, metadata-only restore, authenticated-file rejection, transaction rollback and a normalized logo record larger than 64 KB. Simulator fixtures verified encrypted create/restore, restored receipt/template/preset/catalog values, Add item autofocus and decimal-comma save, half-sheet selection and last-product access in a 30-item catalog, plus Sales/Reports filters. Last-product access used a test-only native scroll control because desktop swipe injection was unavailable. These are synthetic SDK/auth fixtures, not live Lightning settlement or physical-device biometric verification. Rendered receipt PDFs were checked visually; no native files or dependencies changed.
