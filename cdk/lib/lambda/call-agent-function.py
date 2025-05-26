import json
import boto3
import uuid
from datetime import datetime
import os
import time

# クライアントの初期化
bedrock_client = boto3.client('bedrock-agent-runtime', region_name='us-east-1')
dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
table = dynamodb.Table('students-evaluation')
# SNSクライアントを初期化
sns = boto3.client('sns', region_name='us-east-1')

def lambda_handler(event, context):
    try:
        print(f"受信したイベント: {json.dumps(event)}")

        # EventBridgeから渡されたペイロードを取得
        students_id = event.get('students_id', '1')
        period = event.get('period', '2025-01')
        # ループ回数を指定（例: 3回）
        loop_count = int(event.get('loop_count', 3))
        # students_idをintに変換
        current_id = int(students_id)
        results = []
        for i in range(loop_count):
            input_text = (f"出席番号: {str(current_id)} の生徒の評価を行ってください。 期間は {period} です。")
            # Bedrock Agentの定義
            agent_id = os.environ['AGENT_ID']
            agent_alias_id = os.environ['AGENT_ALIAS_ID']
            session_id = str(uuid.uuid4())
            
            # Invoke Agent APIを呼び出す
            response = bedrock_client.invoke_agent(
                agentId=agent_id,
                agentAliasId=agent_alias_id,
                sessionId=session_id,
                inputText=input_text,
                enableTrace=True,
                streamingConfigurations={
                    "streamFinalResponse": False
                }
            )

            # レスポンスからテキストを抽出
            # EventStreamを適切に処理
            agent_response = ""
            event_stream = response["completion"]
            
            # EventStreamをループして応答テキストを収集
            for event in event_stream:
                if 'chunk' in event:
                    chunk = event['chunk']
                    if 'bytes' in chunk:
                        # バイナリデータをデコード
                        text = chunk['bytes'].decode('utf-8')
                        agent_response += text
            
            print(f"Bedrock Agentからのレスポンス: {agent_response}")

            # タイムスタンプを生成（ISO形式）- DynamoDBの属性名として使用するために安全に変換
            timestamp = datetime.now().isoformat().replace(':', '_').replace('.', '_')

            # DynamoDBに評価結果を追加
            table.update_item(
                Key={
                    'students_id': str(current_id),
                    'period': period
                },
                UpdateExpression='SET agent_evaluation = :eval, evaluation_date = :date',
                ExpressionAttributeValues={
                    ':eval': agent_response,
                    ':date': timestamp
                }
            )
            results.append({
                'id': str(current_id)
            })
            current_id += 1
            time.sleep(30)
            
        # 処理成功の通知をSNSトピックに送信
        if 'SNS_TOPIC_ARN' in os.environ:
            sns.publish(
                TopicArn=os.environ['SNS_TOPIC_ARN'],
                Subject='生徒評価処理完了通知',
                Message=f'以下の生徒IDの評価処理が正常に完了しました。\n期間: {period}\n処理したID: {[result["id"] for result in results]}'
            )
            
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': '処理が完了しました',
                'results': results
            })
        }

    except Exception as e:
        error_message = f"エラーが発生しました: {e}"
        print(error_message)
        
        # エラー通知をSNSトピックに送信
        if 'SNS_TOPIC_ARN' in os.environ:
            sns.publish(
                TopicArn=os.environ['SNS_TOPIC_ARN'],
                Subject='生徒評価処理エラー通知',
                Message=f'処理中にエラーが発生しました。\n期間: {period}\n開始ID: {students_id}\nエラー: {str(e)}'
            )
            
        return {
            'statusCode': 500,
            'body': json.dumps({
                'message': 'エラーが発生しました',
                'error': str(e)
            })
        }