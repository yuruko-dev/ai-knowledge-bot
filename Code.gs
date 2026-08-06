/**
 * Code.gs
 * LINE Webhookのエントリポイント。doPost(e)で受信し、各Serviceへ処理を振り分ける。
 */

var URL_PATTERN = /^https?:\/\/\S+$/;
var SAVE_COMMAND = '保存する';
var CANCEL_COMMAND = '保存しない';

/**
 * LINE Webhookのエントリポイント。
 * @param {Object} e doPostイベントオブジェクト
 * @return {ContentService.TextOutput} LINEへ返すレスポンス(常に200 OK)
 */
function doPost(e) {
  try {
    var body = e.postData.contents;

    // 注意: Google Apps ScriptのdoPost(e)はHTTPリクエストヘッダーを
    // 公開しない仕様(Google公式が対応しない旨を表明済み)のため、
    // X-Line-Signatureヘッダーを用いた署名検証はGAS上では実行できない。
    // LineService.verifyLineSignature()は将来ヘッダーが利用可能になった場合や
    // プロキシ経由でシグネチャを転送する構成のために残してあるが、
    // 本エントリポイントからは呼び出していない。詳細はREADME.mdの
    // 「セキュリティ上の注意点」を参照。

    var json = JSON.parse(body);
    var events = json.events || [];

    events.forEach(function (event) {
      try {
        handleEvent_(event);
      } catch (err) {
        Logger.log('イベント処理中にエラーが発生しました: ' + err.message);
      }
    });
  } catch (err) {
    Logger.log('doPostでエラーが発生しました: ' + err.message);
  }

  return ContentService.createTextOutput('OK');
}

/**
 * 単一のLINEイベントを処理する。
 * @param {Object} event LINE Webhookイベント
 */
function handleEvent_(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return;
  }

  if (!isEventUnique_(event)) {
    Logger.log('重複イベントを検知したためスキップします: ' + event.message.id);
    return;
  }

  var userId = event.source && event.source.userId;
  var replyToken = event.replyToken;
  var text = (event.message.text || '').trim();

  if (!userId || !replyToken) {
    Logger.log('userIdまたはreplyTokenが取得できませんでした。');
    return;
  }

  if (!text) {
    replyToLine(replyToken, MESSAGES.EMPTY_INPUT);
    return;
  }

  if (text === SAVE_COMMAND) {
    handleSaveCommand_(userId, replyToken);
    return;
  }

  if (text === CANCEL_COMMAND) {
    handleCancelCommand_(userId, replyToken);
    return;
  }

  handleContentSubmission_(userId, replyToken, text);
}

/**
 * 同一Webhookイベントの重複処理を防止する。
 * CacheServiceに一定時間message.idを記録し、既に存在すれば重複と判定する。
 * @param {Object} event LINE Webhookイベント
 * @return {boolean} 未処理のイベントであればtrue
 */
function isEventUnique_(event) {
  var eventId = event.message && event.message.id;
  if (!eventId) {
    return true;
  }

  var cache = CacheService.getScriptCache();
  var cacheKey = 'event_' + eventId;

  if (cache.get(cacheKey)) {
    return false;
  }

  cache.put(cacheKey, '1', DEDUPE_CACHE_TTL_SEC);
  return true;
}

/**
 * 通常の文章またはURLを受信した場合の処理。
 * @param {string} userId LINE userId
 * @param {string} replyToken 返信トークン
 * @param {string} text 受信テキスト
 */
function handleContentSubmission_(userId, replyToken, text) {
  var isUrl = URL_PATTERN.test(text);
  var inputType = isUrl ? 'URL' : 'テキスト';
  var difyContent = text;

  if (isUrl) {
    var article = fetchArticleContent(text);

    if (!article) {
      replyToLine(replyToken, MESSAGES.CONTENT_FETCH_FAILED);
      return;
    }

    difyContent = '元URL:\n' + text + '\n\n記事本文:\n' + article.content;
  }

  var difyResult = runDifyWorkflow(difyContent, userId);

  if (!difyResult) {
    replyToLine(replyToken, MESSAGES.GENERIC_ERROR);
    return;
  }

  savePendingData(userId, {
    title: difyResult.title,
    summary: difyResult.summary,
    category: difyResult.category,
    tags: difyResult.tags,
    inputType: inputType,
    originalUrl: isUrl ? text : '',
    originalText: isUrl ? '' : text
  });

  replyToLine(replyToken, difyResult.displayText);
}

/**
 * 「保存する」受信時の処理。
 * @param {string} userId LINE userId
 * @param {string} replyToken 返信トークン
 */
function handleSaveCommand_(userId, replyToken) {
  var pendingData = getPendingData(userId);

  if (!pendingData) {
    replyToLine(replyToken, MESSAGES.NO_PENDING);
    return;
  }

  var success = appendToSheet(pendingData);

  if (!success) {
    replyToLine(replyToken, MESSAGES.GENERIC_ERROR);
    return;
  }

  deletePendingData(userId);
  replyToLine(replyToken, MESSAGES.SAVED);
}

/**
 * 「保存しない」受信時の処理。
 * @param {string} userId LINE userId
 * @param {string} replyToken 返信トークン
 */
function handleCancelCommand_(userId, replyToken) {
  var pendingData = getPendingData(userId);

  if (!pendingData) {
    replyToLine(replyToken, MESSAGES.NO_PENDING);
    return;
  }

  deletePendingData(userId);
  replyToLine(replyToken, MESSAGES.NOT_SAVED);
}
