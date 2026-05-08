<a href="https://trustlesswallet.github.io/Trustless/"><img src="https://github.com/user-attachments/assets/b8c370be-840f-4f3e-88a6-5920711ee174" alt="Trustless-logo-dark" height="50" align="middle"></a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<a href="https://apple.co/4vpMOrh"><img src="https://github.com/user-attachments/assets/1c049492-6fb6-43cc-a5eb-0469bbef9b2c" alt="Download on the App Store" height="50" align="middle"></a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<a href="https://walletscrutiny.com/iphone/com.btc.trustless/"><img src="assets/Website%20images/Walletscrutiny.png" alt="Wallet Scrutiny" height="62" align="middle"></a>&nbsp;&nbsp;&nbsp;&nbsp;<a href="https://x.com/Trustlessbtc"><img src="https://github.com/user-attachments/assets/d97dcf22-345a-427d-961e-6f4ee308db76" alt="X-logo" height="50" align="middle"></a>

## Intro
Hi! Trustless is a fully open-source, non-custodial, privacy-focused, Bitcoin-only mobile wallet. It is very minimalist and easy to use, yet very functional.

## Table of contents
* [Intro](#intro)
* [Main features](#main-features)
* [Getting started (development)](#getting-started-development)
* [Reproducible build instructions](#reproducible-build-instructions)
* [Contributing](#contributing)
* [License](#license)

## Main features
* **Bitcoin wallet:** Import or create new wallets, send and receive Bitcoin. Trustless also supports pubkey imports for watch-only wallets.

  <img width="250" alt="Wallet" src="https://github.com/user-attachments/assets/3595972b-36be-4229-9b71-82b0ac7d92e1" />
  <img width="250" alt="Wallet" src="https://github.com/user-attachments/assets/040f6a53-8312-4de8-9258-931e23016b1e" />

* **Balance breakdown:** See actual UTXOs you own by clicking on your total wallet balance.

  <img width="250" alt="Balance details" src="https://github.com/user-attachments/assets/750c5fa2-805a-4e63-8624-2553446a4fa7" />
  <img width="250" alt="Balance details" src="https://github.com/user-attachments/assets/81bb9375-4e1a-42cb-a64e-398be5574015" />

* **Coin control:** Choose which UTXOs to use for a transaction.

  <img width="250" alt="Coin control" src="https://github.com/user-attachments/assets/60111ad7-f238-4bb7-b28f-eb61288d7a22" />
  <img width="250" alt="Coin control" src="https://github.com/user-attachments/assets/68b149fc-02f1-410e-a9ce-be3d30e0f3af" />

* **Custom node and network:** Connect to your own node via Electrum and use testnet network for transaction testing / development.

  <img width="250" alt="Custom node and network" src="https://github.com/user-attachments/assets/e31ee43c-0383-4102-bf18-f0a1dafba201" />
  <img width="250" alt="Custom node and network" src="https://github.com/user-attachments/assets/02f25fcf-b16a-436a-88e5-e5b3e807304d" />

* **Receive address switching:** Have 20 unused receive addresses at all times to choose from. This is a privacy feature, because address reuse links payments together.

  <img width="800" alt="Receive" src="https://github.com/user-attachments/assets/eada81ef-2979-4178-81ce-322fd2368868" />
* **Change address management:**  To protect user's privacy even more, all change addresses are automatically derived from 1/n chain and are never reused for receiving. In tandem with the previous feature, Trustless makes it drastically harder to link and track user's BTC.

  <img width="800" alt="Change" src="https://github.com/user-attachments/assets/af596cf8-bc7c-4554-9593-ba78294bb16e" />


## Getting started (development)

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

3.  **Run on device / simulator:**

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

    * **Manual build (advanced):**
        If the automated commands fail, you can generate the native directories and build manually:
        ```bash
        npx expo prebuild --clean
        cd ios && pod install && cd ..
        ```
        Then open a trustless workspace file in your ios folder to open the project in xcode. From there you can install the app manually.

#### Making lightning work
Trustless uses [Breez SDK](https://github.com/breez) to handle lightning operations. SDK requires an API key to work. For obvious reasons we don't push the .env file with the key to the GitHub repo. To make lightning work you will have to create your own .env file in the root of the directory and add your own Breez API key there like this:
        ```
        EXPO_PUBLIC_BREEZ_API_KEY=your_api_key
        ```. To get the API key just fill out the [form](https://breez.technology/request-api-key/#contact-us-form-sdk) on Breez's website. You will receive a key to your email address. This is completely free.

## Reproducible build instructions

<details>
<summary>Maintainer release checklist</summary>

1. Ensure the working tree is completely clean to avoid the dirty flag.
2. Create and push the new tag: 
   `git tag -a 2.0.0 -m "release 2.0.0"`
   `git push origin 2.0.0`
3. Navigate into the repository directory to ensure all generated files stay in the correct folder:
   `cd Trustless`
4. Generate the unsigned package: 
   `bash reproducibility.sh`
5. If the keystore is missing, generate a new one in the current directory:
   `keytool -genkey -v -keystore trustless-release.keystore -alias trustless-alias -keyalg RSA -keysize 2048 -validity 10000`
6. Locate the signing tool and sign the package using the keystore: 
   `apksigner_path=$(find ~/Library/Android/sdk/build-tools -name "apksigner" | sort -r | head -n 1)`
   
   `$apksigner_path sign --ks trustless-release.keystore --ks-key-alias trustless-alias --out trustless-v2.0.0-release.apk android/app/build/outputs/apk/release/app-release-unsigned.apk`
7. Generate the official hash: 
   `shasum -a 256 trustless-v2.0.0-release.apk`
8. Create the github release. Upload the signed package and paste the hash into the release notes.

</details>

To verify that the official binary was built exactly from the published source code, follow these steps. This process compares the internal contents of the official signed package (published on GitHub) against a locally built unsigned package (your local build).

1.  **Download the signed release:**
    Download the official signed file from the github releases page into a new testing directory. *(Replace the URL with the specific version you are testing)*.
    ```bash
    curl -L -o trustless-release.apk https://github.com/trustlesswallet/trustless/releases/download/2.0.0/trustless-v2.0.0-release.apk
    ```
2. **Verify that hash matches the one listed on Github by running:**
    ```bash
    shasum -a 256 trustless-release.apk
    ```
4.  **Clone the repository:**
    Clone the source code and check out the exact release tag matching the downloaded file.
    ```bash
    git clone https://github.com/trustlesswallet/trustless.git
    cd trustless
    git checkout 2.0.0
    ```

5.  **Build the local unsigned package:**
    Execute the automated build script. This will install dependencies, enforce reproducible file sorting, disable automated signing, and compile the application.
    ```bash
    bash reproducibility.sh
    ```

6.  **Unpack both packages:**
    Android packages are zip archives. Extract both the downloaded signed package and the newly built local package into separate directories for comparison.
    ```bash
    cd ..
    mkdir unpacked-signed unpacked-unsigned
    unzip -q -o trustless-release.apk -d unpacked-signed
    unzip -q -o trustless/android/app/build/outputs/apk/release/app-release-unsigned.apk -d unpacked-unsigned
    ```

7.  **Strip metadata and compare:**
    Remove the `META-INF` directory from both folders. This directory contains the unique cryptographic developer signature and timestamps that will never match. Compare the remaining raw files.
    ```bash
    rm -rf unpacked-signed/META-INF unpacked-unsigned/META-INF
    diff -r unpacked-signed unpacked-unsigned
    ```

    If the `diff` command returns an empty output, the contents are identical bit-for-bit. The build is officially reproducible.

#### Lightning reproducibility implications
Trustless uses [Breez SDK](https://github.com/breez) to handle lightning operations. SDK requires an API key to work. For obvious reasons we don't push the .env file with the key to the GitHub repo. Therefore, proper code reproduction is only possible without an API key, meaning lightning won't work in such a build. With that said, even without the .env file, all lightning-related code is still being baked into the reproducible build, guaranteeing integrity.

## Contributing

We welcome contributions to trustless! Please follow the standard fork-and-pull request workflow.

### Contribution process

1.  **Fork the repository** to your own github account.
2.  **Clone your fork** to your local machine.
3.  **Create a new branch** for your feature or fix.
4.  **Make your changes** and commit them.
5.  **Push your branch** to your fork.
6.  **Open a pull request** against the `main` branch.

### Guidelines

* **Minimal PRs:** One feature/fix - one PR please.
* **Code style:** Keep code clean and consistent.
* **Testing:** Ensure the app builds and runs via `npm run ios` or `npm run android` before submitting.
* **Issues:** Open an issue to discuss major changes before starting work.

## License

This project is licensed under the **GNU General Public License v3.0** (GPLv3). See the LICENSE file for details.
