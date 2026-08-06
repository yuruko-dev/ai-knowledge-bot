/**
 * LineService.gs
 * LINE Messaging API とのやり取り(署名検証・返信送信)を担当する。
 */

/**
 * LINEからのWebhookリクエストの署名を検証する。
 * 注意: Google Apps ScriptのdoPost(e)はHTTPリクエストヘッダーを取得できない仕様のため、
 * 現状Code.gsのdoPost(e)からは呼び出していない(呼び出し不能なsignature引数を渡す手段がない)。
 * ヘッダー転送プロキシ経由の構成にする場合や、将来GASの仕様変更があった場合に備えて残している。
 * @param {string} body リクエストの生ボディ
 * @param {string} signature X-Line-Signature ヘッダーの値
 * @return {boolean} 署名が正しい場合true
 */
function verifyLineSignature(body, signature) {
  if (!signature) {
    return false;
  }

  var config = getConfig();
  var signatureBytes = Utilities.computeHmacSha256Signature(body, config.LINE_CHANNEL_SECRET);
  var computedSignature = Utilities.base64Encode(signatureBytes);

  return computedSignature === signature;
}

/**
 * LINEへ返信する。
 * @param {string} replyToken 返信トークン
 * @param {string} text 返信テキスト
 */
function replyToLine(replyToken, text) {
  var config = getConfig();

  var payload = {
    replyToken: replyToken,
    messages: [
      {
        type: 'text',
        text: text
      }
    ]
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + config.LINE_CHANNEL_ACCESS_TOKEN
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', options);
    var statusCode = response.getResponseCode();
    if (statusCode < 200 || statusCode >= 300) {
      Logger.log('LINE返信APIエラー: status=' + statusCode + ' body=' + response.getContentText());
    }
  } catch (e) {
    Logger.log('LINE返信APIの呼び出しで例外が発生しました: ' + e.message);
  }
}
