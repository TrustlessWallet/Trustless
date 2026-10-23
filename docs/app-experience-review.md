# App experience review — 23 October 2026

This is a source-based review, not a release-build performance profile or a claim that every screen has been visually tested. The review covered shared controls/theme, navigation, WalletContext, wallet/history/send/receive flows, map and address screens, Terminal checkout/reporting/storage, and the related data services. Keep the existing monochrome, Space Mono, Bitcoin-orange and liquid-glass identity.

## Small changes in this pass

- Rename the Terminal entry and the sales-list header to **Sales**. Keep Today as a period filter and Sale details as the detail heading.
- Give balance/transaction query caches address-content identities rather than address counts, with network separation. Scope local transaction fallback to the requested wallet so old-wallet rows cannot flash while the next database read is pending.
- Apply transaction pagination before requesting block headers. A small recent-history page should not pay the network cost of every historical block.

## Prioritized follow-up work

| Priority | Finding and evidence | Recommended change | Verification |
| --- | --- | --- | --- |
| 1 | Typing a Lightning Address can start a network resolution for every keystroke: `src/screens/SendScreen.tsx:189` and `src/services/lnurl.ts:9`. The effect ignores stale results but does not cancel the request. | Validate complete address syntax, debounce resolution, and cancel superseded requests. Keep invoice parsing local and immediate. | Rapid typing/paste/clear/mode changes and stale callbacks; count requests, not just elapsed time. |
| 1 | Map startup downloads the global element list (`src/services/btcmap.ts:35`); filtering rebuilds the point array and Supercluster index on the JS thread (`src/screens/MapScreen.tsx:69`). A timeout postpones that work rather than making it cheaper. | Cache normalized points/indexes; avoid rebuilding unchanged inputs. Evaluate a region-scoped endpoint or offline dataset strategy against the actual API before changing fetch semantics. | Cold/warm map open, pan/filter interactions, memory and JS-frame profiles on a real device. |
| 1 | Icon controls have inconsistent interaction areas: global close is 32 points (`src/navigation/AppNavigator.tsx:366`), Terminal close 40 (`src/screens/TerminalSheetHeader.tsx:26`), Address Book edit uses 4-point padding around a 16-point icon (`src/screens/AddressBookScreen.tsx:218`). Some Send and Map icon controls have no descriptive accessibility label. | Introduce one labelled icon-button primitive with at least a 44-point interaction area while keeping the current visual size and glass behavior. Prevent hits reaching covered sheets. | Tap edges, hold/drag-away cancellation, layered sheets, screen-reader labels. |
| 2 | The wallet context creates a fresh provider value and many function identities every render (`src/contexts/WalletContext.tsx:1996`). All consumers subscribe to the entire value. | Separate stable wallet actions, wallet/address state, and Lightning state, or introduce selective subscriptions. Stabilize callbacks before memoizing the provider object. | Profile render commits before/after; ensure wallet switching and request/session guards stay intact. Do not change SDK lifecycle in the same patch. |
| 2 | Terminal reads/validates the entire sales JSON document and rewrites it on updates (`src/services/terminalSales.ts:71`, `:92`); refunds use the same model. Sales filters/sorts/totals run again on render (`src/screens/TerminalSalesScreen.tsx:175`). | Memoize derived views first; then move growing journals to indexed, paginated storage using the existing database stack. Retain immutable snapshots, atomic writes, unreadable-data behavior, and a verified migration/recovery path. | Synthetic 100/1,000/10,000-record fixtures; measure read/write time and JS stalls. Validate migration and duplicate/idempotent updates before shipping. |
| 2 | Standard and Terminal headers have different height, title size, padding and separator thickness (`src/navigation/AppNavigator.tsx:330`, `src/screens/TerminalSheetHeader.tsx:37`). | Consolidate a shared sheet-header component and tokens. Preserve Terminal focus/transition/cancellation guards and the existing raised dark header color. | Compare wallet and Terminal sheets in both themes, including swipe cancellation and lower-sheet disabled controls. |
| 2 | Typography mixes loaded Space Mono faces with generic monospace, and `StyledText` treats 600 as regular while Android clears native font weight (`src/components/StyledText.tsx:19`, `src/screens/SendScreen.tsx:896`, `src/screens/AddressBookScreen.tsx:236`). | Define explicit regular/bold text roles using the loaded fonts; standardize address and monetary typography without changing numeric parsing or alignment. | Compare the same rows/buttons on iOS and Android, long addresses and localized dates. |
| 2 | `StyledText` and `StyledInput` disable text scaling globally (`src/components/StyledText.tsx:41`, `src/components/StyledInput.tsx:75`). | Add an intentional larger-text policy for body text, labels and inputs; handle large amount displays separately. Avoid simply flipping the flag globally before layouts support wrapping. | Largest supported text sizes, keyboard visibility, long translations and small screens. |
| 3 | Address Book caps its flexible list at 500 points (`src/screens/AddressBookScreen.tsx:184`). Theme layout tokens cover only radius, spacing and input height (`src/constants/theme.ts:13`). | Let available sheet height determine the list; add a small set of shared control/spacing/type tokens, then adopt them screen by screen. | Large/small devices, safe areas, keyboard, pinned footer and long lists. |

## Additional network opportunities

`fetchAddressInfoBatch` sends balance and history batches sequentially for each address chunk (`src/services/bitcoin.ts:143`). Those independent calls could run together with bounded concurrency. Measure server limits and keep partial-failure semantics before changing this.

Address Details starts balance, UTXO and transaction requests concurrently, but one loading state waits for the entire group (`src/screens/AddressDetailsScreen.tsx:96`). Render cached/available sections independently and keep failures local; do not describe these requests as sequential network operations.

Do not remove existing interactive glass or input-focus feedback on the assumption that it is the main bottleneck. The review found unnecessary data work and broad render subscriptions; their actual frame-time impact must be measured. Keep native sheet presentation, working keyboard behavior, payment checks and refresh indicators intact.

## Suggested sequence

1. Ship and verify the isolated query/history changes in this pass.
2. Debounce/cancel address resolution; improve icon interaction areas in a separate UI patch.
3. Profile the map and provider updates in a release build on a real device.
4. Consolidate headers and typography with focused visual regression checks.
5. Improve journal storage before building extensive Premium analytics on top of it.

Record request counts, time to usable cached content, wallet/Terminal transition responsiveness, JS/native frame stalls, memory after repeated screen visits, and journal operations at realistic history sizes. Establish a baseline before claiming a percentage speedup. No new native files or dependencies are required for the first steps.
