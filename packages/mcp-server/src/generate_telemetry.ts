import path from 'path';
import process from 'process';
import { generate_telemetry_panel } from './tools';

function parseArgs(argv: string[]): { root?: string; output?: string } {
  const result: { root?: string; output?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--root=')) {
      result.root = arg.slice('--root='.length);
    } else if (arg === '--root' && argv[i + 1]) {
      result.root = argv[++i];
    } else if (arg.startsWith('--output=')) {
      result.output = arg.slice('--output='.length);
    } else if (arg === '--output' && argv[i + 1]) {
      result.output = argv[++i];
    }
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = args.root ? path.resolve(args.root) : process.cwd();
  const result = generate_telemetry_panel(repoRoot, args.output);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

main();

