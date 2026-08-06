/**
 * SheetService.gs
 * Googleスプレッドシートへの保存を担当する。
 * シート列構成:
 * A: ID / B: 保存日時 / C: タイトル / D: 要約 / E: カテゴリ / F: タグ
 * G: 入力タイプ / H: 元URL / I: 元テキスト / J: ステータス
 */

/**
 * 保存待ちデータをスプレッドシートへ1行追加する。
 * @param {Object} pendingData StateService.getPendingDataの戻り値
 * @return {boolean} 成功時true、失敗時false
 */
function appendToSheet(pendingData) {
  var config = getConfig();

  try {
    var spreadsheet = SpreadsheetApp.openById(config.SPREADSHEET_ID);
    var sheet = spreadsheet.getSheetByName(config.SHEET_NAME);

    if (!sheet) {
      Logger.log('シートが見つかりません: ' + config.SHEET_NAME);
      return false;
    }

    var id = Utilities.getUuid();
    var savedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    var tagsText = Array.isArray(pendingData.tags) ? pendingData.tags.join(',') : (pendingData.tags || '');

    sheet.appendRow([
      id,
      savedAt,
      pendingData.title || '',
      pendingData.summary || '',
      pendingData.category || '',
      tagsText,
      pendingData.inputType || '',
      pendingData.originalUrl || '',
      pendingData.originalText || '',
      '保存済み'
    ]);

    return true;
  } catch (e) {
    Logger.log('スプレッドシートへの保存でエラーが発生しました: ' + e.message);
    return false;
  }
}
