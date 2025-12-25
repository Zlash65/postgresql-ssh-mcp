import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPaths = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '.env.example'),
];

for (const envPath of envPaths) {
  if (!existsSync(envPath)) {
    continue;
  }

  const contents = readFileSync(envPath, 'utf8');
  const lines = contents.split(/\r?\n/);

  for (const line of lines) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    if (trimmed.startsWith('export ')) {
      trimmed = trimmed.slice(7).trim();
    }

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(equalsIndex + 1).trim();

    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];
      const closingIndex = value.indexOf(quote, 1);
      value =
        closingIndex === -1 ? value.slice(1) : value.slice(1, closingIndex);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }

    process.env[key] = value;
  }
}
