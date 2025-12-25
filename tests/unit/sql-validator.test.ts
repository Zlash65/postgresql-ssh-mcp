/**
 * SQL Validator Tests
 * Comprehensive tests for read-only enforcement and SQL parsing
 */

import { describe, it, expect } from 'vitest';
import {
  validateReadOnlyStatement,
  cteContainsDML,
  extractFinalStatementAfterCTEs,
  stripLeadingComments,
  getFirstKeyword,
} from '../../src/lib/sql-validator.js';

describe('validateReadOnlyStatement', () => {
  describe('allowed SELECT statements', () => {
    it('allows simple SELECT', () => {
      expect(() => validateReadOnlyStatement('SELECT 1')).not.toThrow();
      expect(() => validateReadOnlyStatement('SELECT * FROM users')).not.toThrow();
      expect(() => validateReadOnlyStatement('SELECT id, name FROM users WHERE id = 1')).not.toThrow();
    });

    it('allows SELECT with subqueries', () => {
      expect(() => validateReadOnlyStatement('SELECT * FROM users WHERE id IN (SELECT id FROM admins)')).not.toThrow();
    });

    it('allows SELECT with JOINs', () => {
      expect(() => validateReadOnlyStatement('SELECT u.*, o.* FROM users u JOIN orders o ON u.id = o.user_id')).not.toThrow();
    });

    it('allows SELECT with comments', () => {
      expect(() => validateReadOnlyStatement('-- comment\nSELECT * FROM users')).not.toThrow();
      expect(() => validateReadOnlyStatement('/* comment */ SELECT * FROM users')).not.toThrow();
      expect(() => validateReadOnlyStatement('SELECT /* inline */ * FROM users')).not.toThrow();
    });

    it('allows SELECT with comment immediately after keyword', () => {
      expect(() => validateReadOnlyStatement('SELECT/* comment */ * FROM users')).not.toThrow();
    });
  });

  describe('blocked SELECT INTO', () => {
    it('blocks SELECT INTO', () => {
      expect(() => validateReadOnlyStatement('SELECT * INTO new_table FROM users')).toThrow(/SELECT INTO not allowed/);
      expect(() => validateReadOnlyStatement('SELECT id, name INTO backup FROM users')).toThrow(/SELECT INTO not allowed/);
    });

    it('allows SELECT with INTO in subquery', () => {
      expect(() => validateReadOnlyStatement('SELECT * FROM (SELECT 1 AS into_val) sub')).not.toThrow();
    });
  });

  describe('allowed EXPLAIN statements', () => {
    it('allows EXPLAIN without ANALYZE', () => {
      expect(() => validateReadOnlyStatement('EXPLAIN SELECT * FROM users')).not.toThrow();
      expect(() => validateReadOnlyStatement('EXPLAIN INSERT INTO t VALUES (1)')).not.toThrow();
      expect(() => validateReadOnlyStatement('EXPLAIN DELETE FROM users')).not.toThrow();
    });

    it('allows EXPLAIN ANALYZE on SELECT', () => {
      expect(() => validateReadOnlyStatement('EXPLAIN ANALYZE SELECT * FROM users')).not.toThrow();
      expect(() => validateReadOnlyStatement('EXPLAIN (ANALYZE) SELECT * FROM users')).not.toThrow();
      expect(() => validateReadOnlyStatement('EXPLAIN (ANALYZE, COSTS) SELECT * FROM users')).not.toThrow();
    });

    it('allows EXPLAIN with comments', () => {
      expect(() => validateReadOnlyStatement('EXPLAIN /* comment */ SELECT * FROM users')).not.toThrow();
      expect(() => validateReadOnlyStatement('EXPLAIN /* x */ ANALYZE SELECT * FROM users')).not.toThrow();
    });
  });

  describe('blocked EXPLAIN ANALYZE on DML', () => {
    it('blocks EXPLAIN ANALYZE INSERT', () => {
      expect(() => validateReadOnlyStatement('EXPLAIN ANALYZE INSERT INTO t VALUES (1)')).toThrow(/EXPLAIN ANALYZE not allowed/);
    });

    it('blocks EXPLAIN ANALYZE UPDATE', () => {
      expect(() => validateReadOnlyStatement('EXPLAIN ANALYZE UPDATE users SET name = $1')).toThrow(/EXPLAIN ANALYZE not allowed/);
    });

    it('blocks EXPLAIN ANALYZE DELETE', () => {
      expect(() => validateReadOnlyStatement('EXPLAIN ANALYZE DELETE FROM users')).toThrow(/EXPLAIN ANALYZE not allowed/);
    });

    it('blocks EXPLAIN ANALYZE with parentheses syntax', () => {
      expect(() => validateReadOnlyStatement('EXPLAIN (ANALYZE) INSERT INTO t VALUES (1)')).toThrow(/EXPLAIN ANALYZE not allowed/);
      expect(() => validateReadOnlyStatement('EXPLAIN (ANALYZE, COSTS) DELETE FROM t')).toThrow(/EXPLAIN ANALYZE not allowed/);
    });

    it('blocks EXPLAIN ANALYZE with comments before DML', () => {
      expect(() => validateReadOnlyStatement('EXPLAIN ANALYZE /* comment */ INSERT INTO t VALUES (1)')).toThrow(/EXPLAIN ANALYZE not allowed/);
      expect(() => validateReadOnlyStatement('EXPLAIN /* x */ ANALYZE DELETE FROM users')).toThrow(/EXPLAIN ANALYZE not allowed/);
    });
  });

  describe('allowed WITH statements', () => {
    it('allows WITH ... SELECT', () => {
      expect(() => validateReadOnlyStatement('WITH cte AS (SELECT 1) SELECT * FROM cte')).not.toThrow();
      expect(() => validateReadOnlyStatement('WITH RECURSIVE cte AS (SELECT 1 UNION ALL SELECT n+1 FROM cte WHERE n < 10) SELECT * FROM cte')).not.toThrow();
    });

    it('allows WITH with multiple CTEs', () => {
      expect(() => validateReadOnlyStatement('WITH a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a, b')).not.toThrow();
    });

    it('allows WITH with comments', () => {
      expect(() => validateReadOnlyStatement('WITH /* comment */ cte AS (SELECT 1) SELECT * FROM cte')).not.toThrow();
      expect(() => validateReadOnlyStatement('WITH cte AS /* comment */ (SELECT 1) SELECT * FROM cte')).not.toThrow();
    });
  });

  describe('blocked WITH statements', () => {
    it('blocks WITH ... INSERT', () => {
      expect(() => validateReadOnlyStatement('WITH cte AS (SELECT 1) INSERT INTO t VALUES (1)')).toThrow(/WITH statements only allowed/);
    });

    it('blocks WITH ... UPDATE', () => {
      expect(() => validateReadOnlyStatement('WITH cte AS (SELECT 1) UPDATE t SET x = 1')).toThrow(/WITH statements only allowed/);
    });

    it('blocks WITH ... DELETE', () => {
      expect(() => validateReadOnlyStatement('WITH cte AS (SELECT 1) DELETE FROM t')).toThrow(/WITH statements only allowed/);
    });

    it('blocks WITH ... SELECT INTO', () => {
      expect(() => validateReadOnlyStatement('WITH cte AS (SELECT 1) SELECT * INTO new_table FROM cte')).toThrow(/WITH statements only allowed/);
    });

    it('blocks data-modifying CTEs', () => {
      expect(() => validateReadOnlyStatement('WITH deleted AS (DELETE FROM t RETURNING *) SELECT * FROM deleted')).toThrow(/WITH statements only allowed/);
      expect(() => validateReadOnlyStatement('WITH inserted AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM inserted')).toThrow(/WITH statements only allowed/);
      expect(() => validateReadOnlyStatement('WITH updated AS (UPDATE t SET x = 1 RETURNING *) SELECT * FROM updated')).toThrow(/WITH statements only allowed/);
    });

    it('blocks nested data-modifying CTEs', () => {
      expect(() => validateReadOnlyStatement('WITH outer AS (WITH inner AS (DELETE FROM t RETURNING *) SELECT * FROM inner) SELECT * FROM outer')).toThrow(/WITH statements only allowed/);
    });

    it('blocks data-modifying CTEs with comments', () => {
      expect(() => validateReadOnlyStatement('WITH cte AS (/* comment */ DELETE FROM t RETURNING *) SELECT * FROM cte')).toThrow(/WITH statements only allowed/);
      expect(() => validateReadOnlyStatement('WITH cte AS (-- comment\nINSERT INTO t VALUES (1) RETURNING *) SELECT * FROM cte')).toThrow(/WITH statements only allowed/);
    });
  });

  describe('blocked CALL and DO', () => {
    it('blocks CALL statements', () => {
      expect(() => validateReadOnlyStatement('CALL my_procedure()')).toThrow(/CALL statements not allowed/);
      expect(() => validateReadOnlyStatement('CALL/* comment */my_procedure()')).toThrow(/CALL statements not allowed/);
    });

    it('blocks DO blocks', () => {
      expect(() => validateReadOnlyStatement('DO $$ BEGIN DELETE FROM users; END $$')).toThrow(/DO statements not allowed/);
      expect(() => validateReadOnlyStatement('DO/* comment */ $$ BEGIN END $$')).toThrow(/DO statements not allowed/);
    });
  });

  describe('allowed simple statements', () => {
    it('allows SHOW', () => {
      expect(() => validateReadOnlyStatement('SHOW search_path')).not.toThrow();
      expect(() => validateReadOnlyStatement('SHOW ALL')).not.toThrow();
    });

    it('allows VALUES', () => {
      expect(() => validateReadOnlyStatement('VALUES (1, 2, 3)')).not.toThrow();
      expect(() => validateReadOnlyStatement('VALUES (1), (2), (3)')).not.toThrow();
    });

    it('allows TABLE', () => {
      expect(() => validateReadOnlyStatement('TABLE users')).not.toThrow();
    });
  });

  describe('blocked DML statements', () => {
    it('blocks INSERT', () => {
      expect(() => validateReadOnlyStatement('INSERT INTO users VALUES (1)')).toThrow(/Statement type not allowed/);
    });

    it('blocks UPDATE', () => {
      expect(() => validateReadOnlyStatement('UPDATE users SET name = $1')).toThrow(/Statement type not allowed/);
    });

    it('blocks DELETE', () => {
      expect(() => validateReadOnlyStatement('DELETE FROM users')).toThrow(/Statement type not allowed/);
    });

    it('blocks TRUNCATE', () => {
      expect(() => validateReadOnlyStatement('TRUNCATE users')).toThrow(/Statement type not allowed/);
    });
  });

  describe('blocked DDL statements', () => {
    it('blocks CREATE', () => {
      expect(() => validateReadOnlyStatement('CREATE TABLE t (id INT)')).toThrow(/Statement type not allowed/);
    });

    it('blocks DROP', () => {
      expect(() => validateReadOnlyStatement('DROP TABLE users')).toThrow(/Statement type not allowed/);
    });

    it('blocks ALTER', () => {
      expect(() => validateReadOnlyStatement('ALTER TABLE users ADD COLUMN x INT')).toThrow(/Statement type not allowed/);
    });
  });

  describe('multiple statements', () => {
    it('blocks multiple statements separated by semicolon', () => {
      expect(() => validateReadOnlyStatement('SELECT 1; SELECT 2')).toThrow(/Multiple statements not allowed/);
      expect(() => validateReadOnlyStatement('SELECT 1; DROP TABLE users')).toThrow(/Multiple statements not allowed/);
    });

    it('allows single statement with trailing semicolon', () => {
      expect(() => validateReadOnlyStatement('SELECT 1;')).not.toThrow();
    });

    it('handles semicolons in strings', () => {
      expect(() => validateReadOnlyStatement("SELECT 'a;b'")).not.toThrow();
      expect(() => validateReadOnlyStatement("SELECT ';'")).not.toThrow();
    });

    it('handles semicolons in comments', () => {
      expect(() => validateReadOnlyStatement('SELECT 1 -- ; comment')).not.toThrow();
      expect(() => validateReadOnlyStatement('SELECT /* ; */ 1')).not.toThrow();
    });
  });
});

describe('cteContainsDML', () => {
  describe('detects DML in CTE bodies', () => {
    it('detects DELETE', () => {
      expect(cteContainsDML('WITH cte AS (DELETE FROM t RETURNING *) SELECT * FROM cte')).toBe(true);
    });

    it('detects INSERT', () => {
      expect(cteContainsDML('WITH cte AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM cte')).toBe(true);
    });

    it('detects UPDATE', () => {
      expect(cteContainsDML('WITH cte AS (UPDATE t SET x = 1 RETURNING *) SELECT * FROM cte')).toBe(true);
    });

    it('detects MERGE', () => {
      expect(cteContainsDML('WITH cte AS (MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE) SELECT * FROM cte')).toBe(true);
    });
  });

  describe('handles comments', () => {
    it('detects DML after block comment', () => {
      expect(cteContainsDML('WITH cte AS (/* comment */ DELETE FROM t RETURNING *) SELECT * FROM cte')).toBe(true);
    });

    it('detects DML after line comment', () => {
      expect(cteContainsDML('WITH cte AS (-- comment\nDELETE FROM t RETURNING *) SELECT * FROM cte')).toBe(true);
    });

    it('handles comment between AS and (', () => {
      expect(cteContainsDML('WITH cte AS /* comment */ (DELETE FROM t RETURNING *) SELECT * FROM cte')).toBe(true);
    });
  });

  describe('ignores DML in strings', () => {
    it('ignores DML keyword in single-quoted string', () => {
      expect(cteContainsDML("WITH cte AS (SELECT 'DELETE FROM t') SELECT * FROM cte")).toBe(false);
    });

    it('ignores DML keyword in double-quoted identifier', () => {
      expect(cteContainsDML('WITH cte AS (SELECT * FROM "DELETE") SELECT * FROM cte')).toBe(false);
    });

    it('ignores DML keyword in dollar-quoted string', () => {
      expect(cteContainsDML('WITH cte AS (SELECT $$DELETE FROM t$$) SELECT * FROM cte')).toBe(false);
    });
  });

  describe('returns false for read-only CTEs', () => {
    it('returns false for SELECT-only CTE', () => {
      expect(cteContainsDML('WITH cte AS (SELECT * FROM t) SELECT * FROM cte')).toBe(false);
    });

    it('returns false for nested SELECT CTEs', () => {
      expect(cteContainsDML('WITH a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a, b')).toBe(false);
    });
  });
});

describe('extractFinalStatementAfterCTEs', () => {
  it('extracts SELECT after single CTE', () => {
    const result = extractFinalStatementAfterCTEs('WITH cte AS (SELECT 1) SELECT * FROM cte');
    expect(result).not.toBeNull();
    expect(result!.trim().toUpperCase()).toMatch(/^SELECT/);
  });

  it('extracts SELECT after multiple CTEs', () => {
    const result = extractFinalStatementAfterCTEs('WITH a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a, b');
    expect(result).not.toBeNull();
    expect(result!.trim().toUpperCase()).toMatch(/^SELECT/);
  });

  it('extracts INSERT after CTE', () => {
    const result = extractFinalStatementAfterCTEs('WITH cte AS (SELECT 1) INSERT INTO t SELECT * FROM cte');
    expect(result).not.toBeNull();
    expect(result!.trim().toUpperCase()).toMatch(/^INSERT/);
  });

  it('handles nested parentheses in CTE', () => {
    const result = extractFinalStatementAfterCTEs('WITH cte AS (SELECT * FROM (SELECT 1) sub) SELECT * FROM cte');
    expect(result).not.toBeNull();
    expect(result!.trim().toUpperCase()).toMatch(/^SELECT/);
  });

  it('handles comments after CTE', () => {
    const result = extractFinalStatementAfterCTEs('WITH cte AS (SELECT 1) /* comment */ SELECT * FROM cte');
    expect(result).not.toBeNull();
    expect(result!.trim().toUpperCase()).toMatch(/^SELECT/);
  });

  it('returns null for invalid input', () => {
    expect(extractFinalStatementAfterCTEs('SELECT * FROM users')).toBeNull();
  });
});

describe('stripLeadingComments', () => {
  it('strips line comments', () => {
    expect(stripLeadingComments('-- comment\nSELECT 1')).toBe('SELECT 1');
    expect(stripLeadingComments('-- line 1\n-- line 2\nSELECT 1')).toBe('SELECT 1');
  });

  it('strips block comments', () => {
    expect(stripLeadingComments('/* comment */ SELECT 1')).toBe('SELECT 1');
    expect(stripLeadingComments('/* multi\nline */ SELECT 1')).toBe('SELECT 1');
  });

  it('strips mixed comments', () => {
    expect(stripLeadingComments('-- line\n/* block */ SELECT 1')).toBe('SELECT 1');
    expect(stripLeadingComments('/* block */-- line\nSELECT 1')).toBe('SELECT 1');
  });

  it('handles leading whitespace', () => {
    expect(stripLeadingComments('   SELECT 1')).toBe('SELECT 1');
    expect(stripLeadingComments('\n\t  SELECT 1')).toBe('SELECT 1');
  });

  it('returns empty string for comment-only input', () => {
    expect(stripLeadingComments('-- only comment')).toBe('');
    expect(stripLeadingComments('/* unclosed comment')).toBe('');
  });

  it('preserves non-leading comments', () => {
    expect(stripLeadingComments('SELECT /* comment */ 1')).toBe('SELECT /* comment */ 1');
  });
});

describe('getFirstKeyword', () => {
  it('returns first keyword for simple statements', () => {
    expect(getFirstKeyword('SELECT * FROM users')).toBe('SELECT');
    expect(getFirstKeyword('INSERT INTO t VALUES (1)')).toBe('INSERT');
    expect(getFirstKeyword('UPDATE t SET x = 1')).toBe('UPDATE');
    expect(getFirstKeyword('DELETE FROM t')).toBe('DELETE');
  });

  it('handles leading whitespace', () => {
    expect(getFirstKeyword('  SELECT 1')).toBe('SELECT');
    expect(getFirstKeyword('\n\tSELECT 1')).toBe('SELECT');
  });

  it('handles block comment after keyword', () => {
    expect(getFirstKeyword('SELECT/* comment */ *')).toBe('SELECT');
    expect(getFirstKeyword('WITH/* x */cte AS')).toBe('WITH');
  });

  it('handles line comment after keyword', () => {
    expect(getFirstKeyword('SELECT-- comment\n*')).toBe('SELECT');
  });

  it('returns null for empty input', () => {
    expect(getFirstKeyword('')).toBeNull();
    expect(getFirstKeyword('   ')).toBeNull();
    expect(getFirstKeyword('-- only comment')).toBeNull();
  });

  it('handles parentheses', () => {
    expect(getFirstKeyword('(SELECT 1)')).toBe('SELECT');
  });
});
