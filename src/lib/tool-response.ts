import type { ToolResponse } from '../types.js';
import { obfuscateConnectionString } from './obfuscate.js';

export function successResponse(data: unknown): ToolResponse {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function errorResponse(message: string): ToolResponse {
  const safeMessage = obfuscateConnectionString(message);
  return {
    content: [
      {
        type: 'text',
        text: `Error: ${safeMessage}`,
      },
    ],
    isError: true,
  };
}

export function errorResponseFromError(error: unknown): ToolResponse {
  if (error instanceof Error) {
    return errorResponse(error.message);
  }
  return errorResponse(String(error));
}
