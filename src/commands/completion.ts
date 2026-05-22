import type { Command } from 'commander';
import { GenericError } from '../errors.js';

const COMMANDS = [
  'login',
  'logout',
  'query',
  'domains',
  'source',
  'whoami',
  'config',
  'completion',
  'help',
] as const;

const CONFIG_SUBCOMMANDS = ['list', 'get', 'set', 'unset'] as const;
const CONFIG_KEYS = ['api_base', 'default_mode', 'default_max_sources'] as const;
const MODES = ['fast', 'standard', 'deep'] as const;
const COMPLETION_SHELLS = ['bash', 'zsh', 'fish'] as const;

const COMMON_FLAGS = ['--token', '--json', '--no-color', '--verbose', '--quiet', '--help'];
const QUERY_FLAGS = [
  '--mode',
  '--max-sources',
  '--domain',
  '--stream',
  '--no-wait',
  ...COMMON_FLAGS,
];
const LOGIN_FLAGS = ['--no-browser', '--verbose', '--help'];

export function bashCompletionScript(): string {
  const cmds = COMMANDS.join(' ');
  const cfgSubs = CONFIG_SUBCOMMANDS.join(' ');
  const cfgKeys = CONFIG_KEYS.join(' ');
  const modes = MODES.join(' ');
  const shells = COMPLETION_SHELLS.join(' ');
  const queryFlags = QUERY_FLAGS.join(' ');
  const loginFlags = LOGIN_FLAGS.join(' ');
  const commonFlags = COMMON_FLAGS.join(' ');

  return `# bash completion for quelvio
_quelvio_completions() {
  local cur prev words cword
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local sub="\${COMP_WORDS[1]}"

  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${cmds} --version --help" -- "\${cur}") )
    return 0
  fi

  case "\${prev}" in
    --mode)
      COMPREPLY=( $(compgen -W "${modes}" -- "\${cur}") )
      return 0
      ;;
    --domain)
      COMPREPLY=()
      return 0
      ;;
  esac

  case "\${sub}" in
    query)
      COMPREPLY=( $(compgen -W "${queryFlags}" -- "\${cur}") )
      ;;
    login)
      COMPREPLY=( $(compgen -W "${loginFlags}" -- "\${cur}") )
      ;;
    logout|whoami|domains|source)
      COMPREPLY=( $(compgen -W "${commonFlags}" -- "\${cur}") )
      ;;
    completion)
      if [ "$COMP_CWORD" -eq 2 ]; then
        COMPREPLY=( $(compgen -W "${shells}" -- "\${cur}") )
      fi
      ;;
    config)
      if [ "$COMP_CWORD" -eq 2 ]; then
        COMPREPLY=( $(compgen -W "${cfgSubs}" -- "\${cur}") )
      elif [ "$COMP_CWORD" -eq 3 ]; then
        COMPREPLY=( $(compgen -W "${cfgKeys}" -- "\${cur}") )
      fi
      ;;
  esac
  return 0
}
complete -F _quelvio_completions quelvio
`;
}

export function zshCompletionScript(): string {
  const cmds = COMMANDS.join(' ');
  const cfgSubs = CONFIG_SUBCOMMANDS.join(' ');
  const cfgKeys = CONFIG_KEYS.join(' ');
  const modes = MODES.join(' ');
  const shells = COMPLETION_SHELLS.join(' ');
  const queryFlags = QUERY_FLAGS.join(' ');
  const loginFlags = LOGIN_FLAGS.join(' ');
  const commonFlags = COMMON_FLAGS.join(' ');

  return `#compdef quelvio
# zsh completion for quelvio

_quelvio() {
  local -a commands modes shells cfg_subs cfg_keys
  commands=(${cmds})
  modes=(${modes})
  shells=(${shells})
  cfg_subs=(${cfgSubs})
  cfg_keys=(${cfgKeys})

  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi

  local sub="\${words[2]}"

  if [[ "\${words[CURRENT-1]}" == "--mode" ]]; then
    _values 'mode' \${modes}
    return
  fi

  case "\${sub}" in
    query)
      _values 'flag' ${queryFlags}
      ;;
    login)
      _values 'flag' ${loginFlags}
      ;;
    logout|whoami|domains|source)
      _values 'flag' ${commonFlags}
      ;;
    completion)
      if (( CURRENT == 3 )); then
        _values 'shell' \${shells}
      fi
      ;;
    config)
      if (( CURRENT == 3 )); then
        _values 'subcommand' \${cfg_subs}
      elif (( CURRENT == 4 )); then
        _values 'key' \${cfg_keys}
      fi
      ;;
  esac
}

compdef _quelvio quelvio
`;
}

export function fishCompletionScript(): string {
  const lines: string[] = [
    '# fish completion for quelvio',
    'complete -c quelvio -f',
    '',
    '# Top-level commands (only when no subcommand is set yet)',
  ];
  for (const cmd of COMMANDS) {
    lines.push(`complete -c quelvio -n "__fish_use_subcommand" -a "${cmd}" -d "${cmd} subcommand"`);
  }
  lines.push(
    'complete -c quelvio -n "__fish_use_subcommand" -l version -d "show version"',
    'complete -c quelvio -n "__fish_use_subcommand" -l help -d "show help"',
    '',
    '# query subcommand flags',
  );
  for (const flag of QUERY_FLAGS) {
    if (flag === '--mode') {
      lines.push(
        `complete -c quelvio -n "__fish_seen_subcommand_from query" -l mode -xa "${MODES.join(' ')}"`,
      );
    } else if (flag === '--max-sources') {
      lines.push('complete -c quelvio -n "__fish_seen_subcommand_from query" -l max-sources -x');
    } else if (flag === '--domain') {
      lines.push('complete -c quelvio -n "__fish_seen_subcommand_from query" -l domain -x');
    } else if (flag === '--token') {
      lines.push('complete -c quelvio -n "__fish_seen_subcommand_from query" -l token -x');
    } else {
      lines.push(`complete -c quelvio -n "__fish_seen_subcommand_from query" -l ${flag.slice(2)}`);
    }
  }
  lines.push('', '# completion subcommand');
  lines.push(
    `complete -c quelvio -n "__fish_seen_subcommand_from completion" -a "${COMPLETION_SHELLS.join(' ')}"`,
  );
  lines.push('', '# config subcommand');
  lines.push(
    `complete -c quelvio -n "__fish_seen_subcommand_from config" -a "${CONFIG_SUBCOMMANDS.join(' ')}"`,
  );
  return `${lines.join('\n')}\n`;
}

export function completionScriptFor(shell: string): string {
  switch (shell) {
    case 'bash':
      return bashCompletionScript();
    case 'zsh':
      return zshCompletionScript();
    case 'fish':
      return fishCompletionScript();
    default:
      throw new GenericError(
        `unsupported shell '${shell}'. Expected one of: ${COMPLETION_SHELLS.join(', ')}`,
      );
  }
}

export function registerCompletionCommand(program: Command): void {
  const completion = program
    .command('completion')
    .description(
      'Print a shell completion script. Run `quelvio completion --help` for install hints.',
    );

  for (const shell of COMPLETION_SHELLS) {
    completion
      .command(shell)
      .description(`Output ${shell} completion script to stdout.`)
      .action(() => {
        process.stdout.write(completionScriptFor(shell));
      });
  }

  completion.action(() => {
    process.stderr.write(
      'usage: quelvio completion <bash|zsh|fish>\n' +
        'Install hints:\n' +
        "  bash: echo 'source <(quelvio completion bash)' >> ~/.bashrc\n" +
        "  zsh:  echo 'source <(quelvio completion zsh)' >> ~/.zshrc\n" +
        '  fish: quelvio completion fish > ~/.config/fish/completions/quelvio.fish\n',
    );
    process.exitCode = 1;
  });
}
