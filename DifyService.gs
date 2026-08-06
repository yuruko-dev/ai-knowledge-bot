/**
 * DifyService.gs
 * Dify Workflow API(blockingモード)の呼び出しを担当する。
 */

/**
 * Dify Workflowを実行し、outputsを取得する。
 * @param {string} content ユーザーが送信した本文(文章またはURL)
 * @param {string} userId LINE userId(Dify側のuserパラメータに使用)
 * @return {Object|null} { displayText, title, summary, category, tags } 失敗時はnull
 */
function runDifyWorkflow(content, userId) {
  var config = getConfig();

  var payload = {
    inputs: {
      content: content
    },
    response_mode: 'blocking',
    user: userId
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + config.DIFY_API_KEY
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response;
  try {
    response = UrlFetchApp.fetch(config.DIFY_API_URL, options);
  } catch (e) {
    Logger.log('Dify API呼び出しで例外が発生しました: ' + e.message);
    return null;
  }

  var statusCode = response.getResponseCode();
  var responseText = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    Logger.log('Dify APIエラー: status=' + statusCode + ' body=' + responseText);
    return null;
  }

  var json;
  try {
    json = JSON.parse(responseText);
  } catch (e) {
    Logger.log('Dify レスポンスのJSON解析に失敗しました: ' + e.message + ' body=' + responseText);
    return null;
  }

  if (!json.data || json.data.status !== 'succeeded' || !json.data.outputs) {
    Logger.log('Dify Workflowが正常終了しませんでした: ' + responseText);
    return null;
  }

  var outputs = json.data.outputs;

  if (
    typeof outputs.display_text === 'undefined' ||
    typeof outputs.title === 'undefined' ||
    typeof outputs.summary === 'undefined' ||
    typeof outputs.category === 'undefined' ||
    typeof outputs.tags === 'undefined'
  ) {
    Logger.log('Dify outputsに必要な項目が不足しています: ' + JSON.stringify(outputs));
    return null;
  }

  return {
    displayText: outputs.display_text,
    title: outputs.title,
    summary: outputs.summary,
    category: outputs.category,
    tags: outputs.tags
  };
}
