# Unilateral exit and recovery

Settings → Danger Zone → **Unilateral exit** uses Breez Spark SDK 0.26.1. Normal withdrawal remains the preferred path. Recovery is a multi-stage Bitcoin operation that may take days, requires separate mining-fee funding, and cannot be cancelled after broadcasting.

## Requirements

- A signing wallet on Bitcoin mainnet. This first version supports one confirmed native SegWit (P2WPKH) funding output owned by the same wallet. Watch-only wallets and other funding script types are not supported.
- Recovery data fetched while the Spark operators were available, or an exported encrypted recovery backup. A seed by itself does not replace the exit data during an outage.
- A Bitcoin destination, mining-fee budget and an HTTPS Bitcoin Core-compatible RPC endpoint supporting `getblockchaininfo`, `submitpackage`, and `sendrawtransaction`. Credentials are stored in the device keychain. Plain HTTP endpoints are intentionally unsupported.
- A backup password of at least 12 characters and somewhere outside the phone to save the encrypted file.

A hosted option is Alchemy's Bitcoin mainnet API: `https://bitcoin-mainnet.g.alchemy.com/v2/YOUR_API_KEY`. Create your own account/key and verify that package submission is enabled for it. No shared key ships with the app. Another compatible HTTPS RPC can be configured at any time. The connection test checks mainnet and probes `submitpackage` using an empty package; it does not submit a transaction. This does not guarantee acceptance of a later real package.

## Flow

1. Enter the broadcaster and test the connection.
2. Enter the Bitcoin destination and fee rate, then request a quote. Review mining fees and the separate funding requirement. If needed, receive enough on-chain funds into this wallet and wait for confirmation before re-quoting. Very small balances may be uneconomical to recover.
3. Select a confirmed funding output, type `EXIT`, and build the exit. The app switches to the SDK's server configuration with automatic background tasks disabled. It saves encrypted recovery intent before signing, then saves the signed result before allowing broadcast. Normal wallet spending/deletion is blocked during recovery. Do not use this seed in another app or spend the funding output elsewhere.
4. Export the encrypted backup to Files or another off-device location and confirm it was saved. Keep the password separately. This backup contains the SDK exit state, original leaves, funding inputs and signed transaction packages.
5. Confirm **Broadcast ready steps**. Only SDK-ready steps with confirmed dependencies are submitted. A parent and its fee-paying child are submitted together. A successful HTTP response is not treated as package acceptance unless all expected transaction results succeeded.
You may instead use **Export ready packages** after saving the encrypted backup. This separate unencrypted file contains RPC methods and parameters for currently ready transactions, so another compatible broadcaster can submit them. Anyone holding the file can broadcast the signed transactions. It is not a replacement for the encrypted recovery backup.

6. Reopen this screen to check confirmations and timelocks, and broadcast newly ready steps. It checks every 30 seconds while visible in the foreground; it does not automatically broadcast. A timeout can mean acceptance is uncertain, so progress is checked before retries.
7. If prompted, re-quote and rebuild using the original leaves and funding. The initial SDK build can omit the final sweep until refund outputs appear on-chain. Confirmation of that first set is not completion. Export a fresh backup after every rebuild.
8. Completion requires the SDK's `Done` verdict and a final sweep in the checked transaction set. Normal syncing resumes. Verify funds at the destination.

The app retains recovery records in a separate encrypted database. To restore on a new installation, import the same seed, open recovery, enter the backup password and import the file. Existing records cannot be overwritten with an older backup. Do not uninstall the app during recovery unless you have independently saved the backup and password. Exported files are portable; local keychain encryption is device-bound.

## Testing

Rebuild the native app because the SDK and native file-sharing modules changed:

```sh
node --version # v22.14.0
npm ci --legacy-peer-deps
npx expo prebuild --clean
npm run ios -- --device
```

`prebuild --clean` regenerates the native directories; preserve any manual native changes first. `npm run ios` also generates the build metadata through `preios`.

First use a **separate test wallet**, never your main wallet:

- Test connection failure, an invalid destination, unavailable funding and a fee quote without building or broadcasting.
- For a real exit, fund that wallet with a small Spark balance and a confirmed P2WPKH on-chain output sufficient for the displayed quote. Budget for actual Bitcoin fees; there is no universal safe test amount.
- Build, export, then close/reopen the app and verify the destination, transactions and progress persist. Test backup import with the same seed in a separate development installation before broadcasting.
- Submit ready steps, return after confirmations/timelocks, rebuild the sweep when requested and verify final on-chain receipt. Test disconnect/reconnect and app restart during waiting periods.

No live exit or spending is performed by the automated tests. They cover encrypted backup integrity, package rejection, readiness checks, recovery completion and existing Lightning behavior. iOS/Android native execution and actual package acceptance still require device testing.

Breez recommends Spark Regtest for general SDK development. This app's Bitcoin testnet switch **does not configure Spark Regtest**, and this implementation does not expose a regtest exit environment or hosted regtest package broadcaster. Do not treat mocked tests or the general regtest guide as proof of an end-to-end exit. A complete regtest exercise requires a separately configured Spark regtest SDK, matching chain backend, fee funding, mining control and package-capable RPC.

References: [Breez unilateral exit](https://sdk-doc-spark.breez.technology/guide/unilateral_exit.html), [Breez testing](https://sdk-doc-spark.breez.technology/guide/testing.html), [Alchemy submitpackage](https://www.alchemy.com/docs/chains/bitcoin/bitcoin-api-endpoints/submitpackage).
