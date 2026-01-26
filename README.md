# Trustless

## Intro
Hi!
Trustless is a fully open-source, Bitcoin-only mobile wallet. It is very minimalist and easy to use, yet very functional.

## Main features
* **Bitcoin wallet:** Import or create new wallets, track balances, send and receive Bitcoin.
* **Address tracker:** Track any Bitcoin address balance just by entering it. No private keys required.
* **Receive address change:** Have 20 unused receive addresses at all times to choose from. This is a privacy feature, because address reuse links payments together.
* **Balance breakdown:** See actual UTXOs you own by clicking on your total wallet balance.
* **Coin control:** Choose which UTXOs to use for a transaction.
* **BIP44 change address management:** Following best privacy practices, all change addresses are being derived from 1/n chain and are only used once. You can see all your change by clicking on your total wallet balance.
* **Custom node connection:** Connect to your own node via Esplora API URL.
* **Network switch:** Use testnet network for transaction testing / development.

## Getting Started

To run the project, you need Node.js and a setup for iOS (Xcode) or Android (Android Studio).

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/pechen987/Trustless.git](https://github.com/pechen987/Trustless.git)
    cd Trustless
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run on Device / Simulator:**

    * **iOS (Mac only):**
        ```bash
        npm run ios
        ```
        *To run on a physical device, add the `-- --device` flag and ensure your iPhone is connected.*

    * **Manual Build (Advanced):**
        If the automated commands fail, you can generate the native directories and build manually:
        ```bash
        npx expo prebuild --clean
        cd ios && pod install && cd ..
        ```
        Then open a Trustless.xcworkspace file in your ios folder to open the project in xCode. From there you can install the app manually.

    * **Android:**
        ```bash
        npm run android
        ```
        *Ensure you have an Android Emulator running or a physical device connected.*



## Contributing

We welcome contributions to Trustless! Please follow the standard fork-and-pull request workflow.

### Issues

### Contribution Process

1.  **Fork the repository** to your own GitHub account.
2.  **Clone your fork** to your local machine.
3.  **Create a new branch** for your feature or fix.
4.  **Make your changes** and commit them.
5.  **Push your branch** to your fork.
6.  **Open a Pull Request (PR)** against the `main` branch.

### Guidelines

* **Code Style:** Keep code clean and consistent.
* **Testing:** Ensure the app builds and runs via `npm run:ios` before submitting.
* **Issues:** Open an issue to discuss major changes before starting work.

## License

This project is licensed under the **GNU General Public License v3.0** (GPLv3). See the [LICENSE](LICENSE) file for details.
