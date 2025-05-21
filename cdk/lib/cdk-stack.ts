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
import json
import boto3
from boto3.dynamodb.conditions import Key

def lambda_handler(event, context):
    """
    Bedrock Agentのアクショングループから呼び出されるLambda関数
    DynamoDBから生徒の評価データを取得する
    """
    try:
        # イベントからパラメータを取得
        students_id = event.get('students_id')
        period = event.get('period')
        
        if not students_id or not period:
            return {
                'statusCode': 400,
                'message': 'students_id and period are required',
                'data': None
            }
        
        # DynamoDBからデータを取得
        dynamodb = boto3.resource('dynamodb')
        table = dynamodb.Table('students-evaluation-by-q')
        
        response = table.get_item(
            Key={
                'students_id': students_id,
                'period': period
            }
        )
        
        item = response.get('Item')
        
        if not item:
            return {
                'statusCode': 404,
                'message': f'No data found for student {students_id} in period {period}',
                'data': None
            }
        
        return {
            'statusCode': 200,
            'message': 'Data retrieved successfully',
            'data': item
        }
        
    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'message': f'Internal server error: {str(e)}',
            'data': None
        }
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
      instruction: '生徒たちの成績を評価する教師エージェントです。定められた評価基準にしたがって、生徒たちの成績をつけていきます。',
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
import os
import boto3
import time

def lambda_handler(event, context):
    """
    EventBridge Schedulerから定期的に呼び出されるLambda関数
    Bedrock Agentを呼び出して生徒の評価を行う
    """
    try:
        # 環境変数から設定を取得
        agent_id = os.environ['AGENT_ID']
        agent_alias_id = os.environ['AGENT_ALIAS_ID']
        sns_topic_arn = os.environ['SNS_TOPIC_ARN']
        
        # イベントからパラメータを取得
        students_id = event.get('students_id')
        period = event.get('period')
        
        if not students_id or not period:
            raise ValueError("students_id and period are required")
        
        # Bedrock Agentを呼び出す
        bedrock_agent_runtime = boto3.client('bedrock-agent-runtime')
        
        # エージェントに送信するプロンプト
        prompt = f"生徒ID {students_id} の {period} 期間の評価を行ってください。"
        
        # エージェントを呼び出す
        response = bedrock_agent_runtime.invoke_agent(
            agentId=agent_id,
            agentAliasId=agent_alias_id,
            sessionId=f"{students_id}-{period}-{int(time.time())}",
            inputText=prompt
        )
        
        # レスポンスを処理
        completion = ""
        for event in response.get('completion'):
            chunk = event.get('chunk')
            if chunk and 'bytes' in chunk:
                completion += chunk['bytes'].decode('utf-8')
        
        # 評価結果をSNSで通知
        sns = boto3.client('sns')
        sns.publish(
            TopicArn=sns_topic_arn,
            Subject=f"生徒 {students_id} の評価が完了しました",
            Message=f"期間: {period}\\n\\n評価結果:\\n{completion}"
        )
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Agent invocation successful',
                'students_id': students_id,
                'period': period
            })
        }
        
    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'message': f'Error invoking agent: {str(e)}'
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
