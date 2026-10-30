# BLACK SWAN（仮題）

為替×オートバトル。

本物の過去の為替相場を使い、FXで稼いだ資金で部隊を強化してボスを倒す、周回型のブラウザゲーム。

## 初めて動かすとき

1. このフォルダでコマンドプロンプトを開く
2. 相場データを取得する（初回と、通貨を追加したときだけ）
   - `node server.js` で起動し、http://localhost:3000/tools/fetch-rates.html を開いて「取得開始」
   - ダウンロードした `rates.json` を `data` フォルダに置く
   - Nodeから外部に通信できる環境なら `node tools/fetch-rates.js` でも作れる
3. 計算部分のテストを実行する（任意）
   ```
   node tools/test-core.js
   node tools/test-battle.js
   node tools/test-game.js
   ```
4. ローカルサーバーを起動して、ブラウザで http://localhost:3000/ を開く
   ```
   node server.js
   ```
   スマホで確認するときは `set HOST=0.0.0.0&& node server.js`（PowerShellなら `$env:HOST="0.0.0.0"; node server.js`）

URLの末尾に `?seed=abc&start=2008-09-01` を付けると、同じ周回を再現できる。

### 自動テストプレイ（バランス調整）

```
node tools/autoplay.js                 （各戦略40周。数分〜20分ほど）
node tools/autoplay.js --runs 100      （周回数を変える）
node tools/autoplay.js --strategies safe,moderate --runs 20
```

10種類の自動プレイヤー（戦略）が、同じ開始日の組で何周も遊び、`reports/` に分析レポート（HTML）と全周回の記録（JSON）を書き出す。
レポートには、戦略ごとのクリア率、お金の出入り、要素の使われ方（ほぼ使われない・偏り）、開始年ごとのクリア率が載る。
ゲームの終了画面の「記録を書き出す」で保存したJSONを `reports/human/` に置くと、「人のプレイ」として一緒に集計される。
`reports/` は公開に不要なので、GitHubには上げなくてよい。

### 世界地図のデータ（任意）

地図の陸地は Natural Earth（パブリックドメイン）のデータを world-atlas パッケージ経由で使う。
`data/land-110m.json` があればそれを、なければインターネット上（jsDelivr）から読み込む。
公開したゲームがCDNに頼らないよう、次のURLをブラウザで開いて「名前を付けて保存」し、`data/land-110m.json` として置いておくのがおすすめ。

https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json

## フォルダ構成

```
index.html            ゲームの画面（中身は src/ui/）
server.js             ローカル確認用サーバー
package.json          設定（"type": "module" で、import/export 形式を使う）
data/rates.json       相場データ（fetch-rates.js が作る。ゲームに同梱する）
data/land-110m.json   世界地図の陸地データ（任意。なければCDNから読む）
src/config.js         バランス調整用の数値・通貨・都市（調整はここだけ触る）
src/core/             計算部分（画面に依存しない。テストや自動プレイでも使う）
  calendar.js         日付の計算
  rng.js              シード付き乱数
  market.js           相場エンジン（過去データ、日中補間）
  fx-account.js       FX口座（ポジション、証拠金、ロスカット、スワップ、規制）
  settlement.js       現地通貨の自動換算
  clock.js            時間を進める（相場の再生と、注文・ロスカットの判定）
  battle.js           戦闘エンジン（配置、特効、弾の方針、撤退、弾切れ）
  mission-run.js      任務の実行（複数の戦闘を順に行い、体力・弾を持ち越す）
  prediction.js       勝率予測（裏で数百回戦わせて集計。偵察前は幅で出す）
  missions.js         任務の生成（都市ごとの敵の傾向、規模・戦闘の回数・日数はランダム、報酬）
  hints.js            FXの手がかり（記憶の断片、偵察で聞く噂。どちらも相場データから作る）
src/data/
  events.js           記憶の断片のもとになる、実際の出来事（1999〜2026年）
src/game/
  game.js             1周の進行（所持品・部隊・任務・特別任務・雇用・移動・待機・訓練・改造・偵察・出撃・日給・負傷・配当・終了判定）
src/ui/
  app.js              画面の表示と操作（地図・町・部隊・FX口座・出撃準備・出撃・結果）
  charts.js           チャートの描画
  worldmap.js         世界地図（Natural Earth の陸地データを SVG にする）
  style.css           見た目
tools/
  fx-lab.html         FXラボ（相場とFX口座を単独で試す開発用ページ）
  test-game.js        1周の進行の自動テスト
  battle-lab.html     戦闘ラボ（編成・弾を変えて予測と戦闘を確認する開発用ページ）
  test-battle.js      戦闘まわりの自動テスト
  fetch-rates.html    相場データの取得（ブラウザ版）
  fetch-rates.js      相場データの取得（Node版）
  rates-builder.js    上の2つが共通で使う取得・変換の処理
  test-core.js        計算部分の自動テスト
  autoplay.js         自動テストプレイの実行（並列）
  bots.js             自動プレイヤー（戦略）
  report.js           自動プレイの集計と分析レポート
reports/              自動プレイの結果（自動で作られる。公開不要）
docs/実装メモ.md       仕様書にない、実装で決めたこと
docs/引き継ぎ.md       新しいチャットで作業を続けるための引き継ぎ（最初に読む）
```

仕様書にない、実装で決めたことは `docs/実装メモ.md` にまとめている。

## 通貨・都市を増やすには

`src/config.js` の `currencies` と `cities` に追加し、`node tools/fetch-rates.js` を実行し直す。

## データの出典

Frankfurter API（https://frankfurter.dev）経由の、欧州中央銀行（ECB）の参考レート。
