# Trustless

## Intro
Hi!
Trustless is a fully open-source, non-custodial, privacy-focused, bitcoin-only mobile wallet. It is very minimalist and easy to use, yet very functional.

## Main features
* **Bitcoin wallet:** Import or create new wallets, track balances, send and receive bitcoin.
* **Address tracker:** Track any bitcoin address balance just by entering it. No private keys required.
* **Receive address change:** Have 20 unused receive addresses at all times to choose from. This is a privacy feature, because address reuse links payments together.
* **Balance breakdown:** See actual UTXOs you own by clicking on your total wallet balance.
* **Coin control:** Choose which UTXOs to use for a transaction.
* **BIP44 change address management:** Following best privacy practices, all change addresses are being derived from 1/n chain and are only used once. You can see all your change by clicking on your total wallet balance.
* **Custom node connection:** Connect to your own node via electrum.
* **Network switch:** Use testnet network for transaction testing / development.

## Getting Started (Development)

To run the project in development mode, you need node-js and a setup for ios (xcode) or android (android studio).

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/trustlesswallet/trustless.git
    cd trustless
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run on Device / Simulator:**

    * **ios (mac only):**
        ```bash
        npm run ios
        ```
        *To run on a physical device, add the `-- --device` flag and ensure your iphone is connected.*

    * **android:**
        ```bash
        npm run android
        ```
        *Make sure you have an android emulator running or a physical device connected.*

    * **Manual Build (Advanced):**
        If the automated commands fail, you can generate the native directories and build manually:
        ```bash
        npx expo prebuild --clean
        cd ios && pod install && cd ..
        ```
        Then open a trustless workspace file in your ios folder to open the project in xcode. From there you can install the app manually.

## Reproducible Build Instructions

> **Maintainer release checklist:**
> 1. Ensure the working tree is completely clean to avoid the dirty flag.
> 2. Create and push the new tag: 
>    `git tag -a 1.0.1 -m "release 1.0.1"`
>    `git push origin 1.0.1`
> 3. Generate the unsigned package: 
>    `bash reproducibility.sh`
> 4. Sign the package using the production keystore: 
>    `apksigner sign --ks trustless-release.keystore --ks-key-alias trustless-alias --out trustless-v1.0.1-release.apk android/app/build/outputs/apk/release/app-release-unsigned.apk`
> 5. Generate the official hash: 
>    `shasum -a 256 trustless-v1.0.1-release.apk`
> 6. Create the github release. Upload the signed package and paste the hash into the release notes.

To verify that the official binary was built exactly from the published source code, follow these steps. This process compares the internal contents of the official signed package against a locally built unsigned package.

1.  **Download the signed release:**
    Download the official signed file from the github releases page into a new testing directory. *(Replace the URL with the specific version you are testing)*.
    ```bash
    curl -L -o trustless-release.apk https://github.com/trustlesswallet/trustless/releases/download/1.0.1/trustless-v1.0.1-release.apk
    ```

2.  **Clone the repository:**
    Clone the source code and check out the exact release tag matching the downloaded file.
    ```bash
    git clone https://github.com/trustlesswallet/trustless.git
    cd trustless
    git checkout 1.0.1
    ```

3.  **Build the local unsigned package:**
    Execute the automated build script. This will install dependencies, enforce reproducible file sorting, disable automated signing, and compile the application.
    ```bash
    bash reproducibility.sh
    ```

4.  **Unpack both packages:**
    Android packages are zip archives. Extract both the downloaded signed package and the newly built local package into separate directories for comparison.
    ```bash
    cd ..
    mkdir unpacked-signed unpacked-unsigned
    unzip -q -o trustless-release.apk -d unpacked-signed
    unzip -q -o trustless/android/app/build/outputs/apk/release/app-release-unsigned.apk -d unpacked-unsigned
    ```

5.  **Strip metadata and compare:**
    Remove the `META-INF` directory from both folders. This directory contains the unique cryptographic developer signature and timestamps that will never match. Compare the remaining raw files.
    ```bash
    rm -rf unpacked-signed/META-INF unpacked-unsigned/META-INF
    diff -r unpacked-signed unpacked-unsigned
    ```

    If the `diff` command returns an empty output, the contents are identical bit-for-bit. The build is officially reproducible.

## Contributing

We welcome contributions to trustless! Please follow the standard fork-and-pull request workflow.

### Contribution Process

1.  **Fork the repository** to your own github account.
2.  **Clone your fork** to your local machine.
3.  **Create a new branch** for your feature or fix.
4.  **Make your changes** and commit them.
5.  **Push your branch** to your fork.
6.  **Open a pull request** against the `main` branch.

### Guidelines

* **Code Style:** Keep code clean and consistent.
* **Testing:** Ensure the app builds and runs via `npm run ios` or `npm run android` before submitting.
* **Issues:** Open an issue to discuss major changes before starting work.

## License

This project is licensed under the **GNU General Public License v3.0** (GPLv3). See the LICENSE file for details.
