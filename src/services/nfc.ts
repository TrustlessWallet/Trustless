import NfcManager, { NfcTech, Ndef } from 'react-native-nfc-manager';

NfcManager.start();

export const scanNfcTag = async (): Promise<void> => {
  try {
    console.log("LOG  DEBUG: Requesting NFC technology...");
    await NfcManager.requestTechnology(NfcTech.Ndef);
    
    const tag = await NfcManager.getTag();
    console.log("LOG  DEBUG: Tag successfully scanned:", JSON.stringify(tag, null, 2));

    if (tag?.ndefMessage && tag.ndefMessage.length > 0) {
      const ndefRecord = tag.ndefMessage[0];
      const decodedPayload = Ndef.uri.decodePayload(new Uint8Array(ndefRecord.payload));
      
      console.log("LOG  DEBUG: Raw Decoded Payload:", decodedPayload);
      
    } else {
      console.log("LOG  DEBUG: Tag was read, but no NDEF message found.");
    }
  } catch (ex) {
    console.warn("LOG  DEBUG: NFC Scan Failed or Cancelled", ex);
  } finally {
    console.log("LOG  DEBUG: Closing NFC Session.");
    NfcManager.cancelTechnologyRequest();
  }
};