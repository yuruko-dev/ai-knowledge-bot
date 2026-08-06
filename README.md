# AIナレッジ整理Bot

LINEに送るだけで、文章やWeb記事をAIが自動で要約・分類し、確認したうえでGoogleスプレッドシートへ蓄積できるナレッジ管理Botです。LINE Messaging API・Dify・Google Apps Script(GAS)のみで構築しており、サーバーレスかつ無料枠の範囲で運用できます。

## 概要

日々LINEでメモしたり、後で読もうと思って送ったURLが埋もれてしまう課題を解決するために作成しました。LINEへ文章またはURLを送るとAI(Dify Workflow)が「タイトル」「要約」「カテゴリ」「タグ」を自動生成して返信し、ユーザーが「保存する」と返信した場合のみGoogleスプレッドシートへ記録します。URLの場合はGAS側でページ本文を取得・抽出してからAIへ渡すため、リンク先を開かなくても内容を要約できます。

**設計上こだわった点**

- 構成要素を全てGoogle Apps Script + 無料/低コストのSaaS(LINE、Dify)で完結させ、サーバー運用コストをゼロにした
- ユーザーが確認してから保存する「保存する/保存しない」の1クッションを挟み、意図しない情報の蓄積を防止した
- URL取得機能ではSSRF(Server-Side Request Forgery)対策を実装し、外部入力を扱うWebアプリとしての安全性を意識した設計にした

## 機能

- LINEへ文章を送ると、AIが自動で「タイトル」「要約」「カテゴリ」「タグ」を生成
- LINEへURLを送ると、GAS側でページ本文を取得・抽出したうえでAIが要約(リンク先を開かず内容を把握できる)
- 生成結果を確認後、「保存する」でGoogleスプレッドシートへ1行追加、「保存しない」で破棄
- 保存待ちデータはLINEユーザーごとに分離・24時間で自動失効
- 同一Webhookイベントの重複処理を防止(LINEプラットフォームからのリトライ対策)
- SSRF対策(プライベートIP・localhost・非HTTPスキーム・IPアドレス偽装表記等の拒否)を実装したURL取得処理

## デモ・スクリーンショット

<!--
  ここに実際の利用画面のスクリーンショットを挿入してください。
  例:
  ### 文章を送って要約を保存する例
  ![文章の要約と保存](./docs/screenshots/text-summary.png)

  ### URLを送って記事本文を要約する例
  ![URL記事の要約と保存](./docs/screenshots/url-summary.png)

  ### 保存されたGoogleスプレッドシートの例
  ![スプレッドシート保存結果](./docs/screenshots/spreadsheet.png)
-->

## 使用技術

| 分類 | 技術 |
|---|---|
| メッセージングプラットフォーム | LINE Messaging API |
| AI / ワークフロー | Dify Workflow API(blockingモード) |
| 実行環境 | Google Apps Script(GAS, V8ランタイム) |
| データストア | Google スプレッドシート、PropertiesService(一時データ・設定値) |
| 言語 | JavaScript(GAS) |

## システム構成

```
LINEユーザー
   │ 文章 or URL
   ▼
LINE Messaging API ──Webhook──▶ doPost(e) [Code.gs]
                                     │
                                     ├─ 重複イベント判定 (CacheService)
                                     ├─ URL / テキスト 判定
                                     │
                                     ├─ URLの場合 → Webページ取得・本文抽出 [WebContentService.gs]
                                     │              (SSRF対策/失敗時はここでエラー返信して終了)
                                     ▼
                              Dify Workflow API (blocking) [DifyService.gs]
                                     │ outputs: display_text/title/summary/category/tags
                                     ▼
                        display_textのみLINEへ返信 [LineService.gs]
                        title等は保存待ちデータとして一時保存 [StateService.gs]
                                     │
              ユーザーが「保存する」/「保存しない」を送信
                                     ▼
                 保存 → スプレッドシートへ追記 [SheetService.gs] → 保存待ちデータ削除
                 保存しない → 保存待ちデータ削除のみ
```

## ファイル構成

| ファイル | 役割 |
|---|---|
| `Code.gs` | `doPost(e)` エントリポイント。イベント振り分け、重複防止、URL判定 |
| `Config.gs` | Script Propertiesの読み込み、定数・定型文言の定義 |
| `LineService.gs` | LINEへの返信送信、署名検証ロジック(現状未使用。理由は後述) |
| `DifyService.gs` | Dify Workflow API(blocking)の呼び出しとoutputsの取り出し |
| `SheetService.gs` | Googleスプレッドシートへの保存処理 |
| `StateService.gs` | PropertiesServiceを使った保存待ちデータのCRUDと有効期限管理 |
| `WebContentService.gs` | URL送信時のWebページ取得・本文抽出・SSRF対策 |
| `README.md` | 本ドキュメント |

## セットアップ方法

### 1. Dify側の設定

1. Difyで **Workflow** タイプのアプリを新規作成する。
2. 開始ノードの入力変数に `content`(文字列、必須)を追加する。
   - 通常の文章の場合、`content` にはユーザーが送信した文章がそのまま入る。
   - URLの場合、`content` にはURLそのものではなく、GAS側で取得・抽出した記事本文を含む以下の形式の文字列が入る。

     ```
     元URL:
     https://example.com/article

     記事本文:
     (抽出された本文プレーンテキスト、最大20,000文字)
     ```

   - Dify側のプロンプトは、`content` が上記のような「元URL: / 記事本文:」形式で始まる場合は記事本文を、そうでない場合は文章そのものを要約対象として扱うよう設計する。
3. LLM等のノードで、入力された内容から以下を生成するフローを組む。
   - `title`: タイトル(文字列)
   - `summary`: 要約(文字列)
   - `category`: カテゴリ(文字列)
   - `tags`: タグ(配列、またはカンマ区切り文字列でも可)
   - `display_text`: 上記4項目を人間が読みやすい形にまとめたLINE返信用テキスト
4. 終了ノードの出力変数として `display_text` / `title` / `summary` / `category` / `tags` の5つを設定する。
5. 「アクセスAPI」からWorkflow用のAPIキーを発行する。
6. APIのベースURLを確認する(SaaS版は `https://api.dify.ai/v1/workflows/run`)。

### 2. Googleスプレッドシートの準備

1. 新しいGoogleスプレッドシートを作成する。
2. シート名を `保存データ` にする。
3. 列構成(1行目にヘッダーを設定する)。

   | A | B | C | D | E | F | G | H | I | J |
   |---|---|---|---|---|---|---|---|---|---|
   | ID | 保存日時 | タイトル | 要約 | カテゴリ | タグ | 入力タイプ | 元URL | 元テキスト | ステータス |

4. スプレッドシートのURLからIDを控える。

### 3. GASプロジェクトの作成とScript Propertiesの設定

1. [https://script.google.com](https://script.google.com) で新規プロジェクトを作成し、本リポジトリの `.gs` ファイルをそれぞれ同名のファイルとしてコピーする。
2. GASエディタで「プロジェクトの設定」→「スクリプト プロパティ」から、以下を登録する(**コードへの直書きは絶対に行わない**)。

   | キー | 値 |
   |---|---|
   | `LINE_CHANNEL_SECRET` | LINE Developersの「チャネル基本設定」に表示されるChannel secret |
   | `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developersの「Messaging API設定」で発行するChannel access token |
   | `DIFY_API_KEY` | Difyで発行したWorkflow用APIキー |
   | `DIFY_API_URL` | `https://api.dify.ai/v1/workflows/run` |
   | `SPREADSHEET_ID` | 保存先スプレッドシートのID |
   | `SHEET_NAME` | `保存データ` |

### 4. Webアプリとしてデプロイ

1. 「デプロイ」→「新しいデプロイ」→種類「ウェブアプリ」を選択する。
2. 「次のユーザーとして実行」は **自分**、「アクセスできるユーザー」は **全員** を選択する(LINEサーバーからの匿名POSTを受け付けるため)。
3. デプロイし、発行された **ウェブアプリのURL** を控える。
4. コード変更時は「デプロイを管理」→編集→「新バージョン」で再デプロイする(URLは維持される)。

### 5. LINE Webhookの設定

1. [LINE Developers](https://developers.line.biz/) の「Messaging API設定」タブでWebhook URLに上記URLを設定する。
2. 「Webhookの利用」をオンにする。
3. 「検証」で200 OKが返ることを確認する。
4. 「応答メッセージ」はオフにする。

### 6. 動作確認

1. 通常の文章を送信 → AIによる要約が返信される → 「保存する」でスプレッドシートに保存されることを確認する。
2. 記事URLを送信 → 本文取得・要約が行われることを確認する。
3. ログイン必須ページやPDFのURLを送信 → 「この記事の本文を取得できませんでした。本文をコピーして送ってください。」と返ることを確認する。
4. 「保存しない」「保存待ちなしでの保存する/保存しない送信」など、異常系の応答も確認する。

## セキュリティ設計・既知の制限

外部入力(LINEユーザーが送信するURL)をサーバーサイドで取得する機能があるため、SSRF対策を実装しています。

- `localhost`、プライベートIP範囲(`10.0.0.0/8` `172.16.0.0/12` `192.168.0.0/16` `169.254.0.0/16` `127.0.0.0/8` `0.0.0.0/8`)、`http`/`https` 以外のスキーム、認証情報付きURL、IPv6ブラケット表記、10進数一括/8進数風/16進数などの非標準IPv4表記によるアクセスを拒否
- authority部分の `userinfo@host` は「最後の `@`」で分割し、複数`@`を用いた偽装(`http://@evil.com@127.0.0.1/`等)も検出
- リダイレクトは最大5回まで手動追跡し、各ホップで再度安全性を検証

一方で、以下は既知の制限として残しています(自前実装であることを踏まえた優先度判断)。

- DNSリバインディング(名前解決結果が後からプライベートIPに変化する攻撃)には未対応
- Google Apps ScriptのdoPost(e)はHTTPリクエストヘッダーを取得できない仕様のため、LINEのWebhook署名(`X-Line-Signature`)検証は実行不可能(Google公式が対応しない旨を表明している既知の制約。デプロイURLの秘匿で緩和)
- 正規表現ベースの簡易HTML解析であり、完全なHTMLパーサーではない
- Shift-JIS等、文字コードが正しく通知されないページは文字化けの可能性がある

## 想定エラーと対処方法

| 事象 | 想定原因 | 対処 |
|---|---|---|
| Webhook検証で200が返らない | デプロイ設定の「アクセスできるユーザー」が「全員」になっていない | デプロイ設定を確認し、URLを再設定する |
| LINEに何も返信されない | アクセストークンが誤っている、Dify呼び出しが失敗している | Loggerのログを確認する |
| URLの本文取得に失敗する | Bot判定でブロックされている、ログイン必須ページ、SSRF対策で拒否対象のURL等 | Loggerに記録された `WebContentService.gs` 内のログを確認する |
| 保存されない | シート名/IDの不一致、権限不足 | `SHEET_NAME`・`SPREADSHEET_ID`・実行アカウントの権限を確認する |

## 今後の改善予定

- [ ] GASの前段にCloudflare Workers等のプロキシを設置し、LINE Webhookの署名検証を実現する
- [ ] 保存済みナレッジをLINEから検索・一覧表示できるコマンドの追加
- [ ] カテゴリ・タグを手動で編集できるフローの追加
- [ ] GAS向けのユニットテスト整備(現状はロジック部分をNode.js上で単体テストする運用)
- [ ] 複数ユーザー/チームでの共有スプレッドシート運用への対応
- [ ] DNSリバインディング対策の強化(プロキシ経由での事前DNS解決等)

## ライセンス

MIT License(必要に応じて `LICENSE` ファイルを追加してください)
