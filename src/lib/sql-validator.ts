const READ_ONLY_BLOCKED_KEYWORDS = new Set([
  'COPY',
  'TRUNCATE',
  'LOCK',
  'GRANT',
  'REVOKE',
  'PREPARE',
  'EXECUTE',
]);

export function validateReadOnlyStatement(sql: string): void {
  if (containsMultipleStatements(sql)) {
    throw new Error(
      'Multiple statements not allowed. Submit one statement at a time.'
    );
  }

  const strippedSql = stripLeadingComments(sql);
  const normalized = strippedSql.trim().toUpperCase();
  const firstKeyword = getFirstKeyword(strippedSql);

  if (!firstKeyword) {
    throw new Error('Empty SQL statement.');
  }

  if (READ_ONLY_BLOCKED_KEYWORDS.has(firstKeyword)) {
    throw new Error(
      `${firstKeyword} statements are not allowed in read-only mode.`
    );
  }

  if (firstKeyword === 'CALL') {
    throw new Error(
      'CALL statements not allowed in read-only mode (procedures may modify data).'
    );
  }

  if (firstKeyword === 'DO') {
    throw new Error(
      'DO statements not allowed in read-only mode (anonymous blocks may modify data).'
    );
  }

  if (firstKeyword === 'SELECT') {
    if (containsSelectInto(strippedSql)) {
      throw new Error(
        'SELECT INTO not allowed in read-only mode (creates tables). Use SELECT without INTO.'
      );
    }
    return;
  }

  if (firstKeyword === 'EXPLAIN') {
    validateExplainStatement(strippedSql);
    return;
  }

  if (firstKeyword === 'SHOW') {
    return;
  }

  if (firstKeyword === 'VALUES') {
    return;
  }

  if (firstKeyword === 'TABLE') {
    return;
  }

  if (firstKeyword === 'WITH') {
    if (validateWithStatement(strippedSql)) {
      return;
    }
    throw new Error(
      'WITH statements only allowed when final statement is SELECT. ' +
        'WITH ... INSERT/UPDATE/DELETE/MERGE not permitted in read-only mode.'
    );
  }

  throw new Error(
    `Statement type not allowed in read-only mode. ` +
      `Allowed: SELECT, EXPLAIN (without ANALYZE on DML), SHOW, VALUES, TABLE, WITH...SELECT. ` +
      `Received: ${normalized.slice(0, 50)}...`
  );
}

function containsSelectInto(sql: string): boolean {
  const tokens = tokenizeSimple(sql);

  let depth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].toUpperCase();

    if (token === '(') depth++;
    else if (token === ')') depth--;

    if (token === 'INTO' && depth === 0) {
      return true;
    }
  }

  return false;
}

function validateExplainStatement(sql: string): void {
  const normalized = stripLeadingComments(sql).trim().toUpperCase();

  let remaining = normalized.slice('EXPLAIN'.length);
  remaining = stripLeadingComments(remaining).trim();

  let hasAnalyze = false;

  if (remaining.startsWith('(')) {
    const closeParenIndex = remaining.indexOf(')');
    if (closeParenIndex > 0) {
      const options = remaining.slice(1, closeParenIndex).toUpperCase();
      hasAnalyze = options.includes('ANALYZE');
      remaining = remaining.slice(closeParenIndex + 1);
      remaining = stripLeadingComments(remaining).trim();
    }
  }

  if (
    remaining.startsWith('ANALYZE ') ||
    remaining.startsWith('ANALYZE\n') ||
    remaining.startsWith('ANALYZE\t')
  ) {
    hasAnalyze = true;
    remaining = remaining.slice('ANALYZE'.length);
    remaining = stripLeadingComments(remaining).trim();
  }

  const skipKeywords = [
    'VERBOSE',
    'COSTS',
    'SETTINGS',
    'BUFFERS',
    'WAL',
    'TIMING',
    'SUMMARY',
    'FORMAT',
  ];
  let changed = true;
  while (changed) {
    changed = false;
    remaining = stripLeadingComments(remaining).trim();
    for (const kw of skipKeywords) {
      if (
        remaining.startsWith(kw + ' ') ||
        remaining.startsWith(kw + '\n') ||
        remaining.startsWith(kw + '\t')
      ) {
        remaining = remaining.slice(kw.length);
        remaining = stripLeadingComments(remaining).trim();
        changed = true;
      }
    }
    const formatTypes = ['TEXT', 'JSON', 'XML', 'YAML'];
    for (const ft of formatTypes) {
      if (
        remaining.startsWith(ft + ' ') ||
        remaining.startsWith(ft + '\n') ||
        remaining.startsWith(ft + '\t') ||
        remaining.startsWith(ft + ')')
      ) {
        remaining = remaining.slice(ft.length);
        remaining = stripLeadingComments(remaining).trim();
        changed = true;
      }
    }
  }

  const innerStatement = remaining;
  const innerKeyword = getFirstKeyword(innerStatement);
  if (innerKeyword && READ_ONLY_BLOCKED_KEYWORDS.has(innerKeyword)) {
    throw new Error(
      `EXPLAIN of ${innerKeyword} not allowed in read-only mode.`
    );
  }

  if (hasAnalyze) {
    const normalizedInner = stripLeadingComments(innerStatement).trim().toUpperCase();

    const safeForAnalyze =
      normalizedInner.startsWith('SELECT ') ||
      normalizedInner.startsWith('SELECT\n') ||
      normalizedInner.startsWith('SELECT\t') ||
      normalizedInner.startsWith('TABLE ') ||
      normalizedInner.startsWith('VALUES ') ||
      normalizedInner.startsWith('VALUES(') ||
      normalizedInner.startsWith('WITH ') ||
      normalizedInner.startsWith('WITH\n');

    if (!safeForAnalyze) {
      throw new Error(
        'EXPLAIN ANALYZE not allowed for INSERT/UPDATE/DELETE/MERGE in read-only mode. ' +
          'ANALYZE actually executes the statement! Use EXPLAIN without ANALYZE.'
      );
    }

    if (normalizedInner.startsWith('WITH ') || normalizedInner.startsWith('WITH\n')) {
      const finalStatement = extractFinalStatementAfterCTEs(innerStatement);
      if (finalStatement === null) {
        throw new Error(
          'EXPLAIN ANALYZE WITH ... must end with SELECT. ' +
            'Could not parse CTE structure.'
        );
      }

      const normalizedFinal = stripLeadingComments(finalStatement).trim().toUpperCase();

      const isSafeFinalStatement =
        normalizedFinal.startsWith('SELECT ') ||
        normalizedFinal.startsWith('SELECT\n') ||
        normalizedFinal.startsWith('SELECT\t') ||
        normalizedFinal.startsWith('TABLE ') ||
        normalizedFinal.startsWith('VALUES ') ||
        normalizedFinal.startsWith('VALUES(');

      if (!isSafeFinalStatement) {
        throw new Error(
          'EXPLAIN ANALYZE WITH ... must end with SELECT. ' +
            'ANALYZE on WITH...INSERT/UPDATE/DELETE will execute the statement! ' +
            `Found final statement starting with: ${normalizedFinal.slice(0, 30)}...`
        );
      }

      if (cteContainsDML(innerStatement)) {
        throw new Error(
          'EXPLAIN ANALYZE not allowed on data-modifying CTEs. ' +
            'CTEs containing INSERT/UPDATE/DELETE will execute when using ANALYZE.'
        );
      }
    }
  }

  const blocked = ['CALL ', 'DO '];
  for (const prefix of blocked) {
    if (innerStatement.startsWith(prefix)) {
      throw new Error(
        `EXPLAIN of ${prefix.trim()} not allowed in read-only mode.`
      );
    }
  }
}

function validateWithStatement(sql: string): boolean {
  if (cteContainsDML(sql)) {
    return false;
  }

  const finalStatement = extractFinalStatementAfterCTEs(sql);
  if (!finalStatement) return false;

  const normalized = stripLeadingComments(finalStatement).trim().toUpperCase();

  const isAllowed =
    normalized.startsWith('SELECT ') ||
    normalized.startsWith('SELECT\n') ||
    normalized.startsWith('SELECT\t') ||
    normalized.startsWith('TABLE ') ||
    normalized.startsWith('VALUES ') ||
    normalized.startsWith('VALUES(');

  if (!isAllowed) {
    return false;
  }

  if (normalized.startsWith('SELECT')) {
    return !containsSelectInto(finalStatement);
  }

  return true;
}

function skipWhitespaceAndComments(sql: string, start: number): number {
  let i = start;

  while (i < sql.length) {
    const char = sql[i];
    const nextChar = sql[i + 1] || '';

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (char === '-' && nextChar === '-') {
      i += 2;
      while (i < sql.length && sql[i] !== '\n') {
        i++;
      }
      if (i < sql.length) i++;
      continue;
    }

    if (char === '/' && nextChar === '*') {
      i += 2;
      while (i < sql.length - 1) {
        if (sql[i] === '*' && sql[i + 1] === '/') {
          i += 2;
          break;
        }
        i++;
      }
      continue;
    }

    break;
  }

  return i;
}

export function cteContainsDML(sql: string): boolean {
  const upperSql = sql.toUpperCase();

  let searchStart = 0;

  while (true) {
    const asIndex = upperSql.indexOf('AS', searchStart);
    if (asIndex === -1) break;

    const charBefore = asIndex > 0 ? upperSql[asIndex - 1] : ' ';
    const charAfter = upperSql[asIndex + 2] || ' ';
    if (/[A-Z0-9_]/.test(charBefore) || /[A-Z0-9_]/.test(charAfter)) {
      searchStart = asIndex + 2;
      continue;
    }

    const parenStart = skipWhitespaceAndComments(sql, asIndex + 2);

    if (parenStart >= sql.length || sql[parenStart] !== '(') {
      searchStart = parenStart > asIndex + 2 ? parenStart : asIndex + 2;
      continue;
    }

    const cteBody = extractParenthesizedContent(sql, parenStart);
    if (cteBody === null) {
      searchStart = parenStart + 1;
      continue;
    }

    const strippedBody = stripLeadingComments(cteBody).trim().toUpperCase();

    const tokens = tokenizeSimple(strippedBody);
    for (const token of tokens) {
      const upper = token.toUpperCase();
      if (
        upper === 'INSERT' ||
        upper === 'UPDATE' ||
        upper === 'DELETE' ||
        upper === 'MERGE'
      ) {
        return true;
      }
    }

    searchStart = parenStart + cteBody.length + 2;
  }

  return false;
}

function extractParenthesizedContent(
  sql: string,
  openParenIndex: number
): string | null {
  if (sql[openParenIndex] !== '(') return null;

  let depth = 1;
  let i = openParenIndex + 1;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inDollarQuote = false;
  let dollarTag = '';
  let inLineComment = false;
  let inBlockComment = false;

  while (i < sql.length && depth > 0) {
    const char = sql[i];
    const nextChar = sql[i + 1] || '';

    if (!inSingleQuote && !inDoubleQuote && !inDollarQuote && !inBlockComment) {
      if (char === '-' && nextChar === '-') {
        inLineComment = true;
        i += 2;
        continue;
      }
    }
    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      i++;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !inDollarQuote) {
      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        i += 2;
        continue;
      }
    }
    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (char === '$' && !inSingleQuote && !inDoubleQuote) {
      if (!inDollarQuote) {
        const tagMatch = sql.slice(i).match(/^\$([a-zA-Z0-9_]*)\$/);
        if (tagMatch) {
          dollarTag = tagMatch[0];
          inDollarQuote = true;
          i += dollarTag.length;
          continue;
        }
      } else if (sql.slice(i, i + dollarTag.length) === dollarTag) {
        inDollarQuote = false;
        i += dollarTag.length;
        continue;
      }
    }
    if (inDollarQuote) {
      i++;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && nextChar === "'") {
        i += 2;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      i++;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      if (inDoubleQuote && nextChar === '"') {
        i += 2;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      i++;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      i++;
      continue;
    }

    if (char === '(') depth++;
    else if (char === ')') depth--;

    i++;
  }

  if (depth !== 0) return null;

  return sql.slice(openParenIndex + 1, i - 1);
}

export function extractFinalStatementAfterCTEs(sql: string): string | null {
  let depth = 0;
  let lastCTEEnd = -1;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inDollarQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = '';

  const upperSql = sql.toUpperCase();
  let startIdx = upperSql.indexOf('WITH');
  if (startIdx === -1) return null;
  startIdx += 4;

  for (let i = startIdx; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1] || '';

    if (!inSingleQuote && !inDoubleQuote && !inDollarQuote && !inBlockComment) {
      if (char === '-' && nextChar === '-') {
        inLineComment = true;
        i++;
        continue;
      }
    }
    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !inDollarQuote) {
      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
    }
    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (char === '$' && !inSingleQuote && !inDoubleQuote && !inDollarQuote) {
      const tagMatch = sql.slice(i).match(/^\$([a-zA-Z0-9_]*)\$/);
      if (tagMatch) {
        dollarTag = tagMatch[0];
        inDollarQuote = true;
        i += dollarTag.length - 1;
        continue;
      }
    } else if (inDollarQuote && sql.slice(i, i + dollarTag.length) === dollarTag) {
      inDollarQuote = false;
      i += dollarTag.length - 1;
      continue;
    }
    if (inDollarQuote) continue;

    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && nextChar === "'") {
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      if (inDoubleQuote && nextChar === '"') {
        i++;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) continue;

    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth === 0) {
        lastCTEEnd = i;

        let j = i + 1;
        while (j < sql.length && /\s/.test(sql[j])) j++;

        while (j < sql.length) {
          if (sql.slice(j, j + 2) === '--') {
            const nl = sql.indexOf('\n', j);
            j = nl === -1 ? sql.length : nl + 1;
            while (j < sql.length && /\s/.test(sql[j])) j++;
          } else if (sql.slice(j, j + 2) === '/*') {
            const end = sql.indexOf('*/', j);
            j = end === -1 ? sql.length : end + 2;
            while (j < sql.length && /\s/.test(sql[j])) j++;
          } else {
            break;
          }
        }

        if (j < sql.length && sql[j] !== ',') {
          return sql.slice(j);
        }
      }
    }
  }

  if (lastCTEEnd !== -1) {
    return sql.slice(lastCTEEnd + 1);
  }

  return null;
}

export function stripLeadingComments(sql: string): string {
  let result = sql.trimStart();

  while (true) {
    if (result.startsWith('--')) {
      const newlineIndex = result.indexOf('\n');
      if (newlineIndex === -1) return '';
      result = result.slice(newlineIndex + 1).trimStart();
      continue;
    }

    if (result.startsWith('/*')) {
      const endIndex = result.indexOf('*/');
      if (endIndex === -1) return '';
      result = result.slice(endIndex + 2).trimStart();
      continue;
    }

    break;
  }

  return result;
}

function containsMultipleStatements(sql: string): boolean {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inDollarQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = '';
  let semicolonCount = 0;
  let lastSemicolonIndex = -1;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1] || '';

    if (!inSingleQuote && !inDoubleQuote && !inDollarQuote && !inBlockComment) {
      if (char === '-' && nextChar === '-') {
        inLineComment = true;
        i++;
        continue;
      }
    }
    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !inDollarQuote && !inLineComment) {
      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
    }
    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (char === '$' && !inSingleQuote && !inDoubleQuote) {
      if (!inDollarQuote) {
        const tagMatch = sql.slice(i).match(/^\$([a-zA-Z0-9_]*)\$/);
        if (tagMatch) {
          dollarTag = tagMatch[0];
          inDollarQuote = true;
          i += dollarTag.length - 1;
          continue;
        }
      } else if (sql.slice(i, i + dollarTag.length) === dollarTag) {
        inDollarQuote = false;
        i += dollarTag.length - 1;
        continue;
      }
    }
    if (inDollarQuote) continue;

    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && nextChar === "'") {
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      if (inDoubleQuote && nextChar === '"') {
        i++;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) continue;

    if (char === ';') {
      semicolonCount++;
      lastSemicolonIndex = i;
      if (semicolonCount > 1) return true;
    }
  }

  if (lastSemicolonIndex > -1) {
    const afterSemicolon = stripLeadingComments(
      sql.slice(lastSemicolonIndex + 1)
    ).trim();
    if (afterSemicolon.length > 0) {
      return true;
    }
  }

  return false;
}

function tokenizeSimple(sql: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  let inDollarQuote = false;
  let dollarTag = '';
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1] || '';

    if (!inString && !inDollarQuote && !inBlockComment && char === '-' && nextChar === '-') {
      if (current) tokens.push(current);
      current = '';
      inLineComment = true;
      i++;
      continue;
    }
    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }

    if (!inString && !inDollarQuote && !inLineComment && char === '/' && nextChar === '*') {
      if (current) tokens.push(current);
      current = '';
      inBlockComment = true;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (char === '$' && !inString) {
      if (!inDollarQuote) {
        const match = sql.slice(i).match(/^\$([a-zA-Z0-9_]*)\$/);
        if (match) {
          if (current) tokens.push(current);
          current = '';
          dollarTag = match[0];
          inDollarQuote = true;
          i += dollarTag.length - 1;
          continue;
        }
      } else if (sql.slice(i, i + dollarTag.length) === dollarTag) {
        inDollarQuote = false;
        i += dollarTag.length - 1;
        continue;
      }
    }
    if (inDollarQuote) continue;

    if ((char === "'" || char === '"') && !inString) {
      if (current) tokens.push(current);
      current = '';
      inString = true;
      stringChar = char;
      continue;
    }
    if (inString && char === stringChar) {
      if (sql[i + 1] === stringChar) {
        i++;
        continue;
      }
      inString = false;
      continue;
    }
    if (inString) continue;

    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }

    if ('(),;'.includes(char)) {
      if (current) tokens.push(current);
      tokens.push(char);
      current = '';
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

export function getFirstKeyword(sql: string): string | null {
  const tokens = tokenizeSimple(sql);
  for (const token of tokens) {
    if (/^[A-Za-z_]/.test(token)) {
      return token.toUpperCase();
    }
  }
  return null;
}
