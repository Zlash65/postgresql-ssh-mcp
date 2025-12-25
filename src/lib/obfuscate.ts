export function obfuscateConnectionString(str: string): string {
  return str
    .replace(/:([^:@/]+)@/g, ':****@')
    .replace(/password[=:]\s*\S+/gi, 'password=****')
    .replace(/privateKey[=:]\s*\S+/gi, 'privateKey=****')
    .replace(/privatekey[=:]\s*\S+/gi, 'privateKey=****')
    .replace(/passphrase[=:]\s*\S+/gi, 'passphrase=****')
    .replace(/secret[=:]\s*\S+/gi, 'secret=****')
    .replace(/token[=:]\s*\S+/gi, 'token=****')
    .replace(/api[_-]?key[=:]\s*\S+/gi, 'apiKey=****')
    .replace(/authorization[=:]\s*\S+/gi, 'authorization=****');
}
