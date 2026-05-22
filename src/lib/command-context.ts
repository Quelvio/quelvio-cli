const KNOWN_COMMANDS = new Set([
  'login',
  'logout',
  'query',
  'domains',
  'source',
  'whoami',
  'config',
  'completion',
]);

const CONFIG_NAMESPACED_SUBCOMMANDS = new Set(['telemetry']);

function findFirstNonFlag(argv: readonly string[], startIndex: number): string | null {
  for (let i = startIndex; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith('-')) continue;
    return arg;
  }
  return null;
}

export function getCommandName(argv: readonly string[] = process.argv): string | null {
  const first = findFirstNonFlag(argv, 2);
  if (first === null) return null;
  if (!KNOWN_COMMANDS.has(first)) return null;

  if (first === 'config') {
    const second = findFirstNonFlag(argv, argv.indexOf(first) + 1);
    if (second !== null && CONFIG_NAMESPACED_SUBCOMMANDS.has(second)) {
      return `config:${second}`;
    }
  }

  return first;
}
