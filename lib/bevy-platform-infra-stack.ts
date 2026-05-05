import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';

// 設定値をオブジェクトにまとめる（マジックナンバーの排除）
const STORAGE_CONFIG = {
  RETENTION_DAYS: 30,
  HISTORY_RETENTION_DAYS: 7,
  BUCKET_PREFIX: 'bevy-artifacts',
} as const;
//GitHub OIDCの設定も定数オブジェクトにまとめる
const GITHUB_OIDC_CONFIG = {
  PROVIDER_URL: 'https://token.actions.githubusercontent.com',
  CLIENT_ID: 'sts.amazonaws.com',
  THUMBPRINT: '6938fd4d98bab03faadb97b34396831e3780a188',
  DEFAULT_BRANCH: 'main',
  PLACEHOLDER_OWNER: '<github-owner>',
  PLACEHOLDER_REPO: '<github-repo>',
} as const;

export class BevyPlatformInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 実行時に -c env=prod と渡せる
    const envName = this.node.tryGetContext('env') || 'dev';
    // GitHub OIDCの設定をコンテキストから取得（プレースホルダーも用意）
    const githubOwner = this.node.tryGetContext('githubOwner') || GITHUB_OIDC_CONFIG.PLACEHOLDER_OWNER;
    const githubRepo = this.node.tryGetContext('githubRepo') || GITHUB_OIDC_CONFIG.PLACEHOLDER_REPO;
    const githubBranch = this.node.tryGetContext('githubBranch') || GITHUB_OIDC_CONFIG.DEFAULT_BRANCH;
    const githubOidcProviderArn = this.node.tryGetContext('githubOidcProviderArn');
    const githubSub = `repo:${githubOwner}/${githubRepo}:ref:refs/heads/${githubBranch}`;

    // GitHub OIDCの設定がプレースホルダーのままの場合は警告を出す
    if (
      githubOwner === GITHUB_OIDC_CONFIG.PLACEHOLDER_OWNER ||
      githubRepo === GITHUB_OIDC_CONFIG.PLACEHOLDER_REPO
    ) {
      cdk.Annotations.of(this).addWarning(
        'GitHub OIDC trust is using placeholders. Pass -c githubOwner=<owner> -c githubRepo=<repo> and optionally -c githubBranch=<branch> before deployment.',
      );
    }

    const artifactBucket = new s3.Bucket(this, 'BevyArtifactBucket', {
      // 環境名とアカウントIDを組み合わせて一意性を担保
      bucketName: `${STORAGE_CONFIG.BUCKET_PREFIX}-${envName}-${this.account}`,
      
      // セキュリティ強化のための設定を追加
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      // S3マネージド暗号化を有効にして、保存データを暗号化する
      encryption: s3.BucketEncryption.S3_MANAGED,
      // バージョニングを有効にして、誤って削除されたオブジェクトの復元を可能にする
      versioned: true,
      // スタック削除時にバケットも削除する設定（本番環境では注意が必要）
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // バケット削除時にオブジェクトも削除する設定（本番環境では注意が必要）
      autoDeleteObjects: true,

      /* そのほか追加可能な設定
          ・アクセスログの設定
          ・特定のリージョンにレプリケーションする設定
          ・ライフサイクルルールで特定のプレフィックスやタグに基づいてオブジェクトを管理する設定
          ・アクセスコントロールリスト（ACL）やバケットポリシーで細かいアクセス制御を設定することも可能
          など
          詳しくは下記のURLを参照 
          https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3.BucketProps.html
       */

      // ライフサイクルルールを追加して古いオブジェクトを自動的に削除
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
    // GitHub Actions用のIAMロールを作成（ブランチスコープの信頼関係を設定）

    const githubProvider = githubOidcProviderArn
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          'GithubProvider',
          githubOidcProviderArn,
        )
    // OIDCプロバイダーが指定されていない場合は新規作成
      : new iam.OpenIdConnectProvider(this, 'GithubProvider', {
          url: GITHUB_OIDC_CONFIG.PROVIDER_URL,
          clientIds: [GITHUB_OIDC_CONFIG.CLIENT_ID],
          thumbprints: [GITHUB_OIDC_CONFIG.THUMBPRINT],
        });
    // GitHub Actionsが特定のリポジトリとブランチからのみロールを引き受けられるようにする
    const githubRole = new iam.Role(this, 'GithubActionsRole', {
      assumedBy: new iam.WebIdentityPrincipal(
        githubProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': GITHUB_OIDC_CONFIG.CLIENT_ID,
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': githubSub,
          },
        },
      ),
      description: 'Role assumed by GitHub Actions for artifact bucket access',
    });

    artifactBucket.grantReadWrite(githubRole);

    new cdk.CfnOutput(this, 'BucketNameExport', {
      value: artifactBucket.bucketName,
    });
    // GitHub ActionsロールのARNを出力

    new cdk.CfnOutput(this, 'GithubActionsRoleArn', {
      value: githubRole.roleArn,
    });
  }
}