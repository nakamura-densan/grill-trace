---
name: grill-trace
description: grilling Skillが構成した意思決定の質問をHTML質問票として提示し、質問・推奨回答・ユーザー回答をround単位の証跡として保存し、確定事項を後工程向けdecisions.jsonへ整理するときに使用する。1議題につきユーザー指定の証跡フォルダを使い、同じ議題の複数roundを継続して記録する。質問内容・順序・推奨回答・完了判定はgrillingに従い、Grill Traceは可視化、回答保存、証跡管理、確定事項の記録を担当する。
---

# Grill Trace

> Extends Matt Pocock's `grilling` skill (MIT License): https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling

`grilling` が構成する質問をHTMLで提示し、意思決定の詳細証跡と後工程向け確定事項を保存する。

## リソース

- 質問ロジック: `grilling` Skill
- データ形式: `references/trace-schema.md`
- HTMLテンプレート: `assets/questionnaire-template.html`
- HTML生成: `scripts/build-questionnaire.mjs`
- サーバー起動: `scripts/start-questionnaire.mjs`
- サーバー本体: `scripts/serve-questionnaire.mjs`
- サーバー停止: `scripts/stop-questionnaire.mjs`
- 実行環境: `references/environment-setup.md`

依存SkillとGrill Trace自身のリソースは、実行環境で解決されたSkillの場所を使用する。

## ユーザーとのやり取り

証跡フォルダ名が未指定の場合は、利用可能なら構造化されたユーザー質問・回答ツールを使い、なければチャットでフォルダ名を確認する。

`grilling` が構成した質問、選択肢、推奨回答、追加round、共有理解の最終確認はすべてHTML質問票で提示する。

HTML生成後は質問票URLと、回答保存後に「回答しました」と伝える案内を返す。

## 証跡フォルダ

1議題につきユーザー指定のフォルダを使用する。

```text
.agents/grilling/<folder-name>/
├─ questionnaire.html
├─ trace.json
├─ decisions.json
└─ rounds/
   ├─ 001.json
   ├─ 002.json
   └─ ...
```

同じ議題では同じフォルダを継続利用する。既存フォルダを利用するときは `trace.json` の議題を確認する。

## ワークフロー

### 1. 状態を準備する

新規議題では `references/trace-schema.md` に従って `trace.json`、`decisions.json`、`rounds/` を作成する。

`decisions.json.context` には開始時点の議題について、後工程に必要な概要、目的、スコープ、制約を簡潔に保存する。

継続議題では `trace.json` と `decisions.json` から現在状態を復元する。詳細証跡が必要な場合だけ関連する `rounds/<id>.json` を読む。

### 2. grillingでroundを構成する

`grilling` Skillに従ってdesign treeとfrontierを計算する。現在のfrontier全体を1つのroundとして `rounds/<id>.json` に保存し、`trace.json` のround索引と現在roundを更新する。

現在のfrontier全体を1つのroundに含める。前の回答に依存する意思決定は次のroundで扱う。

各質問は `single` または `multiple` とし、必ず2つ以上の選択肢と推奨回答を持たせる。選択肢には `isOther: true` の「その他」を必ず1つ含める。各質問には選択肢と独立した自由記述欄を常時表示し、通常回答への補足にも「その他」の具体化にも使用できるようにする。「その他」を選択した場合は自由記述を必須とする。question IDはtrace内で安定させる。

### 3. HTML質問票を提供する

Grill Trace Skillの `scripts/build-questionnaire.mjs` と `assets/questionnaire-template.html` を使って `questionnaire.html` を生成する。

端末実行が可能なら `scripts/start-questionnaire.mjs --dir <証跡フォルダ>` を実行し、出力された `http://127.0.0.1:<port>/` をユーザーへ提示する。

質問票は現在のroundを表示し、過去roundの回答も参照・修正できるようにする。

### 4. 回答を反映する

ユーザーが「回答しました」と伝えたら現在roundを読み、回答を `grilling` へ戻す。

`grilling` が確定した内容を `decisions.json.decisions` に簡潔に記録し、各decisionに元の `roundId` と `questionId` を付ける。議題の前提理解が更新された場合は `decisions.json.context` も更新する。

`trace.json` のround statusと更新日時を反映し、`grilling` が完了するまで手順2〜4を繰り返す。

### 5. 完了する

frontierが空になったら、`grilling` の共有理解確認を最終roundとしてHTMLに提示する。

ユーザーが確定したら次を行う。

- `trace.json` を完了状態に更新する。
- `decisions.json` の完了日時を更新する。
- `questionnaire.html` を再生成する。
- 起動中の質問票サーバーを停止する。

## 後工程での利用

設計、実装、API Issue、アーキテクチャ図などの後工程では `decisions.json` の `context` と `decisions` を最初に読む。詳細な根拠が必要な場合だけ、decisionの `source` が示す `rounds/<id>.json` を読む。
