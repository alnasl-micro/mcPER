# mcPER

**日本語** | [English](#mcper-english)

Fiat / Lancia / Alfa Romeo / Abarth の純正部品カタログである ePER の v84 に登録された内容を AI に調べてもらうための MCP サーバーです。Claude Desktop、Claude Code、Cursor、VS Code（GitHub Copilot）などの MCP に対応したアプリから使うことができます。

例えば、VIN（車台番号）を伝えて「この車のリアのショックアブソーバーの部品番号は？」と頼むことで、AI に次の作業を依頼できます。

- VIN から、車の仕様（グレード、製造日、エンジン、オプション）を割り出す
- その仕様に**合う部品だけ**を選ぶ。年式や仕様ごとの細かい切り替えも、ePER と同じルールで判定する
- 部品番号が新しい番号に置き換わっている場合は、その**変遷**を辿る
- 部品図を表示し、該当する部品の番号を**赤枠で囲んで**場所を示す

ePER の画面を開いて図を探す手間がなくなります。

> **非公式のツールです。** mcPER は Stellantis（Fiat Chrysler Automobiles）とは関係がなく、承認や支援も受けていません。Fiat、Lancia、Alfa Romeo、Abarth、ePER は各社の商標です。このリポジトリには ePER のデータは含まれていません。データを生成するには、ePER v84 をインストールした Windows PC が必要です。

## 必要なもの

- MCP に対応したアプリ（このページでは Claude Desktop を例に説明します）
- Node.js 22.13 以上
- データを準備するとき: ePER v84 をインストールした Windows PC

データを一度作ってしまえば、ePER は不要です。データのディレクトリをコピーすることで、ePER を入れていない PC や Mac でも使えます。

## 準備

### 1. データを生成する

ePER のある Windows で一度だけ実施する必要があります。

このディレクトリでコマンドプロンプトなどを開き、次を実行します。

```sh
npm install
npm run build-data
```

数分で `data/pack` ディレクトリが生成されます。ディレクトリの中身は部品カタログ、VIN データ、部品図で、約 5GB です。説明文は日本語と英語だけを入れています。

ePER を既定以外の場所にインストールしている場合は、`EPER_DIR` でインストール先を指定します。

### 2. Claude Desktop に登録する

Claude Desktop の設定ファイルに次を追加します。

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcper": {
      "command": "node",
      "args": ["--no-warnings", "C:\\path\\to\\mcPER\\src\\index.js"]
    }
  }
}
```

`args` の2つ目には、このディレクトリの `src\index.js` の場所を書きます（Mac なら `/path/to/mcPER/src/index.js` の形）。Claude Desktop が `node` を見つけられない場合は、`command` に node のフルパス（例: `C:\\Program Files\\nodejs\\node.exe`、`/opt/homebrew/bin/node`）を書いてください。

保存したら、Claude Desktop を**完全に終了**してから起動し直します。ウィンドウを閉じるだけでは足りないので、タスクトレイのアイコンから「Quit」を選んでください。チャット欄のツール一覧に「mcper」が出ていれば準備完了です。

### ほかのアプリに登録する

どのアプリでも、登録する中身は同じです。起動コマンドは `node`、引数は `--no-warnings` と `src/index.js` の場所の2つです。

- **Claude Code**: 次のコマンドで登録できます。

  ```sh
  claude mcp add mcper -- node --no-warnings /path/to/mcPER/src/index.js
  ```

- **Cursor、VS Code など**: 各アプリの MCP 設定ファイルに、上の Claude Desktop の例と同じ `command` と `args` を書きこみます。

部品図を表示する機能は、アプリがツールの結果に入った画像を表示できる場合だけ使用できます。

### ほかの PC や Mac などで使う

1. Node.js を入れる（Mac なら `brew install node` など）
2. このディレクトリをコピーして `npm install` を実行する
3. `data/pack` も、外付けディスクなどでコピーする
4. 上と同じように、使うアプリに登録する

`data/pack` をこのディレクトリの外に置いた場合は、設定に `"env": { "MCPER_DATA_DIR": "/path/to/pack" }` のように場所を書き足してください。

## 使い方

登録したアプリで、普通に話しかけます。

- 「VIN ZFA19800004275255 の車の情報を教えて」
- 「この車のフロントブレーキパッドの部品番号と、その変遷を調べて。図で場所も見せて」
- 「バルケッタのリアサスペンションの部品図を見せて」
- 「部品番号 4449309 は何に置き換わった？」

初めてツールを使うときは、アプリが実行してよいかを確認されます。

## 知っておいてほしいこと

- **データは 2014 年時点のものです。** それ以降の部品番号の置き換えは含まれていません。
- **在庫や注文できるかどうかは分かりません。** 2014 年当時の在庫情報は今は役に立たないので、あえて出していません。注文できるかは販売店で確かめてください。
- ePER の日本語の部品名は短い表記です（例: ブレーキパッド → 「パッド・セット」）。見つからないときは、AI が英語などで探し直します。
- 価格は扱っていません。

## 困ったとき

- **ツール一覧に mcper が表示されない**: 設定ファイルのパスと JSON の書き方を確認し、アプリを完全に終了してから起動し直してください。Claude Desktop の場合、エラーの内容は `%APPDATA%\Claude\logs\mcp-server-mcper.log`（Mac は `~/Library/Logs/Claude/`）に表示されます
- **「database not found」と出る**: `npm run build-data` を実行していないか、`data/pack` の場所が異なります
- **動作を確かめたい**: `npm test` と `npm run check-eper` を実行すると、ePER の表示結果と一致するかを検証できます

## ライセンス

プログラムのコードは [MIT License](LICENSE) です。データの読み方と適合判定のロジックは [openPER](https://github.com/OldBoyCoder/openPER)（MIT License、Copyright (c) 2023 Christopher Reynolds）から移植しているため、その著作権表示も LICENSE に含めています。

このライセンスはプログラムだけに適用されます。ePER のデータ（`data/pack` の中身を含む）には適用されず、その著作権は Fiat 側にあります。

---

# mcPER (English)

[日本語](#mcper) | **English**

mcPER is an MCP server that lets an AI look up the contents of ePER v84, the genuine parts catalogue for Fiat / Lancia / Alfa Romeo / Abarth. It works with any MCP-compatible app, such as Claude Desktop, Claude Code, Cursor and VS Code (GitHub Copilot).

For example, give the AI a VIN and ask "What is the part number of the rear shock absorber for this car?". It can then:

- Work out the vehicle's specification (version, build date, engine, options) from the VIN
- Pick **only the parts that fit** that specification, applying the same rules as ePER, including cut-overs by build date and specification
- Follow the **supersession history** when a part number has been replaced by a newer one
- Show the parts drawing with the reference numbers of the relevant parts **framed in red**

No more opening ePER and hunting through drawings.

> **This is an unofficial tool.** mcPER is not affiliated with, endorsed by or supported by Stellantis (Fiat Chrysler Automobiles). Fiat, Lancia, Alfa Romeo, Abarth and ePER are trademarks of their respective owners. This repository does not contain any ePER data. Generating the data requires a Windows PC with ePER v84 installed.

## Requirements

- An MCP-compatible app (this page uses Claude Desktop as the example)
- Node.js 22.13 or later
- For preparing the data only: a Windows PC with ePER v84 installed

Once the data has been generated, ePER is no longer needed. Copy the data directory and mcPER also works on PCs and Macs without ePER.

## Setup

### 1. Generate the data

This needs to be done once, on the Windows PC with ePER.

Open a command prompt in this directory and run:

```sh
npm install
npm run build-data
```

After a few minutes the `data/pack` directory is created. It contains the parts catalogue, the VIN data and the parts drawings, about 5 GB in total. Descriptions are included in Japanese and English only.

If ePER is installed somewhere other than the default location, set `EPER_DIR` to the installation directory.

### 2. Register with Claude Desktop

Add the following to the Claude Desktop configuration file:

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcper": {
      "command": "node",
      "args": ["--no-warnings", "C:\\path\\to\\mcPER\\src\\index.js"]
    }
  }
}
```

The second item in `args` is the path to `src\index.js` in this directory (on a Mac, something like `/path/to/mcPER/src/index.js`). If Claude Desktop cannot find `node`, put the full path to node in `command` (e.g. `C:\\Program Files\\nodejs\\node.exe` or `/opt/homebrew/bin/node`).

After saving, **quit Claude Desktop completely** and start it again. Closing the window is not enough: choose "Quit" from the tray icon. When "mcper" appears in the chat's tool list, you are ready.

### Registering with other apps

The registration is the same in every app: the command is `node`, and the two arguments are `--no-warnings` and the path to `src/index.js`.

- **Claude Code**: register with this command:

  ```sh
  claude mcp add mcper -- node --no-warnings /path/to/mcPER/src/index.js
  ```

- **Cursor, VS Code, etc.**: write the same `command` and `args` as in the Claude Desktop example into the app's MCP configuration file.

Drawings can only be shown if the app can display images included in tool results.

### Using it on another PC or a Mac

1. Install Node.js (on a Mac, e.g. `brew install node`)
2. Copy this directory and run `npm install`
3. Copy `data/pack` as well, e.g. with an external drive
4. Register it with your app as described above

If you put `data/pack` outside this directory, add its location to the configuration, e.g. `"env": { "MCPER_DATA_DIR": "/path/to/pack" }`.

## Usage

Just talk to the app you registered it with:

- "Tell me about the car with VIN ZFA19800004275255"
- "Find the part number of the front brake pads for this car and its supersession history. Show me where it is on the drawing."
- "Show me the rear suspension drawing for the Barchetta"
- "What replaced part number 4449309?"

The first time a tool is used, the app asks for permission to run it.

## Good to know

- **The data is from 2014.** Supersessions after that are not included.
- **Availability is unknown.** The 2014 stock information is of no use today, so it is deliberately left out. Check with a dealer whether a part can be ordered.
- Japanese part names in ePER are terse (e.g. brake pads → "パッド・セット"). If nothing is found, the AI retries in English or with other words.
- Prices are not covered.

## Troubleshooting

- **mcper does not appear in the tool list**: check the path in the configuration file and the JSON syntax, then quit the app completely and start it again. For Claude Desktop, errors are logged to `%APPDATA%\Claude\logs\mcp-server-mcper.log` (on a Mac, `~/Library/Logs/Claude/`)
- **"database not found"**: `npm run build-data` has not been run, or `data/pack` is in a different location
- **Checking that it works**: run `npm test` and `npm run check-eper` to verify the results against what ePER displays

## License

The program code is under the [MIT License](LICENSE). The data access and fitment logic is ported from [openPER](https://github.com/OldBoyCoder/openPER) (MIT License, Copyright (c) 2023 Christopher Reynolds), so its copyright notice is included in LICENSE as well.

This license applies to the program only. It does not apply to ePER data (including the contents of `data/pack`), which is copyrighted by Fiat.
