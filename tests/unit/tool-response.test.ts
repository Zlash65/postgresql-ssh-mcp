/**
 * Tool Response Tests
 * Tests for MCP tool response helpers
 */

import { describe, it, expect } from 'vitest';
import {
  successResponse,
  errorResponse,
  errorResponseFromError,
} from '../../src/lib/tool-response.js';

describe('successResponse', () => {
  it('creates response without isError flag (success)', () => {
    const response = successResponse({ data: 'test' });
    expect(response.isError).toBeUndefined();
  });

  it('serializes object data to JSON', () => {
    const data = { id: 1, name: 'test' };
    const response = successResponse(data);
    expect(response.content[0].type).toBe('text');
    expect(response.content[0].text).toBe(JSON.stringify(data, null, 2));
  });

  it('serializes array data to JSON', () => {
    const data = [1, 2, 3];
    const response = successResponse(data);
    expect(JSON.parse(response.content[0].text)).toEqual([1, 2, 3]);
  });

  it('returns strings as-is without JSON serialization', () => {
    expect(successResponse('hello').content[0].text).toBe('hello');
  });

  it('serializes non-string primitives to JSON', () => {
    expect(successResponse(42).content[0].text).toBe('42');
    expect(successResponse(true).content[0].text).toBe('true');
    expect(successResponse(null).content[0].text).toBe('null');
  });
});

describe('errorResponse', () => {
  it('creates response with isError true', () => {
    const response = errorResponse('Something went wrong');
    expect(response.isError).toBe(true);
  });

  it('includes error message with Error prefix', () => {
    const response = errorResponse('Database connection failed');
    expect(response.content[0].type).toBe('text');
    expect(response.content[0].text).toBe('Error: Database connection failed');
  });
});

describe('errorResponseFromError', () => {
  it('extracts message from Error object', () => {
    const error = new Error('Test error message');
    const response = errorResponseFromError(error);
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toBe('Error: Test error message');
  });

  it('converts string error to response', () => {
    const response = errorResponseFromError('String error');
    expect(response.content[0].text).toBe('Error: String error');
  });

  it('converts unknown error types to string', () => {
    const response = errorResponseFromError({ custom: 'error' });
    expect(response.content[0].text).toBe('Error: [object Object]');
  });

  it('handles null and undefined', () => {
    expect(errorResponseFromError(null).content[0].text).toBe('Error: null');
    expect(errorResponseFromError(undefined).content[0].text).toBe('Error: undefined');
  });

  it('obfuscates credentials in error messages', () => {
    const error = new Error('Connection failed: postgresql://user:secret@host/db');
    const response = errorResponseFromError(error);
    expect(response.content[0].text).not.toContain('secret');
    expect(response.content[0].text).toContain('****');
  });
});
