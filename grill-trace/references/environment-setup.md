# Questionnaire runtime environment

質問票はNode.jsローカルサーバーで配信する。起動後のloopback URLは、利用可能なブラウザまたはWebビューで開く。

## Runtime

- Node.js 18以上
- npm/pnpm追加依存なし
- Node.js標準ライブラリで動作
- listen: `127.0.0.1`
- port: 4173番から空きポートを探索
- start scriptはserverをバックグラウンド起動し、URLを返して終了
- server状態はプロセス内、診断ログは標準出力で扱う

Remote SSH / WSL / Dev Containerなど、serverとブラウザの実行環境が異なる場合はport forwardingまたはlocalhost proxyを利用する。

## Server lifecycle

start scriptは既定port範囲の `/api/health` を確認し、同じ `traceId` のserverがあれば再利用する。なければ空きportで起動する。

stop scriptは同じ範囲から対象 `traceId` のserverを探し、`/api/shutdown` で停止する。

質問票は `/api/presence` へSSE接続する。SSE接続がある間はserverを維持し、最後の接続が閉じてから30分利用がなければ自動停止する。Grill Trace完了時はstop scriptで停止する。

## Server security

- same-origin API
- JSON request body上限: 1MB、shutdown: 4KB
- roundの回答部分をブラウザ更新対象とする
- round IDは `trace.json` の索引から解決
- JSON更新はtemp file + rename
- directory listingなし
- responseはno-storeと基本security headerを使用
- shutdownはloopback上で対象 `traceId` が一致する場合に実行

## Terminal approval

AIがGrill Traceのstart/stop scriptを実行できる承認設定を使用する。自動承認を設定する場合は専用scriptへ対象を限定する。

## Troubleshooting

起動障害の詳細確認が必要な場合は `scripts/serve-questionnaire.mjs --dir <証跡フォルダ> --port 4173` をforegroundで実行し、標準出力を確認する。

主な確認箇所:

- `EACCES` / `EPERM`: Workspace Trust、sandbox、EDR、AppLocker
- URLを開けない: loopback通信、port forwarding、proxy、ブラウザ/組織ポリシー
- serverを起動できない: Node.js実行・localhost listenに関する組織ポリシー
