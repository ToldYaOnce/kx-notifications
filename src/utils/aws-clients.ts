import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';

// Environment variables
const ASSUME_ROLE_ARN = process.env.ASSUME_ROLE_ARN;

// AWS SDK clients
let dynamoClient: DynamoDBClient;
let docClient: DynamoDBDocumentClient;
let stsClient: STSClient;

// Connection management clients grouped by endpoint
const managementClients = new Map<string, ApiGatewayManagementApiClient>();

/**
 * Initialize AWS SDK clients with optional cross-account role assumption
 */
export async function initializeClients() {
  if (ASSUME_ROLE_ARN) {
    console.log(JSON.stringify({
      level: 'INFO',
      message: 'Assuming cross-account role',
      roleArn: ASSUME_ROLE_ARN,
    }));
    
    stsClient = new STSClient({});
    
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
    
    dynamoClient = new DynamoDBClient({ credentials });
    docClient = DynamoDBDocumentClient.from(dynamoClient);
  } else {
    // Use default credentials
    dynamoClient = new DynamoDBClient({});
    docClient = DynamoDBDocumentClient.from(dynamoClient);
  }
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
 */
export function getManagementClient(domainName: string, stage: string): ApiGatewayManagementApiClient {
  const endpoint = `https://${domainName}/${stage}`;
  
  if (!managementClients.has(endpoint)) {
    const clientConfig: any = { endpoint };
    
    // Use assumed role credentials if available
    if (ASSUME_ROLE_ARN && dynamoClient?.config.credentials) {
      clientConfig.credentials = dynamoClient.config.credentials;
    }
    
    managementClients.set(endpoint, new ApiGatewayManagementApiClient(clientConfig));
  }
  
  return managementClients.get(endpoint)!;
}




