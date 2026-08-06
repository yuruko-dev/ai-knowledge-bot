/**
 * Config.gs
 * Script Properties からの設定値取得を一元管理する。
 * APIキー・トークン等は絶対にコードへ直書きしない。
 */

/**
 * Script Properties から必須設定値を取得する。
 * 未設定のキーがあれば例外を投げる。
 * @return {Object} 設定値オブジェクト
 */
function getConfig() {
  var props = PropertiesService.getScriptProperties().getProperties();

  var requiredKeys = [
    'LINE_CHANNEL_SECRET',
    'LINE_CHANNEL_ACCESS_TOKEN',
    'DIFY_API_KEY',
    'DIFY_API_URL',
    'SPREADSHEET_ID',
    'SHEET_NAME'
  ];

  var missing = [];
  requiredKeys.forEach(function (key) {
    if (!props[key]) {
      missing.push(key);
    }
  });

  if (missing.length > 0) {
    throw new Error('Script Properties が未設定です: ' + missing.join(', '));
  }

  return {
    LINE_CHANNEL_SECRET: props.LINE_CHANNEL_SECRET,
    LINE_CHANNEL_ACCESS_TOKEN: props.LINE_CHANNEL_ACCESS_TOKEN,
    DIFY_API_KEY: props.DIFY_API_KEY,
    DIFY_API_URL: props.DIFY_API_URL,
    SPREADSHEET_ID: props.SPREADSHEET_ID,
    SHEET_NAME: props.SHEET_NAME
  };
}

// 保存待ちデータの有効期限(ミリ秒) = 24時間
var PENDING_DATA_TTL_MS = 24 * 60 * 60 * 1000;

// 重複イベント検知用キャッシュの保持時間(秒) = 6分(CacheServiceの上限)
var DEDUPE_CACHE_TTL_SEC = 360;

// 定型返信文言
var MESSAGES = {
  SAVED: '保存しました。',
  NOT_SAVED: '保存せずに終了しました。',
  NO_PENDING: '保存待ちの情報がありません。先に文章またはURLを送ってください。',
  EMPTY_INPUT: '入力が空です。文章またはURLを送ってください。',
  GENERIC_ERROR: '処理中にエラーが発生しました。しばらくしてから再度お試しください。',
  UNSUPPORTED_MESSAGE: 'テキストメッセージのみ対応しています。',
  CONTENT_FETCH_FAILED: 'この記事の本文を取得できませんでした。本文をコピーして送ってください。'
};
