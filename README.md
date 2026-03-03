# Trustless

## Intro
Hi!
Trustless is a fully open-source, non-custodial, privacy-focused, bitcoin-only mobile wallet. It is very minimalist and easy to use, yet very functional.

## Main features
* **Bitcoin wallet:** Import or create new wallets, track balances, send and receive Bitcoin. Trustless also supports pubkey imports for watch-only wallets.

  <img width="250" alt="Wallet" src="https://github.com/user-attachments/assets/c4b1f8de-e08a-4336-a5ff-8139ed797a80" />
  <img width="250" alt="Wallet" src="https://github.com/user-attachments/assets/2fb1f615-290c-4f97-8573-8e0e1633f301" />

* **Balance breakdown:** See actual UTXOs you own by clicking on your total wallet balance.

  <img width="250" alt="Balance details" src="https://github.com/user-attachments/assets/750c5fa2-805a-4e63-8624-2553446a4fa7" />
  <img width="250" alt="Balance details" src="https://github.com/user-attachments/assets/81bb9375-4e1a-42cb-a64e-398be5574015" />

* **Coin control:** Choose which UTXOs to use for a transaction.

  <img width="250" alt="Coin control" src="https://github.com/user-attachments/assets/60111ad7-f238-4bb7-b28f-eb61288d7a22" />
  <img width="250" alt="Coin control" src="https://github.com/user-attachments/assets/68b149fc-02f1-410e-a9ce-be3d30e0f3af" />

* **Custom node and network:** Connect to your own node via Electrum and use testnet network for transaction testing / development.

  <img width="250" alt="Custom node and network" src="https://github.com/user-attachments/assets/199ceec6-9f0c-4332-bdac-213736bfc0da" />
  <img width="250" alt="Custom node and network" src="https://github.com/user-attachments/assets/b4c09a63-ef1f-41e2-9d52-a20b82633e3b" />

* **Receive address change:** Have 20 unused receive addresses at all times to choose from. This is a privacy feature, because address reuse links payments together.

  <img width="800" alt="Receive" src="https://github.com/user-attachments/assets/eada81ef-2979-4178-81ce-322fd2368868" />
* **BIP44 change address management:**  To protect user's privacy even more, all change addresses are derived from 1/n chain and are never reused for receiving. In tandem with the previous feature, Trustless makes it drastically harder to link and track user's BTC.

  <img width="800" alt="Change" src="https://github.com/user-attachments/assets/af596cf8-bc7c-4554-9593-ba78294bb16e" />


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
>    `git tag -a 1.0.2 -m "release 1.0.2"`
>    `git push origin 1.0.2`
> 3. Navigate into the repository directory to ensure all generated files stay in the correct folder:
>    `cd Trustless`
> 4. Generate the unsigned package: 
>    `bash reproducibility.sh`
> 5. If the keystore is missing, generate a new one in the current directory:
>    `keytool -genkey -v -keystore trustless-release.keystore -alias trustless-alias -keyalg RSA -keysize 2048 -validity 10000`
> 6. Locate the signing tool and sign the package using the keystore: 
>    `apksigner_path=$(find ~/Library/Android/sdk/build-tools -name "apksigner" | sort -r | head -n 1); $apksigner_path sign --ks trustless-release.keystore --ks-key-alias trustless-alias --out  trustless-v1.0.2-release.apk trustless/android/app/build/outputs/apk/release/app-release-unsigned.apk`
> 8. Generate the official hash: 
>    `shasum -a 256 trustless-v1.0.2-release.apk`
> 9. Create the github release. Upload the signed package and paste the hash into the release notes.

To verify that the official binary was built exactly from the published source code, follow these steps. This process compares the internal contents of the official signed package against a locally built unsigned package.

1.  **Download the signed release:**
    Download the official signed file from the github releases page into a new testing directory. *(Replace the URL with the specific version you are testing)*.
    ```bash
    curl -L -o trustless-release.apk https://github.com/trustlesswallet/trustless/releases/download/1.0.2/trustless-v1.0.2-release.apk
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
    git checkout 1.0.2
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

* **Minimal PRs:** One feature/fix - one PR please.
* **Code style:** Keep code clean and consistent.
* **Testing:** Ensure the app builds and runs via `npm run ios` or `npm run android` before submitting.
* **Issues:** Open an issue to discuss major changes before starting work.

## License

This project is licensed under the **GNU General Public License v3.0** (GPLv3). See the LICENSE file for details.
