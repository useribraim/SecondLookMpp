// Create the service's testnet configuration in .env (mode 0600). Refuses to overwrite.
// The seller key is kept so the service can send testnet refunds. Testnet only: never fund it on mainnet.
import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

if (existsSync('.env')) {
  console.error('.env already exists; not overwriting.');
  process.exit(1);
}
const sellerKey = generatePrivateKey();
const seller = privateKeyToAccount(sellerKey);
writeFileSync('.env', [
  '# Testnet only (Tempo Moderato, chain 42431). Never fund these keys on mainnet.',
  `MPP_SECRET_KEY=${randomBytes(32).toString('hex')}`,
  `TEMPO_RECIPIENT=${seller.address}`,
  `TEMPO_SELLER_KEY=${sellerKey}`,
  '# Buyer wallet for the demo agent (scripts/buy_search.mjs). Funded from the free testnet faucet.',
  `BUYER_PRIVATE_KEY=${generatePrivateKey()}`,
  'BUYER_MAX_PRICE=0.10',
  'SEARCH_PRICE=0.05',
  'PORT=4320',
  '# ANTHROPIC_API_KEY=  (add your key here to enable photo and text inspection)',
  '# BOAT_SANDBOX_ID=    (add after the Facebook sandbox is set up)',
  '',
].join('\n'), { mode: 0o600 });
console.log(`Created .env. Seller (recipient) address: ${seller.address}`);
