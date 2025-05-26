#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EvaluateStudentsStack } from '../lib/cdk-stack';

const app = new cdk.App();
new EvaluateStudentsStack(app, 'EvaluateStudentsStack', {
  /* 環境設定を有効化することで、特定のAWSアカウントとリージョンにデプロイできます */
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  
  /* スタックの説明を追加 */
  description: '学校生徒の評価を行うためのBedrockエージェント基盤',
});
