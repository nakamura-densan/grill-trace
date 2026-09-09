# Grill Trace data schema

証跡は用途別に分離する。

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

## trace.json

議題全体の進行状態とround索引を保持する。

```json
{
  "version": 1,
  "traceId": "api-issue-post-users",
  "title": "POST /users API仕様",
  "evidenceFolder": "ユーザー登録API",
  "createdAt": "2026-09-09T00:00:00.000Z",
  "updatedAt": "2026-09-09T00:30:00.000Z",
  "completedAt": null,
  "status": "in_progress",
  "currentRoundId": "002",
  "rounds": [
    {
      "id": "001",
      "order": 1,
      "title": "基本仕様",
      "status": "answered",
      "file": "rounds/001.json"
    },
    {
      "id": "002",
      "order": 2,
      "title": "重複処理",
      "status": "pending",
      "file": "rounds/002.json"
    }
  ]
}
```

- `status`: `in_progress` | `completed`
- `currentRoundId`: 現在回答するround。完了時は `null`
- `rounds[].file`: 証跡フォルダからの相対パス

## rounds/<id>.json

1 round分の質問と回答を完全な証跡として保持する。

```json
{
  "version": 1,
  "traceId": "api-issue-post-users",
  "roundId": "002",
  "order": 2,
  "title": "重複処理",
  "description": "重複登録時の外部仕様を確認する。",
  "createdAt": "2026-09-09T00:20:00.000Z",
  "updatedAt": "2026-09-09T00:30:00.000Z",
  "questions": [
    {
      "id": "duplicate-status",
      "type": "single",
      "title": "重複時のHTTPステータスは？",
      "description": "同一ユーザーが既に存在する場合のレスポンスを決める。",
      "recommendation": "409 Conflictを推奨する。リソース競合を明示できるため。",
      "required": true,
      "options": [
        {
          "id": "409",
          "label": "409 Conflict",
          "description": "リソース競合として扱う。",
          "recommended": true
        },
        {
          "id": "400",
          "label": "400 Bad Request",
          "description": "入力不正として扱う。",
          "recommended": false
        },
        {
          "id": "other",
          "label": "その他",
          "description": "既定候補以外を自由記述する。",
          "recommended": false,
          "isOther": true
        }
      ],
      "response": {
        "selected": ["409"],
        "selectedLabels": ["409 Conflict"],
        "freeText": "このAPIでは既存クライアントとの互換性も考慮する。"
      },
      "answeredAt": "2026-09-09T00:30:00.000Z"
    }
  ]
}
```

### Question

- `id`: trace内で一意かつ安定したID
- `type`: `single` | `multiple`
- `title`: 質問タイトル
- `description`: 判断に必要な説明
- `recommendation`: grillingの推奨回答
- `required`: 必須回答か
- `options`: 2つ以上の選択肢。`isOther: true` の「その他」を必ず1つ含める
- `response`: 未回答は `null`
- `answeredAt`: 最終回答保存日時。未回答は `null`

### Response

```json
{
  "selected": ["409"],
  "selectedLabels": ["409 Conflict"],
  "freeText": ""
}
```

- `selected`: 選択したoption ID
- `selectedLabels`: 選択内容の表示名
- `freeText`: 自由記述。通常回答への補足にも「その他」の具体化にも使用する。「その他」を選択した場合は必須

## decisions.json

後工程向けの議題コンテキストと確定事項を保持する。

```json
{
  "version": 1,
  "traceId": "api-issue-post-users",
  "title": "POST /users API仕様",
  "updatedAt": "2026-09-09T00:32:00.000Z",
  "completedAt": null,
  "context": {
    "overview": "ユーザー登録APIの外部仕様を確定する。",
    "goals": ["OpenAPIを作成できる粒度まで仕様を確定する。"],
    "scope": ["POST /users の入力・認証認可・正常系・エラー系"],
    "constraints": ["既存の認証方式とレスポンス規約に従う。"]
  },
  "decisions": [
    {
      "id": "duplicate-status",
      "decision": "重複登録時は409 Conflictを返す。",
      "reason": "既存リソースとの競合として扱うため。",
      "source": {
        "roundId": "002",
        "questionId": "duplicate-status"
      }
    }
  ]
}
```

- `context.overview`: 議題概要
- `context.goals`: 目的
- `context.scope`: 対象範囲
- `context.constraints`: 制約
- `decisions[].id`: 安定した意思決定ID。原則として元question ID
- `decision`: 後工程で利用する確定事項
- `reason`: 判断理由。必要な場合のみ
- `source`: 元のround/question参照

## Progressive loading

後工程は `decisions.json` を先に読み、詳細な根拠が必要なdecisionだけ `source.roundId` の `rounds/<id>.json` を読む。
