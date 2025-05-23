import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as scheduler_targets from 'aws-cdk-lib/aws-scheduler-targets';
import { TimeZone } from 'aws-cdk-lib';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // パラメータ定義
    const environment = new cdk.CfnParameter(this, 'Environment', {
      type: 'String',
      default: 'prod',
      description: '環境名（開発/本番）'
    });

    // DynamoDBテーブル
    const studentsEvaluationTable = new dynamodb.Table(this, 'StudentsEvaluationTable', {
      tableName: 'students-evaluation-by-q',
      partitionKey: { name: 'students_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'period', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // SNSトピック（エージェント完了通知用）
    const finishAgentMailTopic = new sns.Topic(this, 'FinishAgentMailTopic', {
      topicName: 'finish-agent-mail-by-q',
    });

    // API Gateway + Lambda用のロール
    const apiLambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // DynamoDBアクセス権限を追加
    apiLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:UpdateItem'],
      resources: [studentsEvaluationTable.tableArn],
    }));

    // API Gateway統合Lambda関数
    const apiFunction = new lambda.Function(this, 'EvaluationApiFunction', {
      functionName: `students-evaluation-api-${environment.valueAsString}-by-q`,
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromInline(`
import json
import os
import boto3
from datetime import datetime

def lambda_handler(event, context):
    """
    API Gateway経由でDynamoDBのデータを取得・更新するLambda関数
    """
    try:
        # 環境変数からテーブル名を取得
        table_name = os.environ['TABLE_NAME']
        dynamodb = boto3.resource('dynamodb')
        table = dynamodb.Table(table_name)
        
        # HTTPメソッドに応じた処理
        http_method = event['httpMethod']
        
        if http_method == 'GET':
            # クエリパラメータからstudents_idとperiodを取得
            query_params = event.get('queryStringParameters', {}) or {}
            students_id = query_params.get('students_id')
            period = query_params.get('period')
            
            if not students_id or not period:
                return {
                    'statusCode': 400,
                    'body': json.dumps({'message': 'students_id and period are required'})
                }
            
            # DynamoDBからデータを取得
            response = table.get_item(
                Key={
                    'students_id': students_id,
                    'period': period
                }
            )
            
            item = response.get('Item', {})
            return {
                'statusCode': 200,
                'body': json.dumps(item)
            }
            
        elif http_method == 'PUT':
            # リクエストボディからデータを取得
            body = json.loads(event['body'])
            students_id = body.get('students_id')
            period = body.get('period')
            achievements = body.get('achievements', [])
            
            if not students_id or not period or not achievements:
                return {
                    'statusCode': 400,
                    'body': json.dumps({'message': 'students_id, period, and achievements are required'})
                }
            
            # 現在の日時を取得
            current_time = datetime.now().isoformat()
            
            # DynamoDBにデータを保存
            table.put_item(
                Item={
                    'students_id': students_id,
                    'period': period,
                    'achievements': achievements,
                    'updated_at': current_time
                }
            )
            
            return {
                'statusCode': 200,
                'body': json.dumps({'message': 'Data saved successfully'})
            }
        
        else:
            return {
                'statusCode': 405,
                'body': json.dumps({'message': 'Method not allowed'})
            }
            
    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'message': f'Internal server error: {str(e)}'})
        }
      `),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      role: apiLambdaRole,
      environment: {
        TABLE_NAME: studentsEvaluationTable.tableName,
      },
    });

    // 環境変数の値を取得（非トークン形式）
    const envValue = environment.valueAsString;
    
    // API Gateway
    const api = new apigateway.RestApi(this, 'EvaluationApi', {
      restApiName: `students-evaluation-api-${envValue}-by-q`,
      description: '学生評価システム用API',
      // デプロイオプションを削除し、明示的なデプロイを使用
    });
    
    // 明示的にデプロイとステージを作成
    const deployment = new apigateway.Deployment(this, 'Deployment', {
      api,
    });
    
    const stage = new apigateway.Stage(this, 'ApiStage', {
      deployment,
      stageName: envValue,
    });
    
    // デフォルトステージをカスタムステージに設定
    api.deploymentStage = stage;

    // API Gatewayリソースとメソッド
    const evaluationResource = api.root.addResource('evaluation');
    evaluationResource.addMethod('GET', new apigateway.LambdaIntegration(apiFunction));
    evaluationResource.addMethod('PUT', new apigateway.LambdaIntegration(apiFunction));

    // Bedrock Agent用のロール
    const bedrockAgentRole = new iam.Role(this, 'BedrockAgentRole', {
      roleName: 'AmazonBedrockExecutionRoleForAgents-by-q',
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com', {
        conditions: {
          StringEquals: {
            'aws:SourceAccount': this.account,
          },
          ArnLike: {
            'aws:SourceArn': `arn:aws:bedrock:${this.region}:${this.account}:agent/*`,
          },
        },
      }),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLambda_FullAccess'),
      ],
    });

    // DynamoDBからデータを取得するLambda関数用のロール
    const getDynamoDbRole = new iam.Role(this, 'GetDynamoDbRole', {
      roleName: 'get-data-from-dynamodb-role-by-q',
      path: '/service-role/',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBReadOnlyAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // DynamoDBからデータを取得するLambda関数
    const getDynamoDbFunction = new lambda.Function(this, 'GetDataFromDynamoDb', {
      functionName: 'get-data-from-dynamodb-by-q',
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'lambda_function.lambda_handler',
      code: lambda.Code.fromInline(`
import logging
import json
import boto3
from typing import Dict, Any, List
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

`),
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      role: getDynamoDbRole,
    });
    
    // Bedrock Agent - 正しいCfnAgentクラスを使用
    const bedrockAgent = new bedrock.CfnAgent(this, 'BedrockAgent', {
      agentName: 'evaluate-students-agent-by-q',
      agentResourceRoleArn: bedrockAgentRole.roleArn,
      description: '生徒の成績を評価するAIエージェント',
      foundationModel: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
      instruction: 'あなたは生徒たちの成績を評価する教師エージェントです。定められた評価基準にしたがって、生徒たちの成績をつけていきます。\n\n1. データを取得する\n- ユーザーからタスクを依頼された時、まずはアクショングループ「get-students-data」のLambda関数を用いて、DynamoDBからデータを取得します。\n- 取得したデータは、以下の評価基準にしたがって、成績を評価する際に使用します。\n\n2. 以下の評価基準にしたがって、成績を評価する。その際、根拠も同時に作成してください。\n-  知識・理解\n  - 国語: 読解力、作文能力、漢字の理解と使用、語彙力\n  - 算数: 計算スキル、図形理解、問題解決能力、数学的思考\n  - 理科: 科学的概念の理解、観察力、実験への取り組み\n  - 社会: 地理・歴史の基礎知識、社会の仕組みの理解\n  - 英語: 基本的な単語理解、簡単な会話表現\n- 思考力・判断力・表現力\n  - 問題に対する論理的思考能力\n  - 自分の考えを適切に表現する能力\n  - 創造的な解決策を考える力\n  - グループ活動での意見交換能力\n- 主体性\n  - 授業への積極的な参加度\n  - 宿題の完成度と提出状況\n  - 自主学習への取り組み\n  - 学習の継続性と集中力\n\n3. 作成した評価をユーザーへ返してください。',
      idleSessionTtlInSeconds: 600,
      // アクショングループを定義
      actionGroups: [
        {
          actionGroupName: 'get-students-data',
          description: '評価対象となる生徒の情報をDynamoDBから取得するためのアクショングループです',
          actionGroupState: 'ENABLED',
          actionGroupExecutor: {
            lambda: getDynamoDbFunction.functionArn
          },
          functionSchema: {
            functions: [
              {
                name: 'get-data-from-dynamodb',
                description: '評価対象となる生徒の情報をDynamoDBから取得する関数です。',
                parameters: {
                  students_id: {
                    type: 'string',
                    description: '出席番号',
                    required: true
                  },
                  period: {
                    type: 'string',
                    description: 'データを取得する対象期間',
                    required: true
                  }
                },
                requireConfirmation: 'DISABLED'
              }
            ]
          }
        }
      ]
    });

    // Bedrock Agent Alias
    const bedrockAgentAlias = new bedrock.CfnAgentAlias(this, 'BedrockAgentAlias', {
      agentId: bedrockAgent.attrAgentId,
      agentAliasName: 'v1'
      // 注：routingConfigurationは指定しません。
      // エイリアス作成時に自動的に初期バージョン（バージョン1）が作成されます
    });

    // エージェント呼び出し用Lambda関数のロール
    const callAgentRole = new iam.Role(this, 'CallAgentRole', {
      roleName: 'call-agent-function-role-by-q',
      path: '/service-role/',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSNSFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // エージェント呼び出し用Lambda関数
    const callAgentFunction = new lambda.Function(this, 'CallAgentFunction', {
      functionName: 'call-agent-function-by-q',
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'lambda_function.lambda_handler',
      code: lambda.Code.fromInline(`
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
        period = event.get('period', '202504')
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
`),
      timeout: cdk.Duration.seconds(300),
      memorySize: 1024,
      role: callAgentRole,
      environment: {
        AGENT_ID: bedrockAgent.attrAgentId,
        AGENT_ALIAS_ID: bedrockAgentAlias.attrAgentAliasId,
        SNS_TOPIC_ARN: finishAgentMailTopic.topicArn,
      },
    });

    // EventBridge Scheduler
    const schedule = new scheduler.Schedule(this, 'CallAgentSchedule', {
      scheduleName: 'call-agent-schedule-by-q',
      description: '生徒評価エージェントを定期的に呼び出すスケジュール',
      schedule: scheduler.ScheduleExpression.cron({
        minute: '50',
        hour: '11',
        day: '*',
        month: '*',
        year: '*',
        timeZone: TimeZone.of('Asia/Tokyo')
      }),
      target: new scheduler_targets.LambdaInvoke(callAgentFunction, {
        input: scheduler.ScheduleTargetInput.fromObject({
          students_id: '30000',
          period: '202504'
        }),
        retryAttempts: 0,
        maxEventAge: cdk.Duration.seconds(86400)
      }),
      enabled: true,
      timeWindow: scheduler.TimeWindow.off(),
    });

    // 出力
    new cdk.CfnOutput(this, 'DynamoDBTableName', {
      value: studentsEvaluationTable.tableName,
      description: 'DynamoDBテーブル名',
      exportName: `${this.stackName}-DynamoDBTableName`,
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: stage.urlForPath(),
      description: 'API Gatewayエンドポイント',
      exportName: `${this.stackName}-ApiEndpoint`,
    });
  }
}
