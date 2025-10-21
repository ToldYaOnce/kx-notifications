import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';

// Environment variables
const ASSUME_ROLE_ARN = process.env.ASSUME_ROLE_ARN;

// Initialize AWS SDK clients at module load time to avoid cold start delays
let dynamoClient: DynamoDBClient;
let docClient: DynamoDBDocumentClient;
let stsClient: STSClient;
let eventBridgeClient: EventBridgeClient;
let clientsInitialized = false;
let initializationPromise: Promise<void> | null = null;

// Connection management clients grouped by endpoint
const managementClients = new Map<string, ApiGatewayManagementApiClient>();

// Initialize clients immediately at module load
if (!ASSUME_ROLE_ARN) {
  // For default credentials, initialize synchronously at module load
  dynamoClient = new DynamoDBClient({
    maxAttempts: 3,
  });
  docClient = DynamoDBDocumentClient.from(dynamoClient, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });
  eventBridgeClient = new EventBridgeClient({
    maxAttempts: 3,
  });
  clientsInitialized = true;
}

/**
 * Initialize AWS SDK clients with optional cross-account role assumption
 * This is now optimized to only run once and cache the result
 */
export async function initializeClients(): Promise<void> {
  if (clientsInitialized) {
    return;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    const startTime = Date.now();
    console.log(JSON.stringify({
      level: 'INFO',
      message: 'Starting AWS client initialization',
      timestamp: new Date().toISOString(),
    }));
    if (ASSUME_ROLE_ARN) {
      console.log(JSON.stringify({
        level: 'INFO',
        message: 'Assuming cross-account role',
        roleArn: ASSUME_ROLE_ARN,
      }));
      
      stsClient = new STSClient({
        maxAttempts: 3,
      });
      
      const assumeRoleResult = await stsClient.send(new AssumeRoleCommand({
        RoleArn: ASSUME_ROLE_ARN,
        RoleSessionName: 'kxgen-notifications-cross-account',
        DurationSeconds: 3600, // 1 hour
      }));
      
      const credentials = {
        accessKeyId: assumeRoleResult.Credentials!.AccessKeyId!,
        secretAccessKey: assumeRoleResult.Credentials!.SecretAccessKey!,
        sessionToken: assumeRoleResult.Credentials!.SessionToken!,
      };
      
      dynamoClient = new DynamoDBClient({ 
        credentials,
        maxAttempts: 3,
      });
      docClient = DynamoDBDocumentClient.from(dynamoClient, {
        marshallOptions: {
          removeUndefinedValues: true,
        },
      });
      eventBridgeClient = new EventBridgeClient({
        credentials,
        maxAttempts: 3,
      });
    }

    const endTime = Date.now();
    console.log(JSON.stringify({
      level: 'INFO',
      message: 'AWS client initialization completed',
      duration: `${endTime - startTime}ms`,
      timestamp: new Date().toISOString(),
    }));

    clientsInitialized = true;
  })();

  return initializationPromise;
}

/**
 * Get the DynamoDB document client
 */
export function getDocClient(): DynamoDBDocumentClient {
  if (!docClient) {
    throw new Error('DynamoDB client not initialized. Call initializeClients() first.');
  }
  return docClient;
}

/**
 * Get or create ApiGatewayManagementApiClient for a specific endpoint
 * Optimized to reuse clients and avoid cold start delays
 */
export function getManagementClient(domainName: string, stage: string): ApiGatewayManagementApiClient {
  const endpoint = `https://${domainName}/${stage}`;
  
  if (!managementClients.has(endpoint)) {
    const clientConfig: any = { 
      endpoint,
      maxAttempts: 3,
    };
    
    // Use assumed role credentials if available
    if (ASSUME_ROLE_ARN && dynamoClient?.config.credentials) {
      clientConfig.credentials = dynamoClient.config.credentials;
    }
    
    managementClients.set(endpoint, new ApiGatewayManagementApiClient(clientConfig));
  }
  
  return managementClients.get(endpoint)!;
}

/**
 * Get the EventBridge client
 */
export function getEventBridgeClient(): EventBridgeClient {
  if (!eventBridgeClient) {
    throw new Error('EventBridge client not initialized. Call initializeClients() first.');
  }
  return eventBridgeClient;
}





