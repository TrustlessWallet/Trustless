export const formatBitcoinAddressShort = (address: string, opts?: { head?: number; tail?: number; separator?: string }) => {
  const head = opts?.head ?? 6;
  const tail = opts?.tail ?? 6;
  const separator = opts?.separator ?? '...';

  if (!address) return address;

  const minLengthToShorten = head + tail + separator.length + 1;
  if (address.length < minLengthToShorten) return address;

  return `${address.substring(0, head)}${separator}${address.substring(address.length - tail)}`;
};
