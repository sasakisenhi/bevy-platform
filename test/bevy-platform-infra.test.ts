import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { BevyPlatformInfraStack } from '../lib/bevy-platform-infra-stack';

describe('BevyPlatformInfraStack', () => {
	test('creates S3 bucket and GitHub Actions role with branch-scoped trust', () => {
		const app = new cdk.App({
			context: {
				env: 'test',
				githubOwner: 'octo-org',
				githubRepo: 'bevy-platform-infra',
				githubBranch: 'main',
			},
		});

		const stack = new BevyPlatformInfraStack(app, 'MyTestStack', {
			env: { account: '123456789012', region: 'ap-northeast-1' },
		});

		const template = Template.fromStack(stack);

		template.resourceCountIs('AWS::S3::Bucket', 1);

		template.hasResourceProperties('AWS::IAM::Role', {
			AssumeRolePolicyDocument: {
				Statement: Match.arrayWith([
					Match.objectLike({
						Action: 'sts:AssumeRoleWithWebIdentity',
						Condition: {
							StringEquals: {
								'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
							},
							StringLike: {
								'token.actions.githubusercontent.com:sub': 'repo:octo-org/bevy-platform-infra:ref:refs/heads/main',
							},
						},
					}),
				]),
			},
		});

		template.hasOutput('GithubActionsRoleArn', {});
	});
});
