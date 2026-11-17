#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { attestKey, createChallenge, verifyKeyAttestation } from './lib/firebase-key-attestation.mjs';

export function main(args, input, env = process.env) {
  if (args.length !== 1) throw new Error('ATTESTATION_REJECTED');
  if (input.length > 131_072) throw new Error('ATTESTATION_REJECTED');
  const data = JSON.parse(input);
  switch (args[0]) {
    case 'challenge': return createChallenge(data);
    case 'attest': return attestKey(data, env);
    case 'verify': return verifyKeyAttestation(data.proof, data.challenge, data.trustedKeys);
    default: throw new Error('ATTESTATION_REJECTED');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    // Input is bounded before parsing. Never accept credentials in arguments.
    const buffer = Buffer.alloc(131_073);
    const { readSync } = await import('node:fs');
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(0, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > 131_072) throw new Error();
    const result = main(process.argv.slice(2), buffer.subarray(0, length).toString('utf8'));
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch {
    // No raw parser/crypto errors: these can contain portions of a secret.
    process.stderr.write('ATTESTATION_REJECTED\n');
    process.exitCode = 1;
  }
}
