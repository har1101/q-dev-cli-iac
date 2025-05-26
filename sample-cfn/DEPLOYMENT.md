# 学生評価システム デプロイガイド

このドキュメントでは、学生評価システムのデプロイ方法と使用方法について説明します。

## システム概要

このシステムは以下のコンポーネントで構成されています：

1. **Streamlitフロントエンド**: 教師が学生の評価を閲覧・編集するためのウェブインターフェース
2. **API Gateway + Lambda**: フロントエンドとDynamoDBを接続するRESTful API
3. **DynamoDB**: 学生評価データを保存するデータベース
4. **Bedrock Agent**: 学生の活動データから自動評価を生成するAIエージェント

## デプロイ手順

### 1. AWSリソースのデプロイ

CloudFormationテンプレートを使用して、必要なAWSリソースをデプロイします。

```bash
# AWS CLIを使用してCloudFormationスタックをデプロイ
aws cloudformation create-stack \
  --stack-name students-evaluation-system \
  --template-body file://cloudformation-template.yaml \
  --capabilities CAPABILITY_IAM \
  --parameters ParameterKey=Environment,ParameterValue=prod

# スタックの作成状況を確認
aws cloudformation describe-stacks --stack-name students-evaluation-system
```

### 2. APIエンドポイントの取得

CloudFormationスタックがデプロイ完了したら、APIエンドポイントを取得します。

```bash
# APIエンドポイントを取得
aws cloudformation describe-stacks \
  --stack-name students-evaluation-system \
  --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
  --output text
```

### 3. Streamlitアプリケーションの設定

1. 必要なPythonパッケージをインストールします。

```bash
pip install streamlit boto3 requests
```

2. `streamlit.py`ファイル内のAPIエンドポイントを、CloudFormationから取得したエンドポイントに更新します。

```python
# streamlit.py内の以下の行を更新
st.session_state.api_endpoint = "https://[YOUR_API_ID].execute-api.[YOUR_REGION].amazonaws.com/prod"
```

### 4. Streamlitアプリケーションの起動

```bash
streamlit run streamlit.py
```

## 使用方法

### 学生評価データの閲覧

1. Streamlitアプリケーションを開きます（デフォルトでは http://localhost:8501 ）
2. サイドバーでAWS認証情報を設定します（プロファイルまたはアクセスキー）
3. 左側のフォームで出席番号と期間（年月）を入力します
4. 「評価データを取得」ボタンをクリックします
5. 右側のパネルに学生の評価データが表示されます

### 教師による評価の編集

1. 学生の評価データを取得した後、「教師による評価」セクションで評価内容を編集します
2. 「評価を保存」ボタンをクリックして変更を保存します

## セキュリティに関する注意事項

- 本番環境では、API GatewayにCognitoまたはIAM認証を追加することを推奨します
- AWS認証情報は安全に管理し、アプリケーションコード内にハードコードしないでください
- 必要に応じて、DynamoDBテーブルの暗号化を有効にしてください

## トラブルシューティング

### APIエラー

- APIエンドポイントが正しく設定されていることを確認してください
- AWS認証情報が有効であることを確認してください
- CloudWatchログでLambda関数のエラーを確認してください

### データが表示されない

- 指定した出席番号と期間のデータがDynamoDBに存在することを確認してください
- DynamoDBテーブルのアクセス権限を確認してください

### Streamlitアプリケーションのエラー

- 必要なPythonパッケージがすべてインストールされていることを確認してください
- コンソールログでエラーメッセージを確認してください
