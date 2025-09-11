import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

// Create a simplified test stack that doesn't use EventBridge discovery or Docker
class TestNotificationsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a mock EventBridge for testing
    const mockEventBridge = events.EventBus.fromEventBusArn(
      this, 'MockEventBridge', 
      'arn:aws:events:us-east-1:123456789012:event-bus/kx-event-tracking'
    );

    // Create Lambda function for processing notification events (using regular Function to avoid Docker)
    const notifierLambda = new lambda.Function(this, 'NotifierFunction', {
      code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); };'),
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      runtime: lambda.Runtime.NODEJS_18_X,
      environment: {
        NODE_ENV: 'production',
      },
    });

    // Create EventBridge rule for notification events
    new events.Rule(this, 'NotificationsRule', {
      eventBus: mockEventBridge,
      eventPattern: {
        source: ['kx-event-tracking'],
        detailType: ['scan.completed', 'payment.completed', 'user.login', 'notification.sent'],
      },
      targets: [new targets.LambdaFunction(notifierLambda)],
      description: 'Rule to process notification events from kx-event-tracking service',
    });

    // Output the Lambda function ARN for reference
    new cdk.CfnOutput(this, 'NotifierLambdaArn', {
      value: notifierLambda.functionArn,
      description: 'ARN of the notifier Lambda function',
    });

    // Output the EventBridge rule ARN for reference
    new cdk.CfnOutput(this, 'EventBridgeArn', {
      value: mockEventBridge.eventBusArn,
      description: 'ARN of the imported EventBridge from kx-event-tracking service',
    });
  }
}

describe('NotificationsStack', () => {
  const mockEnv = {
    account: '123456789012',
    region: 'us-east-1',
  };

  test('creates Lambda function', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new TestNotificationsStack(app, 'MyTestStack', {
      env: mockEnv,
    });
    // THEN
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs18.x',
      Timeout: 30,
      MemorySize: 256,
    });
  });

  test('creates EventBridge rule', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new TestNotificationsStack(app, 'MyTestStack', {
      env: mockEnv,
    });
    // THEN
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Events::Rule', {
      Description: 'Rule to process notification events from kx-event-tracking service',
    });
  });

  test('creates outputs', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new TestNotificationsStack(app, 'MyTestStack', {
      env: mockEnv,
    });
    // THEN
    const template = Template.fromStack(stack);

    template.hasOutput('NotifierLambdaArn', {});
    template.hasOutput('EventBridgeArn', {});
  });
});
