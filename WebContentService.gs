/**
 * WebContentService.gs
 * URLのみが送信された場合に、Webページ本文を取得・抽出してDifyへ渡せるプレーンテキストに変換する。
 * SSRF対策(プライベートIP・localhost・非HTTPスキーム・認証情報付きURLの拒否)と
 * リダイレクト先URLの安全性検証を行う。
 */

var MAX_ARTICLE_CONTENT_LENGTH = 20000;
var MIN_ARTICLE_CONTENT_LENGTH = 200;
var MAX_REDIRECT_HOPS = 5;
var REMOVE_HTML_TAGS = ['script', 'style', 'noscript', 'svg', 'iframe', 'header', 'footer', 'nav', 'form'];
var FETCH_USER_AGENT = 'Mozilla/5.0 (compatible; AIKnowledgeBot/1.0)';

var BLOCKED_IPV4_CIDRS = [
  [[0, 0, 0, 0], 8],
  [[127, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[172, 16, 0, 0], 12],
  [[192, 168, 0, 0], 16],
  [[169, 254, 0, 0], 16]
];

var HTML_NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”'
};

/**
 * URLからWeb記事の本文を取得する。
 * 取得・抽出に失敗した場合(SSRF拒否、HTTPエラー、HTML以外、本文不足、タイムアウト等)はnullを返す。
 * @param {string} url 取得対象のURL
 * @return {{title: string, content: string}|null}
 */
function fetchArticleContent(url) {
  if (!isUrlSafe_(url)) {
    Logger.log('安全性チェックによりURL取得を拒否しました: ' + url);
    return null;
  }

  var fetched = fetchHtmlFollowingRedirects_(url);
  if (!fetched) {
    return null;
  }

  if (fetched.statusCode < 200 || fetched.statusCode >= 300) {
    Logger.log('Webページ取得エラー: status=' + fetched.statusCode + ' url=' + fetched.finalUrl);
    return null;
  }

  var headers = fetched.response.getHeaders();
  var contentType = (headers['Content-Type'] || headers['content-type'] || '').toLowerCase();

  if (contentType.indexOf('text/html') === -1 && contentType.indexOf('application/xhtml+xml') === -1) {
    Logger.log('HTML以外のコンテンツタイプのため処理を中止します: content-type=' + contentType + ' url=' + fetched.finalUrl);
    return null;
  }

  var html = fetched.response.getContentText();
  if (!html) {
    Logger.log('HTML本文が空でした: ' + fetched.finalUrl);
    return null;
  }

  var title = extractTitle_(html);
  var content = extractMainContent_(html);

  if (!content || content.length < MIN_ARTICLE_CONTENT_LENGTH) {
    Logger.log('本文の抽出量が不十分です(' + (content ? content.length : 0) + '文字): ' + fetched.finalUrl);
    return null;
  }

  if (content.length > MAX_ARTICLE_CONTENT_LENGTH) {
    content = content.substring(0, MAX_ARTICLE_CONTENT_LENGTH);
  }

  return {
    title: title,
    content: content
  };
}

/**
 * リダイレクトを手動で追跡しながらURLを取得する。各ホップでSSRF安全性を再検証する。
 * @param {string} url 取得対象のURL
 * @return {{response: HTTPResponse, finalUrl: string, statusCode: number}|null}
 */
function fetchHtmlFollowingRedirects_(url) {
  var currentUrl = url;

  for (var i = 0; i <= MAX_REDIRECT_HOPS; i++) {
    if (!isUrlSafe_(currentUrl)) {
      Logger.log('リダイレクト先が安全でないURLのため取得を中止します: ' + currentUrl);
      return null;
    }

    var response;
    try {
      response = UrlFetchApp.fetch(currentUrl, {
        method: 'get',
        followRedirects: false,
        muteHttpExceptions: true,
        validateHttpsCertificates: true,
        headers: {
          'User-Agent': FETCH_USER_AGENT
        }
      });
    } catch (e) {
      Logger.log('URL取得で例外が発生しました(タイムアウト・DNS失敗等): ' + currentUrl + ' : ' + e.message);
      return null;
    }

    var statusCode = response.getResponseCode();

    if (statusCode >= 300 && statusCode < 400) {
      var headers = response.getHeaders();
      var location = headers['Location'] || headers['location'];

      if (!location) {
        Logger.log('リダイレクト応答にLocationヘッダーがありません: ' + currentUrl);
        return null;
      }

      var resolved = resolveUrl_(location, currentUrl);
      if (!resolved) {
        Logger.log('リダイレクト先URLを解決できませんでした: ' + location);
        return null;
      }

      currentUrl = resolved;
      continue;
    }

    return { response: response, finalUrl: currentUrl, statusCode: statusCode };
  }

  Logger.log('リダイレクトの回数が上限(' + MAX_REDIRECT_HOPS + ')を超えました: ' + url);
  return null;
}

/**
 * SSRF対策としてURLの安全性を検証する。
 * @param {string} urlString 検証対象のURL文字列
 * @return {boolean} 安全と判断できる場合true
 */
function isUrlSafe_(urlString) {
  var parsed = parseUrl_(urlString);
  if (!parsed) {
    Logger.log('URLの形式を解釈できませんでした: ' + urlString);
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    Logger.log('許可されていないプロトコルです: ' + parsed.protocol);
    return false;
  }

  if (parsed.userinfo) {
    Logger.log('URLに認証情報(ユーザー名/パスワード)が含まれているため拒否します。');
    return false;
  }

  var hostname = parsed.hostname;

  if (hostname === 'localhost') {
    Logger.log('localhostへのアクセスは拒否します。');
    return false;
  }

  var ipParts = parseIPv4_(hostname);
  if (ipParts) {
    if (isBlockedIpv4_(ipParts)) {
      Logger.log('プライベート/予約IPアドレスへのアクセスは拒否します: ' + hostname);
      return false;
    }
  } else if (looksLikeObfuscatedIp_(hostname)) {
    // 通常のdotted-quad(a.b.c.d、各0-255)として解釈できないにも関わらず、
    // IPv6ブラケット表記([::1]等)や10進数一括表記(2130706433等)、
    // 8進数/16進数表記(0177.0.0.1、0x7f.0.0.1等)、省略形(127.1等)のように
    // IPアドレスへの偽装が疑われるホスト名はデフォルト拒否する(フェイルクローズ)。
    // 正規のDNSホスト名の各ラベルが全て数値のみ/0x始まりの16進のみになることは実質無い。
    Logger.log('IPアドレス偽装(非標準表記)の疑いがあるため拒否します: ' + hostname);
    return false;
  }

  return true;
}

/**
 * dotted-quad形式のIPv4として解釈できないホスト名について、
 * IPv6ブラケット表記や非標準のIPv4表記(10進数一括・8進数・16進数・省略形)による
 * SSRF対策回避を試みている可能性があるかを判定する。
 * @param {string} hostname
 * @return {boolean}
 */
function looksLikeObfuscatedIp_(hostname) {
  if (hostname.charAt(0) === '[') {
    return true;
  }

  var labels = hostname.split('.').filter(function (label) {
    return label.length > 0;
  });

  if (labels.length === 0) {
    return false;
  }

  return labels.every(function (label) {
    return /^[0-9]+$/.test(label) || /^0x[0-9a-fA-F]+$/i.test(label);
  });
}

/**
 * http/https URLを簡易的にパースする(GAS環境依存を避けるため正規表現による自前実装)。
 * authority部分の userinfo@host 分割は、WHATWG URL仕様に合わせて「最後の @」を区切りとする
 * (最初の @ で区切ると、`http://@evil.com@127.0.0.1/` のような文字列でuserinfoチェックを
 * すり抜けたうえhostnameが不正な値になり、実際のfetchが到達する先(127.0.0.1)を
 * 安全性チェックが見誤るバグになるため)。
 * @param {string} urlString
 * @return {{protocol: string, userinfo: string, hostname: string, port: string, path: string}|null}
 */
function parseUrl_(urlString) {
  if (typeof urlString !== 'string') {
    return null;
  }

  var schemeMatch = urlString.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  if (!schemeMatch) {
    return null;
  }

  var protocol = schemeMatch[1].toLowerCase() + ':';
  var rest = urlString.substring(schemeMatch[0].length);

  var pathStartIndex = rest.search(/[\/?#]/);
  var authority = pathStartIndex === -1 ? rest : rest.substring(0, pathStartIndex);
  var pathAndBeyond = pathStartIndex === -1 ? '' : rest.substring(pathStartIndex);

  var userinfo = '';
  var hostPort = authority;
  var lastAtIndex = authority.lastIndexOf('@');
  if (lastAtIndex !== -1) {
    userinfo = authority.substring(0, lastAtIndex);
    hostPort = authority.substring(lastAtIndex + 1);
  }

  var hostname = hostPort;
  var port = '';
  var colonIndex = hostPort.lastIndexOf(':');
  if (colonIndex !== -1) {
    var maybePort = hostPort.substring(colonIndex + 1);
    if (/^\d+$/.test(maybePort)) {
      hostname = hostPort.substring(0, colonIndex);
      port = maybePort;
    }
  }

  if (!hostname) {
    return null;
  }

  var path = pathAndBeyond.replace(/[?#].*$/, '');

  return {
    protocol: protocol,
    userinfo: userinfo,
    hostname: hostname.toLowerCase(),
    port: port,
    path: path || '/'
  };
}

/**
 * Locationヘッダーの値を基準URLに対して解決する(絶対URL/プロトコル相対/ルート相対/相対パスに対応)。
 * 「../」などのドットセグメント解決には対応しない(README記載の既知の制限)。
 * @param {string} location Locationヘッダーの値
 * @param {string} baseUrl 基準となる現在のURL
 * @return {string|null}
 */
function resolveUrl_(location, baseUrl) {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(location)) {
    return location;
  }

  var base = parseUrl_(baseUrl);
  if (!base) {
    return null;
  }

  var origin = base.protocol + '//' + base.hostname + (base.port ? ':' + base.port : '');

  if (location.indexOf('//') === 0) {
    return base.protocol + location;
  }

  if (location.indexOf('/') === 0) {
    return origin + location;
  }

  var baseDir = base.path.substring(0, base.path.lastIndexOf('/') + 1) || '/';
  return origin + baseDir + location;
}

/**
 * ホスト名がIPv4リテラルの場合に各オクテットへ分解する。
 * @param {string} hostname
 * @return {number[]|null}
 */
function parseIPv4_(hostname) {
  var match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) {
    return null;
  }

  var parts = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
  var isValid = parts.every(function (n) {
    return n >= 0 && n <= 255;
  });

  return isValid ? parts : null;
}

/**
 * IPv4アドレスがブロック対象CIDR(プライベート/予約範囲)に含まれるか判定する。
 * @param {number[]} ipParts
 * @return {boolean}
 */
function isBlockedIpv4_(ipParts) {
  return BLOCKED_IPV4_CIDRS.some(function (cidr) {
    return ipv4InCidr_(ipParts, cidr[0], cidr[1]);
  });
}

function ipv4InCidr_(ipParts, baseParts, prefixLength) {
  var ipInt = ipv4ToInt_(ipParts);
  var baseInt = ipv4ToInt_(baseParts);
  var mask = prefixLength === 0 ? 0 : (~0 << (32 - prefixLength)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function ipv4ToInt_(parts) {
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * HTMLからタイトルを抽出する(og:title優先、なければtitleタグ)。
 * @param {string} html
 * @return {string}
 */
function extractTitle_(html) {
  var ogTitleMatch =
    html.match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']og:title["'][^>]*>/i);

  if (ogTitleMatch && ogTitleMatch[1]) {
    return decodeHtmlEntities_(ogTitleMatch[1]).trim();
  }

  var titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    return decodeHtmlEntities_(stripHtmlTags_(titleMatch[1])).trim();
  }

  return '';
}

/**
 * HTMLから本文と思われる部分を抽出し、プレーンテキスト化する。
 * article > main > body の優先順位でタグ内を採用する。
 * @param {string} html
 * @return {string}
 */
function extractMainContent_(html) {
  var cleaned = removeUnwantedHtmlTags_(html);

  var section =
    extractTagContent_(cleaned, 'article') ||
    extractTagContent_(cleaned, 'main') ||
    extractTagContent_(cleaned, 'body') ||
    cleaned;

  var text = stripHtmlTags_(section);
  text = decodeHtmlEntities_(text);
  text = normalizeWhitespace_(text);

  return text;
}

/**
 * script/style/noscript/svg/iframe/header/footer/nav/formの各要素を内容ごと除去する。
 * @param {string} html
 * @return {string}
 */
function removeUnwantedHtmlTags_(html) {
  var result = html;
  REMOVE_HTML_TAGS.forEach(function (tag) {
    var pattern = new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*?<\\/' + tag + '>', 'gi');
    result = result.replace(pattern, ' ');
  });
  return result;
}

/**
 * 指定タグの最初の出現箇所の内側HTMLを取得する。
 * @param {string} html
 * @param {string} tagName
 * @return {string|null}
 */
function extractTagContent_(html, tagName) {
  var pattern = new RegExp('<' + tagName + '\\b[^>]*>([\\s\\S]*?)<\\/' + tagName + '>', 'i');
  var match = html.match(pattern);
  return match ? match[1] : null;
}

function stripHtmlTags_(html) {
  return html.replace(/<[^>]+>/g, ' ');
}

/**
 * 主要なHTMLエンティティ(名前付き・数値・16進)をデコードする。
 * 未対応のマイナーな名前付きエンティティはデコードされずそのまま残る(README記載の既知の制限)。
 * @param {string} text
 * @return {string}
 */
function decodeHtmlEntities_(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, function (match, entity) {
    if (entity.charAt(0) === '#') {
      var codePoint;
      if (entity.charAt(1) === 'x' || entity.charAt(1) === 'X') {
        codePoint = parseInt(entity.substring(2), 16);
      } else {
        codePoint = parseInt(entity.substring(1), 10);
      }

      if (isNaN(codePoint)) {
        return match;
      }

      try {
        return String.fromCodePoint(codePoint);
      } catch (e) {
        return match;
      }
    }

    var lower = entity.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(HTML_NAMED_ENTITIES, lower)) {
      return HTML_NAMED_ENTITIES[lower];
    }

    return match;
  });
}

/**
 * 連続する空白・改行を整理する。
 * @param {string} text
 * @return {string}
 */
function normalizeWhitespace_(text) {
  return text
    .replace(/[ \t\u00A0]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
