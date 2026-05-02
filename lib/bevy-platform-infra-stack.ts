import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';

// 1. 設定値をオブジェクトにまとめる（マジックナンバーの排除）
const STORAGE_CONFIG = {
  RETENTION_DAYS: 30,
  HISTORY_RETENTION_DAYS: 7,
  BUCKET_PREFIX: 'bevy-artifacts',
} as const;

export class BevyPlatformInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 実行時に -c env=prod と渡せる
    const envName = this.node.tryGetContext('env') || 'dev';

    const artifactBucket = new s3.Bucket(this, 'BevyArtifactBucket', {
      // 環境名とアカウントIDを組み合わせて一意性を担保
      bucketName: `${STORAGE_CONFIG.BUCKET_PREFIX}-${envName}-${this.account}`,
      
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,

      lifecycleRules: [
        {
          id: 'ExpireOldBuilds',
          enabled: true,
          // 定数を使用
          expiration: cdk.Duration.days(STORAGE_CONFIG.RETENTION_DAYS),
          noncurrentVersionExpiration: cdk.Duration.days(STORAGE_CONFIG.HISTORY_RETENTION_DAYS),
        }
      ],
    });

    new cdk.CfnOutput(this, 'BucketNameExport', {
      value: artifactBucket.bucketName,
    });
  }
}