#include "clipboard_uri_syntax.h"

#include <cstddef>
#include <cstdint>

namespace clipboard_codecs {
namespace {

bool IsAsciiAlpha(char32_t value) {
  return (value >= U'a' && value <= U'z') ||
         (value >= U'A' && value <= U'Z');
}

bool IsAsciiDigit(char32_t value) { return value >= U'0' && value <= U'9'; }

bool IsAsciiHex(char32_t value) {
  return IsAsciiDigit(value) || (value >= U'a' && value <= U'f') ||
         (value >= U'A' && value <= U'F');
}

bool IsUnreserved(char32_t value) {
  return IsAsciiAlpha(value) || IsAsciiDigit(value) || value == U'-' ||
         value == U'.' || value == U'_' || value == U'~';
}

bool IsSubDelimiter(char32_t value) {
  return value == U'!' || value == U'$' || value == U'&' || value == U'\'' ||
         value == U'(' || value == U')' || value == U'*' || value == U'+' ||
         value == U',' || value == U';' || value == U'=';
}

bool IsUcschar(char32_t value) {
  if (value >= 0x00a0 && value <= 0xd7ff) return true;
  if ((value >= 0xf900 && value <= 0xfdcf) ||
      (value >= 0xfdf0 && value <= 0xffef)) {
    return true;
  }
  if (value >= 0x10000 && value <= 0xdfffd) {
    return value % 0x10000 <= 0xfffd;
  }
  return value >= 0xe1000 && value <= 0xefffd &&
         value % 0x10000 <= 0xfffd;
}

bool IsIprivate(char32_t value) {
  return (value >= 0xe000 && value <= 0xf8ff) ||
         (value >= 0xf0000 && value <= 0xffffd) ||
         (value >= 0x100000 && value <= 0x10fffd);
}

bool ReadScalar(std::u16string_view text, std::size_t* offset,
                char32_t* scalar) {
  if (offset == nullptr || scalar == nullptr || *offset >= text.size()) {
    return false;
  }
  const char16_t first = text[*offset];
  if (first >= 0xd800 && first <= 0xdbff) {
    if (*offset + 1 >= text.size()) return false;
    const char16_t second = text[*offset + 1];
    if (second < 0xdc00 || second > 0xdfff) return false;
    *scalar = 0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00);
    *offset += 2;
    return true;
  }
  if (first >= 0xdc00 && first <= 0xdfff) return false;
  *scalar = first;
  ++*offset;
  return true;
}

bool IsIunreserved(char32_t value) {
  return IsUnreserved(value) || IsUcschar(value);
}

bool IsPctEncoded(std::u16string_view text, std::size_t* offset,
                  std::size_t end) {
  if (*offset + 2 >= end || text[*offset] != u'%' ||
      !IsAsciiHex(text[*offset + 1]) || !IsAsciiHex(text[*offset + 2])) {
    return false;
  }
  *offset += 3;
  return true;
}

enum class Component { userinfo, reg_name, path, query, fragment, zone_id };

bool IsComponent(std::u16string_view text, std::size_t begin,
                 std::size_t end, Component component) {
  std::size_t offset = begin;
  while (offset < end) {
    const char32_t value = text[offset];
    if (value == U'%') {
      if (!IsPctEncoded(text, &offset, end)) return false;
      continue;
    }
    if (value == U'/') {
      if (component == Component::path || component == Component::query ||
          component == Component::fragment) {
        ++offset;
        continue;
      }
      return false;
    }
    if (value == U'?') {
      if (component == Component::query || component == Component::fragment) {
        ++offset;
        continue;
      }
      return false;
    }

    char32_t scalar = 0;
    if (!ReadScalar(text, &offset, &scalar)) return false;
    if (component == Component::zone_id) {
      if (IsUnreserved(scalar)) continue;
      return false;
    }
    if (IsIunreserved(scalar)) continue;
    if (IsSubDelimiter(scalar)) continue;
    if (component == Component::userinfo && scalar == U':') continue;
    if ((component == Component::path || component == Component::query ||
         component == Component::fragment) &&
        (scalar == U':' || scalar == U'@')) {
      continue;
    }
    if (component == Component::query && IsIprivate(scalar)) continue;
    return false;
  }
  return true;
}

bool IsPort(std::u16string_view value) {
  for (const char16_t digit : value) {
    if (!IsAsciiDigit(digit)) return false;
  }
  return true;
}

bool IsIpv4Address(std::u16string_view text) {
  std::size_t start = 0;
  std::size_t parts = 0;
  while (start <= text.size()) {
    const std::size_t end = text.find(u'.', start);
    const auto part = text.substr(
        start, end == std::u16string_view::npos ? std::u16string_view::npos
                                                : end - start);
    if (part.empty() || part.size() > 3 ||
        (part.size() > 1 && part.front() == u'0')) {
      return false;
    }
    unsigned int value = 0;
    for (const char16_t digit : part) {
      if (!IsAsciiDigit(digit)) return false;
      value = value * 10 + static_cast<unsigned int>(digit - u'0');
    }
    if (value > 255) return false;
    ++parts;
    if (end == std::u16string_view::npos) break;
    start = end + 1;
  }
  return parts == 4;
}

bool CountIpv6Groups(std::u16string_view part, bool allow_ipv4_tail,
                     std::size_t* groups) {
  if (part.empty()) return true;
  std::size_t start = 0;
  while (start <= part.size()) {
    const std::size_t end = part.find(u':', start);
    const auto token = part.substr(
        start, end == std::u16string_view::npos ? std::u16string_view::npos
                                                : end - start);
    if (token.empty()) return false;
    if (token.find(u'.') != std::u16string_view::npos) {
      if (!allow_ipv4_tail || end != std::u16string_view::npos ||
          !IsIpv4Address(token)) {
        return false;
      }
      *groups += 2;
    } else {
      if (token.size() > 4) return false;
      for (const char16_t digit : token) {
        if (!IsAsciiHex(digit)) return false;
      }
      ++*groups;
    }
    if (end == std::u16string_view::npos) break;
    start = end + 1;
  }
  return true;
}

bool IsIpv6Address(std::u16string_view address) {
  if (address.empty()) return false;
  const std::size_t compression = address.find(u"::");
  const bool compressed = compression != std::u16string_view::npos;
  if (compressed &&
      (address.find(u"::", compression + 2) != std::u16string_view::npos ||
       address.find(u":::") != std::u16string_view::npos)) {
    return false;
  }
  std::size_t groups = 0;
  if (!compressed) {
    return CountIpv6Groups(address, true, &groups) && groups == 8;
  }
  if (!CountIpv6Groups(address.substr(0, compression), false, &groups) ||
      !CountIpv6Groups(address.substr(compression + 2), true, &groups)) {
    return false;
  }
  return groups < 8;
}

bool IsIpvFuture(std::u16string_view address) {
  if (address.size() < 4 ||
      (address.front() != u'v' && address.front() != u'V')) {
    return false;
  }
  const std::size_t dot = address.find(u'.', 1);
  if (dot == std::u16string_view::npos || dot == 1 || dot + 1 == address.size()) {
    return false;
  }
  for (std::size_t index = 1; index < dot; ++index) {
    if (!IsAsciiHex(address[index])) return false;
  }
  for (std::size_t index = dot + 1; index < address.size(); ++index) {
    const char16_t value = address[index];
    if (IsUnreserved(value) || IsSubDelimiter(value) || value == u':') continue;
    return false;
  }
  return true;
}

bool IsIpLiteral(std::u16string_view host) {
  if (host.size() < 4 || host.front() != u'[' || host.back() != u']') {
    return false;
  }
  const auto address = host.substr(1, host.size() - 2);
  if (IsIpvFuture(address)) return true;

  const std::size_t zone = address.find(u"%25");
  if (zone == std::u16string_view::npos) return IsIpv6Address(address);
  if (!IsIpv6Address(address.substr(0, zone)) || zone + 3 == address.size()) {
    return false;
  }
  // RFC 3986 predates scoped IPv6 literals; retain the existing RFC 6874
  // percent-escaped zone identifier extension for clipboard URLs.
  return IsComponent(address, zone + 3, address.size(), Component::zone_id);
}

bool IsRegName(std::u16string_view name) {
  return IsComponent(name, 0, name.size(), Component::reg_name);
}

bool IsAuthority(std::u16string_view authority) {
  const std::size_t at = authority.find(u'@');
  std::size_t host_begin = 0;
  if (at != std::u16string_view::npos) {
    if (authority.find(u'@', at + 1) != std::u16string_view::npos ||
        !IsComponent(authority, 0, at, Component::userinfo)) {
      return false;
    }
    host_begin = at + 1;
  }

  std::size_t host_end = authority.size();
  std::size_t port_begin = authority.size();
  if (host_begin < authority.size() && authority[host_begin] == u'[') {
    const std::size_t close = authority.find(u']', host_begin + 1);
    if (close == std::u16string_view::npos ||
        !IsIpLiteral(authority.substr(host_begin, close - host_begin + 1))) {
      return false;
    }
    host_end = close + 1;
    if (host_end < authority.size()) {
      if (authority[host_end] != u':') return false;
      port_begin = host_end + 1;
    }
  } else {
    for (std::size_t index = host_begin; index < authority.size(); ++index) {
      if (authority[index] == u'[' || authority[index] == u']') return false;
      if (authority[index] == u':') {
        if (port_begin != authority.size()) return false;
        host_end = index;
        port_begin = index + 1;
      }
    }
    if (!IsRegName(authority.substr(host_begin, host_end - host_begin))) {
      return false;
    }
  }
  return port_begin == authority.size() || IsPort(authority.substr(port_begin));
}

bool IsPchar(std::u16string_view text, std::size_t* offset,
             std::size_t end) {
  const std::size_t begin = *offset;
  if (text[begin] == u'%') return IsPctEncoded(text, offset, end);
  char32_t scalar = 0;
  if (!ReadScalar(text, offset, &scalar)) return false;
  return IsIunreserved(scalar) || IsSubDelimiter(scalar) || scalar == U':' ||
         scalar == U'@';
}

bool IsPath(std::u16string_view text, std::size_t begin, std::size_t end,
            bool has_authority) {
  if (begin == end) return true;
  if (has_authority && text[begin] != u'/') return false;
  if (!has_authority && text[begin] == u'/') {
    if (begin + 1 < end && text[begin + 1] == u'/') return false;
    if (begin + 1 == end) return true;
    std::size_t first_segment = begin + 1;
    if (text[first_segment] == u'/') return false;
    if (!IsPchar(text, &first_segment, end)) return false;
    begin = first_segment;
  } else if (!has_authority) {
    if (text[begin] == u'/') return false;
    if (!IsPchar(text, &begin, end)) return false;
  }

  while (begin < end) {
    if (text[begin] == u'/') {
      ++begin;
    } else if (!IsPchar(text, &begin, end)) {
      return false;
    }
  }
  return true;
}

bool IsQueryOrFragment(std::u16string_view text, std::size_t begin,
                       std::size_t end, Component component) {
  return IsComponent(text, begin, end, component);
}

bool IsValidAbsolute(std::u16string_view text) {
  if (text.empty()) return false;
  const std::size_t colon = text.find(u':');
  if (colon == 0 || colon == std::u16string_view::npos ||
      !IsAsciiAlpha(text.front())) {
    return false;
  }
  for (std::size_t index = 1; index < colon; ++index) {
    const char16_t value = text[index];
    if (!IsAsciiAlpha(value) && !IsAsciiDigit(value) && value != u'+' &&
        value != u'-' && value != u'.') {
      return false;
    }
  }

  std::size_t begin = colon + 1;
  bool has_authority = false;
  if (text.substr(begin, 2) == u"//") {
    has_authority = true;
    const std::size_t authority_begin = begin + 2;
    const std::size_t authority_end = text.find_first_of(u"/?#", authority_begin);
    begin = authority_end == std::u16string_view::npos ? text.size()
                                                       : authority_end;
    if (!IsAuthority(text.substr(authority_begin, begin - authority_begin))) {
      return false;
    }
  }

  const std::size_t path_end = text.find_first_of(u"?#", begin);
  const std::size_t end_path =
      path_end == std::u16string_view::npos ? text.size() : path_end;
  if (!IsPath(text, begin, end_path, has_authority)) return false;
  begin = end_path;

  if (begin < text.size() && text[begin] == u'?') {
    const std::size_t query_begin = ++begin;
    const std::size_t fragment = text.find(u'#', begin);
    const std::size_t query_end =
        fragment == std::u16string_view::npos ? text.size() : fragment;
    if (!IsQueryOrFragment(text, query_begin, query_end, Component::query)) {
      return false;
    }
    begin = query_end;
  }
  if (begin < text.size() && text[begin] == u'#') {
    if (!IsQueryOrFragment(text, begin + 1, text.size(), Component::fragment)) {
      return false;
    }
    begin = text.size();
  }
  return begin == text.size();
}

}  // namespace

bool IsValidStoredAbsoluteUri(std::u16string_view text) {
  return IsValidAbsolute(text);
}

}  // namespace clipboard_codecs
