# Grill Trace
Grill Trace は、grilling Skill が構成した意思決定の質問を HTML 質問票として提示し、回答過程を証跡として保存するための Skill です。  
社内共有のために、簡易的に公開しています。

質問内容の設計は grilling が担当し、Grill Trace は次を担当します。  

- grilling の質問を HTML で可視化する
- ユーザー回答を round 単位で保存する
- 質問・選択肢・推奨回答・回答を証跡として残す
- 確定事項を後工程向けの decisions.json に整理する
- 証跡を必要な粒度で段階的に読み込めるよう分離する

## 1. 役割  
Grill Trace は「何を質問するべきか」を独自に決めません。  
```
grilling
   │ design tree / frontier / 質問 / 推奨回答
   ▼
Grill Trace
   │ HTML質問票 + 証跡保存
   ▼
ユーザー
   │ 回答
   ▼
Grill Trace
   │ round証跡 + 確定事項
   ▼
grilling
```

それぞれの責務は次の通りです。  

### grilling
- 議題を理解する
- design tree を構築する
- 現在回答可能な frontier を特定する
- 質問、選択肢、推奨回答を構成する
- 回答から次の frontier を計算する
- grilling が完了したか判断する

### Grill Trace
- grilling が構成した質問を HTML に変換する
- HTML から回答を保存する
- 各 round の詳細証跡を保持する
- 確定した意思決定を decisions.json に整理する
- 議題の進行状態を trace.json で管理する
- ローカル質問票サーバーを起動・停止する

## 2. 基本フロー  
### Step 1: Grill Trace を開始する  
ユーザーが議題を指定して Grill Trace を開始します。  

例:  
ユーザー一括登録機能の要件を Grill Trace で詰めてください。  
証跡フォルダ名は bulk-user-import とします。  
※証跡フォルダ名が指定されていない場合は、Grill Trace がフォルダ名だけを確認します。  

### Step 2: 議題の初期コンテキストを保存する  
開始時点の議題について、後工程に必要な内容を decisions.json に簡潔に保存します。  

### Step 3: grilling が質問を構成する  
grilling Skill が design tree と frontier を計算し、現在回答可能な質問を構成します。  
Grill Trace は、その frontier 全体を1つの round として保存します。  
後続の質問が前の回答に依存するときだけ、次の round に分かれます。  

### Step 4: HTML質問票を生成する  
Grill Trace が questionnaire.html を生成します。  

### Step 5: Node.js ローカルサーバーを起動する  
Grill Trace が質問票用の Node.js サーバーをバックグラウンドで起動します。  
http://127.0.0.1:<port>/  
のような URL が提示されます。  

この URL は利用可能な任意のブラウザまたは Web ビューで開けます。  

### Step 6: HTML上で回答する
ユーザーは HTML 質問票上で回答し、保存します。  
保存後、ユーザーは AI に「回答しました」と伝えます。  

### Step 7: 回答を反映する
Grill Trace は現在の round の回答を読み込みます。  
その回答を grilling に戻し、grilling が次の frontier を計算します。  
grilling が確定した内容を、Grill Trace が後工程で利用しやすい形式に記録して decisions.json を更新します。

次の frontier が存在する場合は、同じ質問票に新しい round を追加して Step 3 以降を繰り返します。  

### Step 8: 最終確認する
すべての frontier が解消されたら、grilling の共有理解確認も最終 round として HTML に表示します。  
ユーザーが確定すると Grill Trace は完了します。  

## 3. 証跡フォルダ
1つの議題につき1つの証跡フォルダを使用します。  
```
.agents/grilling/<folder-name>/
├─ questionnaire.html
├─ trace.json
├─ decisions.json
└─ rounds/
   ├─ 001.json
   ├─ 002.json
   └─ ...
```

同じ議題で複数 round を繰り返す場合は同じフォルダを使用します。  
新しい議題を開始するときは、新しいフォルダ名を指定します。  

## 4. 各ファイルの役割
### questionnaire.html
ユーザーが質問へ回答する画面です。  
HTML 自体に全質問データを埋め込まず、必要な round をローカルサーバーから取得します。  
そのため質問やroundが増えても、常に全証跡を一括ロードする必要はありません。  

### trace.json
議題全体の進行状態と round の索引を保持します。  
主な情報:  
- trace ID
- 議題名
- 証跡フォルダ名
- 進行中 / 完了状態
- 現在の round
- round 一覧
- 開始・更新・完了日時

### rounds/<id>.json
1 round 分の完全な証跡です。  
保存する内容:  
- 質問
- 質問の説明
- 選択肢
- grilling の推奨回答
- ユーザー回答
- 回答日時

「なぜこの仕様になったのか」を確認するときの根拠になります。

### decisions.json
後工程向けの確定情報です。  
主に次を保持します。  
```
context
├─ overview
├─ goals
├─ scope
└─ constraints

decisions
├─ decision
├─ reason（必要な場合）
└─ source
```

source から元の round / question へ辿れるため、必要なときだけ詳細証跡を確認できます。

## 5. ローカルサーバー
### 実行要件
- Node.js 18以上
- npm / pnpm の追加インストール不要
- Node.js 標準ライブラリのみ使用
- Listen アドレス: `127.0.0.1`
- Port: 4173番から空きポートを探索します。

### Idle timeout
質問票を開いている間は /api/presence の SSE 接続を維持します。  
- 質問票が開いている  
→ serverを維持  

- 最後の質問票を閉じる
→ idle timer開始  

- 30分間利用なし
→ server自動停止  

Grill Trace が正常完了した場合は、30分を待たず即時停止します。

## 6. セキュリティ
質問票サーバーはローカル用途を前提に、次の境界を持ちます。  

- 127.0.0.1 のみに listen
- same-origin の API 呼び出し
- JSON request body の上限
- arbitrary path を受け付けない
- directory listing を提供しない
- round 定義をブラウザから変更させない
- JSON 更新時は一時ファイルから atomic rename
- no-store / nosniff 等の基本 security header
- shutdown は対象 trace ID が一致する場合だけ実行

## 7. 詳細仕様
データ構造や環境条件の詳細は次を参照してください。

references/trace-schema.md
references/environment-setup.md

Skill の実行規則は SKILL.md を参照してください。
