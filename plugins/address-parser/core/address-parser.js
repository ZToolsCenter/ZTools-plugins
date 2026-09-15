(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AddressParserCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FIELD_LABELS = {
    name: ["收货人", "收件人", "联系人", "姓名"],
    phone: ["联系电话", "手机号码", "手机号", "手机", "电话"],
    province: ["省份"],
    city: ["城市"],
    district: ["区县"],
    detail: ["详细地址", "收货地址", "收件地址", "地址"]
  };

  const LABEL_TO_FIELD = Object.keys(FIELD_LABELS).reduce(function (result, field) {
    FIELD_LABELS[field].forEach(function (label) { result[label] = field; });
    return result;
  }, {});

  const ALL_LABELS = Object.keys(LABEL_TO_FIELD).sort(function (a, b) { return b.length - a.length; });
  const LABEL_RE = new RegExp("(?:^|[\\s,，;；|])(" + ALL_LABELS.join("|") + ")[\\s]*[:：]?[\\s]*", "g");

  const PROVINCES = [
    ["北京市", ["北京市", "北京"]], ["天津市", ["天津市", "天津"]],
    ["上海市", ["上海市", "上海"]], ["重庆市", ["重庆市", "重庆"]],
    ["河北省", ["河北省", "河北"]], ["山西省", ["山西省", "山西"]],
    ["辽宁省", ["辽宁省", "辽宁"]], ["吉林省", ["吉林省", "吉林"]],
    ["黑龙江省", ["黑龙江省", "黑龙江"]], ["江苏省", ["江苏省", "江苏"]],
    ["浙江省", ["浙江省", "浙江"]], ["安徽省", ["安徽省", "安徽"]],
    ["福建省", ["福建省", "福建"]], ["江西省", ["江西省", "江西"]],
    ["山东省", ["山东省", "山东"]], ["河南省", ["河南省", "河南"]],
    ["湖北省", ["湖北省", "湖北"]], ["湖南省", ["湖南省", "湖南"]],
    ["广东省", ["广东省", "广东"]], ["海南省", ["海南省", "海南"]],
    ["四川省", ["四川省", "四川"]], ["贵州省", ["贵州省", "贵州"]],
    ["云南省", ["云南省", "云南"]], ["陕西省", ["陕西省", "陕西"]],
    ["甘肃省", ["甘肃省", "甘肃"]], ["青海省", ["青海省", "青海"]],
    ["台湾省", ["台湾省", "台湾"]],
    ["内蒙古自治区", ["内蒙古自治区", "内蒙古"]],
    ["广西壮族自治区", ["广西壮族自治区", "广西壮族", "广西"]],
    ["西藏自治区", ["西藏自治区", "西藏"]],
    ["宁夏回族自治区", ["宁夏回族自治区", "宁夏回族", "宁夏"]],
    ["新疆维吾尔自治区", ["新疆维吾尔自治区", "新疆维吾尔", "新疆"]],
    ["香港特别行政区", ["香港特别行政区", "香港"]],
    ["澳门特别行政区", ["澳门特别行政区", "澳门"]]
  ];

  const MUNICIPALITIES = new Set(["北京市", "天津市", "上海市", "重庆市"]);
  const ADDRESS_SUFFIX_RE = /(省|市|自治区|自治州|地区|盟|区|县|旗|街道|镇|乡|村|路|街|巷|弄|号|栋|幢|单元|室|园|苑|大厦|广场)$/;
  const MOBILE_RE = /(?:^|\D)((?:\+?86[\s-]?)?1[3-9](?:[\s-]?\d){9})(?!\d)/;
  const LANDLINE_RE = /(?:\b|\D)(0\d{2,3}[\s-]\d{7,8}(?:[\s-]?(?:转)?\d{1,6})?)(?=\D|$)/;
  const FIELD_NAMES = ["name", "phone", "province", "city", "district", "detail"];
  const FIELD_TITLES = { name: "姓名", phone: "电话", province: "省", city: "市", district: "区县", detail: "详细地址" };

  function normalizeText(value) {
    return String(value == null ? "" : value)
      .replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (char) { return String.fromCharCode(char.charCodeAt(0) - 0xFEE0); })
      .replace(/\u3000/g, " ")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  function trimValue(value) {
    return String(value || "").replace(/^[\s,，;；|:：-]+|[\s,，;；|]+$/g, "").trim();
  }

  function parseLabelledFields(text) {
    const matches = [];
    LABEL_RE.lastIndex = 0;
    let match;
    while ((match = LABEL_RE.exec(text))) {
      matches.push({ label: match[1], start: match.index, valueStart: LABEL_RE.lastIndex });
    }
    const fields = {};
    matches.forEach(function (item, index) {
      const end = index + 1 < matches.length ? matches[index + 1].start : text.length;
      const field = LABEL_TO_FIELD[item.label];
      const value = trimValue(text.slice(item.valueStart, end));
      if (value && !fields[field]) fields[field] = value;
    });
    return fields;
  }

  function extractPhone(text, labelledPhone) {
    const source = labelledPhone || text;
    let match = source.match(MOBILE_RE);
    let type = "mobile";
    if (!match) {
      match = source.match(LANDLINE_RE);
      type = "landline";
    }
    if (!match) return { value: "", raw: "", index: -1, type: "" };
    const raw = match[1] || match[0];
    let digits = raw.replace(/\D/g, "");
    if (type === "mobile" && digits.length === 13 && digits.indexOf("86") === 0) digits = digits.slice(2);
    return { value: digits, raw: trimValue(raw), index: text.indexOf(trimValue(raw)), type: type };
  }

  function findProvinceMatch(source, officialOnly, requireAddressTail) {
    let best = null;
    PROVINCES.forEach(function (entry) {
      entry[1].forEach(function (alias) {
        if (officialOnly && alias !== entry[0]) return;
        const index = source.indexOf(alias);
        const tail = source.slice(index + alias.length);
        if (index !== -1 && requireAddressTail && !/^[^\s,，;；|]{1,14}?(?:自治州|地区|盟|市|新区|自治县|自治旗|林区|特区|旗|县|区)/.test(tail)) return;
        if (index !== -1 && (!best || index < best.index || (index === best.index && alias.length > best.raw.length))) {
          best = { value: entry[0], raw: alias, index: index };
        }
      });
    });
    return best;
  }

  function findProvince(text, labelledProvince, preferredStart) {
    if (labelledProvince) {
      const labelled = findProvinceMatch(labelledProvince, false, false);
      if (labelled) labelled.index = text.indexOf(labelled.raw);
      return labelled || { value: "", raw: "", index: -1 };
    }
    const official = findProvinceMatch(text, true, false);
    if (official) return official;
    const start = Number.isFinite(preferredStart) && preferredStart > 0 ? preferredStart : 0;
    const preferredSource = text.slice(start);
    const preferred = findProvinceMatch(preferredSource, false, true) || findProvinceMatch(preferredSource, false, false);
    if (preferred) preferred.index += start;
    const best = preferred || findProvinceMatch(text, false, true);
    return best || { value: "", raw: "", index: -1 };
  }

  function stripLeadingSeparators(value) {
    return String(value || "").replace(/^[\s,，;；|:：-]+/, "");
  }

  function extractRegions(source, labels, phone) {
    const regionSource = labels.detail || source;
    const preferredStart = labels.detail ? 0 : (phone.index >= 0 ? phone.index + phone.raw.length : 0);
    const province = findProvince(regionSource, labels.province, preferredStart);
    let cursor = regionSource;
    const provinceIndex = province.raw ? regionSource.indexOf(province.raw) : -1;
    if (provinceIndex >= 0) {
      cursor = regionSource.slice(provinceIndex + province.raw.length);
    }
    cursor = stripLeadingSeparators(cursor);

    let city = trimValue(labels.city || "");
    let cityRaw = city;
    if (!city && province.value && MUNICIPALITIES.has(province.value)) {
      city = province.value;
      cityRaw = "";
    } else if (!city) {
      const cityMatch = cursor.match(/^([^\s,，;；|]{1,14}?(?:自治州|地区|盟|市))/);
      if (cityMatch) {
        city = cityMatch[1];
        cityRaw = cityMatch[1];
        cursor = cursor.slice(cityMatch[1].length);
      }
    } else {
      const index = cursor.indexOf(cityRaw);
      if (index >= 0) cursor = cursor.slice(index + cityRaw.length);
    }
    cursor = stripLeadingSeparators(cursor);

    let district = trimValue(labels.district || "");
    let districtRaw = district;
    if (!district) {
      const districtMatch = cursor.match(/^([^\s,，;；|]{1,14}?(?:新区|自治县|自治旗|林区|特区|旗|县|区|市))/);
      if (districtMatch) {
        district = districtMatch[1];
        districtRaw = districtMatch[1];
      }
    }
    return {
      province: province.value,
      provinceRaw: province.raw,
      city: city,
      cityRaw: cityRaw,
      district: district,
      districtRaw: districtRaw
    };
  }

  function looksLikeName(value) {
    const candidate = trimValue(value);
    if (!candidate || ADDRESS_SUFFIX_RE.test(candidate)) return false;
    return /^[\u3400-\u9fff·]{2,8}$/.test(candidate) || /^[A-Za-z][A-Za-z .'-]{1,39}$/.test(candidate);
  }

  function extractName(text, labelledName, phone, province) {
    if (labelledName) return trimValue(labelledName);
    const boundaries = [phone.index, province.index].filter(function (index) { return index > 0; });
    const prefix = trimValue(text.slice(0, boundaries.length ? Math.min.apply(Math, boundaries) : 0));
    const prefixParts = prefix.split(/[\s,，;；|:：]+/).filter(Boolean);
    for (let i = 0; i < prefixParts.length; i += 1) {
      if (looksLikeName(prefixParts[i])) return prefixParts[i];
    }
    if (phone.index >= 0) {
      const afterPhone = text.slice(phone.index + phone.raw.length);
      const beforeProvince = province.index > phone.index ? afterPhone.slice(0, province.index - phone.index - phone.raw.length) : afterPhone;
      const parts = trimValue(beforeProvince).split(/[\s,，;；|:：]+/).filter(Boolean);
      for (let i = 0; i < parts.length; i += 1) {
        if (looksLikeName(parts[i])) return parts[i];
      }
    }
    return "";
  }

  function removeOnce(source, value) {
    if (!value) return source;
    const index = source.indexOf(value);
    return index < 0 ? source : source.slice(0, index) + " " + source.slice(index + value.length);
  }

  function extractDetail(source, labels, name, phone, regions) {
    let detail = labels.detail || source;
    ALL_LABELS.forEach(function (label) {
      detail = detail.replace(new RegExp("(^|[\\s,，;；|])" + label + "[\\s]*[:：]?", "g"), " ");
    });
    detail = removeOnce(detail, phone.raw);
    detail = removeOnce(detail, name);
    detail = removeOnce(detail, regions.provinceRaw);
    if (regions.cityRaw && regions.cityRaw !== regions.provinceRaw) detail = removeOnce(detail, regions.cityRaw);
    detail = removeOnce(detail, regions.districtRaw);
    return trimValue(detail.replace(/[\s,，;；|]+/g, " "));
  }

  function parseAddress(input, index) {
    const original = normalizeText(input);
    const labels = parseLabelledFields(original);
    const phone = extractPhone(original, labels.phone);
    const regions = extractRegions(original, labels, phone);
    const provincePosition = regions.provinceRaw ? original.indexOf(regions.provinceRaw) : -1;
    const name = extractName(original, labels.name, phone, { index: provincePosition });
    const detail = extractDetail(original, labels, name, phone, regions);
    const record = {
      id: Number.isFinite(index) ? index : 1,
      original: original,
      name: name,
      phone: phone.value,
      province: regions.province,
      city: regions.city,
      district: regions.district,
      detail: detail,
      phoneType: phone.type,
      missingFields: [],
      complete: false
    };
    record.missingFields = FIELD_NAMES.filter(function (field) { return !record[field]; });
    record.complete = record.missingFields.length === 0;
    return record;
  }

  function splitRecords(input, mode) {
    const normalized = normalizeText(input);
    if (!normalized) return [];
    if (mode === "blank") {
      return normalized.split(/\n\s*\n+/).map(function (part) {
        return trimValue(part.replace(/\n+/g, " "));
      }).filter(Boolean);
    }
    return normalized.split(/\n+/).map(trimValue).filter(Boolean);
  }

  function parseBatch(input, mode) {
    return splitRecords(input, mode).map(function (record, index) { return parseAddress(record, index + 1); });
  }

  function refreshRecord(record) {
    const copy = Object.assign({}, record);
    copy.missingFields = FIELD_NAMES.filter(function (field) { return !trimValue(copy[field]); });
    copy.complete = copy.missingFields.length === 0;
    return copy;
  }

  return {
    FIELD_NAMES: FIELD_NAMES,
    FIELD_TITLES: FIELD_TITLES,
    normalizeText: normalizeText,
    parseAddress: parseAddress,
    parseBatch: parseBatch,
    refreshRecord: refreshRecord,
    splitRecords: splitRecords
  };
});
