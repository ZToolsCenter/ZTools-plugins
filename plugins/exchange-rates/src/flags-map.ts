const FLAG_REGION: Record<string, string> = {
  AED: "ae", AFN: "af", ALL: "al", AMD: "am", ANG: "cw", AOA: "ao", ARS: "ar", AUD: "au",
  AWG: "aw", AZN: "az", BAM: "ba", BBD: "bb", BDT: "bd", BHD: "bh", BIF: "bi", BMD: "bm",
  BND: "bn", BOB: "bo", BRL: "br", BSD: "bs", BTN: "bt", BWP: "bw", BYN: "by", BZD: "bz",
  CAD: "ca", CDF: "cd", CHF: "ch", CLP: "cl", CNY: "cn", COP: "co", CRC: "cr", CUP: "cu",
  CVE: "cv", CZK: "cz", DJF: "dj", DKK: "dk", DOP: "do", DZD: "dz", EGP: "eg", ERN: "er",
  ETB: "et", EUR: "eu", FJD: "fj", FKP: "fk", GBP: "gb", GEL: "ge", GHS: "gh", GIP: "gi",
  GMD: "gm", GNF: "gn", GTQ: "gt", GYD: "gy", HKD: "hk", HNL: "hn", HTG: "ht", HUF: "hu",
  IDR: "id", ILS: "il", INR: "in", IQD: "iq", IRR: "ir", ISK: "is", JMD: "jm", JOD: "jo",
  JPY: "jp", KES: "ke", KGS: "kg", KHR: "kh", KMF: "km", KPW: "kp", KRW: "kr", KWD: "kw",
  KYD: "ky", KZT: "kz", LAK: "la", LBP: "lb", LKR: "lk", LRD: "lr", LSL: "ls", LYD: "ly",
  MAD: "ma", MDL: "md", MGA: "mg", MKD: "mk", MMK: "mm", MNT: "mn", MOP: "mo", MRU: "mr",
  MUR: "mu", MVR: "mv", MWK: "mw", MXN: "mx", MYR: "my", MZN: "mz", NAD: "na", NGN: "ng",
  NIO: "ni", NOK: "no", NPR: "np", NZD: "nz", OMR: "om", PAB: "pa", PEN: "pe", PGK: "pg",
  PHP: "ph", PKR: "pk", PLN: "pl", PYG: "py", QAR: "qa", RON: "ro", RSD: "rs", RUB: "ru",
  RWF: "rw", SAR: "sa", SBD: "sb", SCR: "sc", SDG: "sd", SEK: "se", SGD: "sg", SHP: "sh",
  SLE: "sl", SOS: "so", SRD: "sr", SSP: "ss", STN: "st", SYP: "sy", SZL: "sz", THB: "th",
  TJS: "tj", TMT: "tm", TND: "tn", TOP: "to", TRY: "tr", TTD: "tt", TWD: "tw", TZS: "tz",
  UAH: "ua", UGX: "ug", USD: "us", UYU: "uy", UZS: "uz", VES: "ve", VND: "vn", VUV: "vu",
  WST: "ws", YER: "ye", ZAR: "za", ZMW: "zm", ZWG: "zw",
  ATS: "at", BEF: "be", DEM: "de", ESP: "es", FIM: "fi", FRF: "fr", GRD: "gr", IEP: "ie",
  ITL: "it", LUF: "lu", NLG: "nl", PTE: "pt", CYP: "cy", EEK: "ee", LVL: "lv", LTL: "lt",
  MTL: "mt", SIT: "si", SKK: "sk", HRK: "hr", BGN: "bg", ROL: "ro", TRL: "tr", BYR: "by",
  ZMK: "zm", AZM: "az", AFA: "af", CSD: "rs", VEF: "ve", VEB: "ve", GHC: "gh", MZM: "mz",
  TMM: "tm", ZWD: "zw", RUR: "ru", ADP: "ad", AON: "ao", BAD: "ba", CUC: "cu",
};

export function flagRegion(code: string): string | null {
  return FLAG_REGION[code] ?? null;
}
