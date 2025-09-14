import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { EventBridgeDiscovery } from '@toldyaonce/kx-event-consumers';

export interface NotificationsStackProps extends cdk.StackProps {
  /**
   * Environment name (e.g., 'dev', 'staging', 'prod')
   * Used for resource naming and tagging
   */
  environment?: string;
  
  /**
   * Optional cross-account role ARN for the notifier to assume
   * Enables cross-account EventBridge → WebSocket notifications
   */
  assumeRoleArn?: string;

  // Note: Lambda warming removed - using provisioned concurrency instead
}

/**
 * KxGen Notifications Stack
 * 
 * Provides real-time WebSocket notifications for EventBridge events.
 * When events fire (scans, payments, user actions, etc.), connected
 * clients receive instant notifications via WebSocket push.
 * 
 * Architecture:
 * - EventBridge → Notifier Lambda → WebSocket API → Connected Clients
 * - DynamoDB tracks active WebSocket connections per tenant
 * - API Gateway WebSocket API handles connection lifecycle
 * - Cross-account ready with assume role support
 */
export class NotificationsStack extends cdk.Stack {
  public readonly webSocketApi: apigatewayv2.WebSocketApi;
  public readonly connectionsTable: dynamodb.Table;
  public readonly notifierFunction: NodejsFunction;
  
  constructor(scope: Construct, id: string, props?: NotificationsStackProps) {
    super(scope, id, props);
    
    const env = props?.environment || 'dev';
    
    // =============================================================================
    // DynamoDB Connections Table
    // =============================================================================
    
    this.connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      tableName: `kxgen-${env}-connections`,
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN for production
      pointInTimeRecovery: true,
    });
    
    // Add tags to the table
    cdk.Tags.of(this.connectionsTable).add('App', 'KxGen');
    cdk.Tags.of(this.connectionsTable).add('Scope', 'Realtime');
    cdk.Tags.of(this.connectionsTable).add('Stack', 'Notifications');
    cdk.Tags.of(this.connectionsTable).add('Environment', env);
    
    // =============================================================================
    // WebSocket API Gateway
    // =============================================================================
    
    // WebSocket Lambda Handlers
    const onConnectFunction = new NodejsFunction(this, 'OnConnectFunction', {
      entry: 'src/ws/on-connect.ts',
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      bundling: {
        forceDockerBundling: false,
        externalModules: ['aws-sdk'],
      },
      environment: {
        CONNECTIONS_TABLE: this.connectionsTable.tableName,
        NODE_ENV: 'production',
      },
    });
    
    const onDisconnectFunction = new NodejsFunction(this, 'OnDisconnectFunction', {
      entry: 'src/ws/on-disconnect.ts',
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      bundling: {
        forceDockerBundling: false,
        externalModules: ['aws-sdk'],
      },
      environment: {
        CONNECTIONS_TABLE: this.connectionsTable.tableName,
        NODE_ENV: 'production',
      },
    });
    
    const onMessageFunction = new NodejsFunction(this, 'OnMessageFunction', {
      entry: 'src/ws/on-message.ts',
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      bundling: {
        forceDockerBundling: false,
        externalModules: ['aws-sdk'],
      },
      environment: {
        CONNECTIONS_TABLE: this.connectionsTable.tableName,
        NODE_ENV: 'production',
      },
    });
    
    // Grant DynamoDB permissions
    this.connectionsTable.grantWriteData(onConnectFunction);
    this.connectionsTable.grantWriteData(onDisconnectFunction);
    this.connectionsTable.grantReadData(onMessageFunction);
    
    // WebSocket API
    this.webSocketApi = new apigatewayv2.WebSocketApi(this, 'WebSocketApi', {
      apiName: `kxgen-${env}-notifications-ws`,
      description: 'KxGen Real-time Notifications WebSocket API',
      connectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('ConnectIntegration', onConnectFunction),
      },
      disconnectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('DisconnectIntegration', onDisconnectFunction),
      },
      defaultRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('DefaultIntegration', onMessageFunction),
      },
    });
    
    // WebSocket Stage
    const webSocketStage = new apigatewayv2.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi: this.webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });
    
    // =============================================================================
    // EventBridge Integration
    // =============================================================================
    
    // Import EventBridge from KxGenStack
    const kxEventBridge = EventBridgeDiscovery.importEventBridgeFromStack(
      this, 'KxEventBridge', 'KxGenStack'
    );
    
    // Create Dead Letter Queue for failed notifications
    const notifierDLQ = new sqs.Queue(this, 'NotifierDLQ', {
      queueName: `kxgen-${env}-notifier-dlq`,
      retentionPeriod: cdk.Duration.days(14), // Keep failed events for 2 weeks
    });

    // Notifier Lambda (EventBridge → WebSocket)
    // Optimized for cold start performance
    this.notifierFunction = new NodejsFunction(this, 'NotifierFunction', {
      entry: 'src/notifier/notifier.ts',
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(30), // Reasonable timeout
      memorySize: 1769, // 1.75GB - sweet spot for Lambda performance/cost
      // Removed reservedConcurrentExecutions - conflicts with provisioned concurrency
      deadLetterQueue: notifierDLQ, // Add DLQ directly in constructor
      bundling: {
        forceDockerBundling: false,
        externalModules: ['aws-sdk'],
        minify: true, // Reduce bundle size
        sourceMap: false, // Disable source maps for faster startup
      },
      environment: {
        CONNECTIONS_TABLE: this.connectionsTable.tableName,
        WEBSOCKET_API_ID: this.webSocketApi.apiId,
        WEBSOCKET_STAGE: webSocketStage.stageName,
        ASSUME_ROLE_ARN: props?.assumeRoleArn || '',
        NODE_ENV: 'production',
        // Optimize AWS SDK behavior
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },
    });

    // Note: Provisioned concurrency removed for now - focusing on cold start optimization
    // The real issue is likely the 5-6 second Lambda initialization time
    
    // Grant permissions to Notifier
    this.connectionsTable.grantReadData(this.notifierFunction);
    
    // Grant WebSocket management permissions
    this.notifierFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.apiId}/*`,
      ],
    }));
    
    // Note: Using direct EventBridge → Lambda for better provisioned concurrency support

    // EventBridge Rule → Lambda (direct, with provisioned concurrency)
    new events.Rule(this, 'NotificationsRealtimeRule', {
      eventBus: kxEventBridge,
      ruleName: `kxgen-notifications-realtime`,
      description: 'Route notification events directly to Lambda',
      eventPattern: {
        source: ['kx-event-tracking'],
        // Match ALL detail types for debugging - remove this filter temporarily
        // detailType: [
        //   'qr.get',
        //   'qr.scanned', 
        //   'qr.created',
        //   'notification.sent',
        //   'notification.delivered',
        // ],
      },
      targets: [new targets.LambdaFunction(this.notifierFunction, {
        deadLetterQueue: notifierDLQ, // DLQ for failed invocations
        retryAttempts: 2, // Retry failed invocations
        maxEventAge: cdk.Duration.minutes(5), // Don't retry old events
      })],
    });

    // Note: Lambda warming rule removed - using provisioned concurrency instead
    // Provisioned concurrency is more reliable and cost-effective for consistent workloads
    
    // =============================================================================
    // SSM Parameters (for discovery by other stacks)
    // =============================================================================
    
    const wsPublicUrl = `wss://${this.webSocketApi.apiId}.execute-api.${this.region}.amazonaws.com/${webSocketStage.stageName}`;
    const wsMgmtEndpoint = `https://${this.webSocketApi.apiId}.execute-api.${this.region}.amazonaws.com/${webSocketStage.stageName}`;
    
    new ssm.StringParameter(this, 'WsPublicWssParam', {
      parameterName: '/kxgen/ws/public-wss',
      stringValue: wsPublicUrl,
      description: 'Public WebSocket URL for client connections',
    });
    
    new ssm.StringParameter(this, 'WsMgmtEndpointParam', {
      parameterName: '/kxgen/ws/management-endpoint',
      stringValue: wsMgmtEndpoint,
      description: 'WebSocket management API endpoint',
    });
    
    new ssm.StringParameter(this, 'ConnectionsTableParam', {
      parameterName: '/kxgen/ws/connections-table',
      stringValue: this.connectionsTable.tableName,
      description: 'DynamoDB connections table name',
    });
    
    // =============================================================================
    // Stack Outputs
    // =============================================================================
    
    new cdk.CfnOutput(this, 'WsPublicWss', {
      value: wsPublicUrl,
      description: 'Public WebSocket URL for client connections',
      exportName: `${this.stackName}-WsPublicWss`,
    });
    
    new cdk.CfnOutput(this, 'WsMgmtEndpoint', {
      value: wsMgmtEndpoint,
      description: 'WebSocket management API endpoint',
      exportName: `${this.stackName}-WsMgmtEndpoint`,
    });
    
    new cdk.CfnOutput(this, 'ConnectionsTableName', {
      value: this.connectionsTable.tableName,
      description: 'DynamoDB connections table name',
      exportName: `${this.stackName}-ConnectionsTableName`,
    });
    
    new cdk.CfnOutput(this, 'NotifierFunctionName', {
      value: this.notifierFunction.functionName,
      description: 'Notifier Lambda function name',
      exportName: `${this.stackName}-NotifierFunctionName`,
    });
    
    new cdk.CfnOutput(this, 'RealtimeRuleArn', {
      value: `arn:aws:events:${this.region}:${this.account}:rule/${kxEventBridge.eventBusName}/kxgen-${env}-notifications-realtime`,
      description: 'EventBridge realtime notifications rule ARN',
      exportName: `${this.stackName}-RealtimeRuleArn`,
    });
  }
}