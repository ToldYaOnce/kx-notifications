import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
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
    
    // Notifier Lambda (EventBridge → WebSocket)
    this.notifierFunction = new NodejsFunction(this, 'NotifierFunction', {
      entry: 'src/notifier/notifier.ts',
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      bundling: {
        forceDockerBundling: false,
        externalModules: ['aws-sdk'],
      },
      environment: {
        CONNECTIONS_TABLE: this.connectionsTable.tableName,
        WEBSOCKET_API_ID: this.webSocketApi.apiId,
        WEBSOCKET_STAGE: webSocketStage.stageName,
        ASSUME_ROLE_ARN: props?.assumeRoleArn || '',
        NODE_ENV: 'production',
      },
    });
    
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
    
    // EventBridge Rule for multi-family notifications
    new events.Rule(this, 'NotificationsRealtimeRule', {
      eventBus: kxEventBridge,
      ruleName: `kxgen-notifications-realtime`,
      description: 'Route notification events to WebSocket broadcaster',
      // Option 1: Native prefix matching (preferred)
      eventPattern: {
        source: ['kx-event-tracking'],
        detailType: [
          // QR events (legacy support)
          'qr.get',
          'qr.scanned',
          'qr.created',
          // Notification events
          'notification.sent',
          'notification.delivered',
        ],
      },
      // Option 2: Using EventBridgeDiscovery helper (alternative)
      // eventPattern: EventBridgeDiscovery.createEventPattern({
      //   entityTypes: ['qr', 'scan', 'payment', 'user', 'notification'],
      //   eventTypes: ['*'], // Match all event types for these entities
      // }),
      targets: [new targets.LambdaFunction(this.notifierFunction)],
    });
    
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