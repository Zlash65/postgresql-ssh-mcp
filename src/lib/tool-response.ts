import { z } from 'zod';
import type { ToolResponse } from '../types.js';
import { obfuscateConnectionString } from './obfuscate.js';

export const wrapToolOutputSchema = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({
    result: schema,
  });

const formatText = (data: unknown): string => {
  if (typeof data === 'string') {
    return data;
  }

  try {
    const json = JSON.stringify(data, null, 2);
    return json ?? String(data);
  } catch {
    return String(data);
  }
};

export function successResponse(data: unknown): ToolResponse {
  return {
    content: [
      {
        type: 'text',
        text: formatText(data),
      },
    ],
    structuredContent: {
      result: data,
    },
  };
}

function errorResponse(message: string): ToolResponse {
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
