/**
 * StateService.gs
 * LINE userIdごとの「保存待ちデータ」をPropertiesServiceで管理する。
 * キー形式: pending_{LINE_USER_ID}
 */

/**
 * 保存待ちデータのPropertiesServiceキーを生成する。
 * @param {string} userId LINE userId
 * @return {string} キー
 */
function buildPendingKey_(userId) {
  return 'pending_' + userId;
}

/**
 * 保存待ちデータを保存する。
 * @param {string} userId LINE userId
 * @param {Object} data 保存待ちデータ(title, summary, category, tags, inputType, originalUrl, originalText)
 */
function savePendingData(userId, data) {
  var payload = {
    title: data.title,
    summary: data.summary,
    category: data.category,
    tags: data.tags,
    inputType: data.inputType,
    originalUrl: data.originalUrl,
    originalText: data.originalText,
    createdAt: new Date().getTime()
  };

  PropertiesService.getScriptProperties().setProperty(
    buildPendingKey_(userId),
    JSON.stringify(payload)
  );
}

/**
 * 保存待ちデータを取得する。有効期限(24時間)を超えている場合は
 * 自動的に削除しnullを返す。
 * @param {string} userId LINE userId
 * @return {Object|null} 保存待ちデータ、存在しない/期限切れの場合はnull
 */
function getPendingData(userId) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(buildPendingKey_(userId));

  if (!raw) {
    return null;
  }

  var data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    Logger.log('保存待ちデータのJSON解析に失敗しました: ' + e.message);
    props.deleteProperty(buildPendingKey_(userId));
    return null;
  }

  var now = new Date().getTime();
  if (!data.createdAt || now - data.createdAt > PENDING_DATA_TTL_MS) {
    props.deleteProperty(buildPendingKey_(userId));
    return null;
  }

  return data;
}

/**
 * 保存待ちデータを削除する。
 * @param {string} userId LINE userId
 */
function deletePendingData(userId) {
  PropertiesService.getScriptProperties().deleteProperty(buildPendingKey_(userId));
}
