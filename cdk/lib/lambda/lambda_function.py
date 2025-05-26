import logging
import json
import boto3
from typing import Dict, Any
from http import HTTPStatus
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# DynamoDBクライアントの初期化
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('students-evaluation')

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    AWS Lambda handler for processing Bedrock agent requests.
    
    Args:
        event (Dict[str, Any]): The Lambda event containing action details
        context (Any): The Lambda context object
    
    Returns:
        Dict[str, Any]: Response containing the action execution results
    
    Raises:
        KeyError: If required fields are missing from the event
    """
    try:
        action_group = event['actionGroup']
        function = event['function']
        message_version = event.get('messageVersion', 1)
        parameters = event.get('parameters', [])

        # 関数に基づいて適切な処理を実行
        response_body = {}
        
        if function == 'get-data-from-dynamodb':
            # パラメータから学生IDと期間を取得
            students_id = next((param['value'] for param in parameters if param['name'] == 'students_id'), None)
            period = next((param['value'] for param in parameters if param['name'] == 'period'), None)
            
            if not students_id or not period:
                response_body = {
                    'TEXT': {
                        'body': '学生IDと期間の両方が必要です。'
                    }
                }
            else:
                # DynamoDBからデータを取得
                evaluation_data = get_student_evaluation(students_id, period)
                response_body = {
                    'TEXT': {
                        'body': json.dumps(evaluation_data, ensure_ascii=False)
                    }
                }
        else:
            response_body = {
                'TEXT': {
                    'body': f'関数 {function} は実装されていません。'
                }
            }

        action_response = {
            'actionGroup': action_group,
            'function': function,
            'functionResponse': {
                'responseBody': response_body
            }
        }
        
        response = {
            'response': action_response,
            'messageVersion': message_version
        }

        logger.info('Response: %s', response)
        return response

    except KeyError as e:
        logger.error('Missing required field: %s', str(e))
        return {
            'statusCode': HTTPStatus.BAD_REQUEST,
            'body': f'Error: {str(e)}'
        }
    except Exception as e:
        logger.error('Unexpected error: %s', str(e))
        return {
            'statusCode': HTTPStatus.INTERNAL_SERVER_ERROR,
            'body': 'Internal server error'
        }

def get_student_evaluation(students_id: str, period: str) -> Dict[str, Any]:
    """
    DynamoDBから特定の学生IDと期間に関連するデータを取得します。
    
    Args:
        students_id (str): 学生ID（出席番号や社員番号）
        period (str): 検索対象期間（年月など）
    
    Returns:
        Dict[str, Any]: 取得した評価データ
    
    Raises:
        ClientError: DynamoDBへのクエリ実行中にエラーが発生した場合
    """
    try:
        logger.info(f"学生ID: {students_id}, 期間: {period} のデータを検索中")
        
        # DynamoDBのクエリパラメータを設定
        response = table.query(
            KeyConditionExpression='students_id = :sid AND period = :p',
            ExpressionAttributeValues={
                ':sid': students_id,
                ':p': period
            }
        )
        
        items = response.get('Items', [])
        logger.info(f"検索結果: {len(items)}件のデータが見つかりました")
        
        if not items:
            return {"message": "指定された学生IDと期間のデータは見つかりませんでした。"}
        
        return {
            "students_id": students_id,
            "period": period,
            "data": items
        }
        
    except ClientError as e:
        logger.error(f"DynamoDBクエリエラー: {e.response['Error']['Message']}")
        raise
