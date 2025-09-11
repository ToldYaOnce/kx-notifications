import { handler } from '../src/notifier/notifier';
import { EventBridgeEvent } from 'aws-lambda';

// Mock AWS SDK
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/lib-dynamodb');
jest.mock('@aws-sdk/client-apigatewaymanagementapi');
jest.mock('@aws-sdk/client-sts');

// Mock the AWS clients utilities
jest.mock('../src/utils/aws-clients', () => ({
  initializeClients: jest.fn().mockResolvedValue(undefined),
  getDocClient: jest.fn().mockReturnValue({
    send: jest.fn().mockResolvedValue({ Items: [] })
  }),
  getManagementClient: jest.fn().mockReturnValue({
    send: jest.fn().mockResolvedValue({})
  })
}));

describe('Notifier Handler', () => {
  // Mock console methods to avoid cluttering test output
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  
  beforeEach(() => {
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
    
    // Set required environment variables
    process.env.CONNECTIONS_TABLE = 'test-connections-table';
    process.env.WEBSOCKET_API_ID = 'test-api-id';
    process.env.WEBSOCKET_STAGE = 'test';
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    
    // Clean up environment variables
    delete process.env.CONNECTIONS_TABLE;
    delete process.env.WEBSOCKET_API_ID;
    delete process.env.WEBSOCKET_STAGE;
    delete process.env.ASSUME_ROLE_ARN;
  });

  test('processes notification event successfully', async () => {
    // GIVEN
    const mockEvent: EventBridgeEvent<string, any> = {
      version: '0',
      id: 'test-event-id',
      'detail-type': 'qr.scanned',
      source: 'kx-event-tracking',
      account: '123456789012',
      time: '2025-01-03T15:04:11.944Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        eventId: 'test-event-id',
        tenantId: 'tenant_123',
        entityId: 'qr_456',
        entityType: 'qr',
        eventType: 'qr.scanned',
        occurredAt: '2025-01-03T15:04:11.944Z',
        metadata: {
          formId: 'form_789'
        }
      }
    };

    // WHEN
    await handler(mockEvent);

    // THEN
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Processing EventBridge notification'));
  });

  test('handles missing tenant ID', async () => {
    // GIVEN
    const mockEvent: EventBridgeEvent<string, any> = {
      version: '0',
      id: 'test-event-id',
      'detail-type': 'qr.scanned',
      source: 'kx-event-tracking',
      account: '123456789012',
      time: '2025-01-03T15:04:11.944Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        eventId: 'test-event-id',
        // Missing tenantId
        entityId: 'qr_456',
        entityType: 'qr',
        eventType: 'qr.scanned',
      }
    };

    // WHEN
    await handler(mockEvent);

    // THEN
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No tenantId found in event'));
  });
});
