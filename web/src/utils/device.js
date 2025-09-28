export function detectDevice() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

  // Only check for e-readers
  const isEreader =
    /(Kobo|Kindle|Silk|Tolino|PocketBook|Nook|E-ink|Eink|InkPalm)/i.test(ua);

  return {
    ua,
    isEreader,
  };
}
