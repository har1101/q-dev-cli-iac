# 概要

- 学校生徒の評価を行うためのBedrockエージェント基盤
- 学校以外にも展開できるようなものを想定(エンジニアの評価を行うためのもの、など)
- 自身の活動を記録しておき、振り返ることができるようにもしておく
- 評価自体はAmbient Agent的に動かす(スケジュール駆動で動かしておく)

## アーキテクチャ

- フロントエンド
    - Streamlit
- バックエンド・インフラ
    - EventBridge, Lambda, Bedrock Agent, DynamoDB

## 権限分離

- マネージャー用IAMロールとエンジニア用IAMロールで権限や使用可能ツールを分離する
- マネージャー用は参照のみ、ただし自身の部下や生徒は全メンバー分を参照可能
- エンジニア用は参照・書き込み可能、ただし自分の分のみ操作可能

## 動作イメージ

- データ保存
    - Streamlitでデータ格納用画面を作成しておき、Lambda→DynamoDBでデータを格納する
    - 年単位の目標も入力しておけるようにする
    - 番号(社員番号や出席番号)、日付、達成したことを記録しておく
- 評価実施
    - Streamlitで番号、年月を入力してBedrock Agentを呼び出し
    - Toolsを用いてDynamoDBにクエリを送信し、該当データを取得
    - そのデータを表示し、かつそれらの活動と目標の達成度合いなどを比較してAIエージェントが評価を行う

## セキュリティ設定

- ユーザー認証
    - マネージャーとエンジニア/生徒ユーザーのグループを作成し、適切なIAMロールを割り当てる
- IAM権限
    - マネージャー用IAMロール: 読み取り専用権限 + 部下/生徒のデータ参照権限
    - エンジニア/生徒用IAMロール: 自分のデータの読み書き権限
    - Bedrock Agent用IAMロール: 
        - bedrock:InvokeInlineAgent
        - bedrock:InvokeModel (指定モデルへのアクセス)
        - DynamoDBへの読み取り権限

## ツールと技術スタック

- Amazon Bedrock Agent
    - Claude 3.5 Sonnet v2を使用
    - アクショングループでLambdaを作成
- AWS Lambda
    - データ保存処理用関数
    - データ検索処理用関数(Bedrockエージェントのアクショングループ)
- Amazon DynamoDB
    - テーブル：students-evaluation
    - パーティションキー: students_id(出席番号)、ソートキー: period(検索対象期間)
- Streamlit
    - シンプルで使いやすいUI
    - AWS認証情報による安全なAPI呼び出し

# デプロイ方法

## インフラのデプロイ

AWS CDKを用いてAWS環境へデプロイします。
git cloneした後で、ターミナル上で以下コマンドを実行します。

```bash
$ cd cdk
$ cdk deploy
```

作成されたDynamoDBテーブルに、適当な生徒情報を入れます。

```bash
aws dynamodb put-item 
    --table-name students-evaluation-by-q 
    --item '{
        "students_id": {"S": "10000"},
        "period": {"S": "202504"},
        "subjects": {
            "M": {
                "japanese": {
                    "M": {
                        "score": {"S": "85"},
                        "reading_comprehension": {"S": "4"},
                        "writing": {"S": "4"},
                        "kanji": {"S": "3"},
                        "vocabulary": {"S": "4"},
                        "comments": {"S": "読解力が特に優れています。作文も論理的に書けています。"}
                    }
                },
                "math": {
                    "M": {
                        "score": {"S": "90"},
                        "calculation": {"S": "5"},
                        "geometry": {"S": "4"},
                        "problem_solving": {"S": "4"},
    }'
    --return-consumed-capacity TOTAL授業に参加し、特に算数では計算問題に意欲的に取り組んでいます。漢字の書き取りはやや苦手ですが、練習に励んでいます。クラスでの協調性も高く、友達思いな面が見られます。"},
```

## Streamlitアプリケーションの設定

1. 必要なPythonパッケージをインストールします。

```bash
$ pip install streamlit boto3 requests
```

2. `streamlit.py`ファイル内のAPIエンドポイントを、CloudFormationから取得したエンドポイントに更新します。

```python
# streamlit.py内の以下の行を更新
st.session_state.api_endpoint = "https://[YOUR_API_ID].execute-api.[YOUR_REGION].amazonaws.com/prod"
```

3. Streamlitアプリケーションの起動

```bash
$ streamlit run streamlit.py
```
