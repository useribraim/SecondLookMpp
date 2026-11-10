// Prepare, broadcast and confirm a testnet refund of a failed search.
// The payer is read from the confirmed payment transaction, not from anything the client claims.
import { createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, parseAbi, parseEventLogs, TransactionReceiptNotFoundError } from 'viem';
import { tempoModerato } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const RPC_URL = 'https://rpc.moderato.tempo.xyz';
const tokenAbi = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function transfer(address to, uint256 value) returns (bool)',
]);

function parseReceipt(receiptHeader) {
  if (!receiptHeader) return undefined;
  try { return JSON.parse(Buffer.from(receiptHeader, 'base64url').toString('utf8')); } catch { return undefined; }
}

export function receiptMethod(receiptHeader) {
  return parseReceipt(receiptHeader)?.method;
}

// Tempo receipts reference a transaction hash. Stripe receipts reference a PaymentIntent.
export function receiptReference(receiptHeader, method = 'tempo') {
  const reference = parseReceipt(receiptHeader)?.reference ?? '';
  const pattern = method === 'stripe' ? /^pi_[A-Za-z0-9]+$/ : /^0x[0-9a-f]{64}$/i;
  return pattern.test(reference) ? reference : undefined;
}

// Refund a card payment in full through the Stripe Refunds API.
export async function refundCardPayment({ reference, secretKey, idempotencyKey }) {
  if (!reference) return { state: 'failed', error: 'Payment receipt does not contain a PaymentIntent reference.' };
  const response = await fetch('https://api.stripe.com/v1/refunds', {
    method: 'POST',
    headers: { authorization: `Bearer ${secretKey}`, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': idempotencyKey },
    body: new URLSearchParams({ payment_intent: reference, reason: 'requested_by_customer' }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status >= 500) throw new Error(`Stripe refund error ${response.status}`); // retried later
  if (!response.ok || !['succeeded', 'pending'].includes(body.status)) {
    return { state: 'failed', method: 'stripe', paymentIntent: reference, error: body.error?.message ?? `Stripe refund status: ${body.status}` };
  }
  return { state: 'sent', method: 'stripe', paymentIntent: reference, refund: body.id, amount: String(body.amount), currency: body.currency };
}

async function testnetClient() {
  const transport = http(RPC_URL, { timeout: 10_000, retryCount: 0 });
  const chain = createPublicClient({ chain: tempoModerato, transport });
  if (await chain.getChainId() !== tempoModerato.id) throw new Error('refusing refund: not Tempo Moderato testnet');
  return { chain, transport };
}

function tokenTransfers(receipt, currency) {
  return parseEventLogs({ abi: tokenAbi, eventName: 'Transfer',
    logs: receipt.logs.filter((log) => log.address.toLowerCase() === currency.toLowerCase()) });
}

export async function prepareRefund({ reference, sellerKey, recipient, currency }) {
  const { chain, transport } = await testnetClient();
  const paid = await chain.getTransactionReceipt({ hash: reference });
  const transfers = tokenTransfers(paid, currency)
    .filter(({ args }) => args.to.toLowerCase() === recipient.toLowerCase());
  if (paid.status !== 'success' || transfers.length !== 1 || transfers[0].args.value === 0n) {
    return { state: 'failed', error: 'Payment does not contain one confirmed transfer to the service.' };
  }
  const { from: payer, value } = transfers[0].args;

  const account = privateKeyToAccount(sellerKey);
  if (account.address.toLowerCase() !== recipient.toLowerCase()) throw new Error('seller key does not match the payment recipient');
  const wallet = createWalletClient({ account, chain: tempoModerato, transport });
  // One Tempo nonce lane per payment. Nonce zero is used only for that payment's refund.
  const nonceKey = BigInt(keccak256(reference)) % ((1n << 256n) - 2n) + 1n;
  const request = await wallet.prepareTransactionRequest({
    to: currency, data: encodeFunctionData({ abi: tokenAbi, functionName: 'transfer', args: [payer, value] }),
    feeToken: currency, nonceKey, nonce: 0,
  });
  const transaction = await wallet.signTransaction(request);
  return { state: 'prepared', hash: keccak256(transaction), payer, amount: value.toString(), transaction };
}

export async function confirmRefund({ hash, transaction, payer, amount }, { recipient, currency }) {
  const { chain } = await testnetClient();
  let refunded;
  try {
    refunded = await chain.getTransactionReceipt({ hash });
  } catch (error) {
    if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
    // A timed-out submission may already be in the mempool. Retry the same signed bytes.
    await chain.sendRawTransaction({ serializedTransaction: transaction }).catch(() => {});
    refunded = await chain.waitForTransactionReceipt({ hash, timeout: 15_000, checkReplacement: false });
  }
  const transfers = tokenTransfers(refunded, currency).filter(({ args }) =>
    args.from.toLowerCase() === recipient.toLowerCase() && args.to.toLowerCase() === payer.toLowerCase()
    && args.value === BigInt(amount));
  if (refunded.status !== 'success' || transfers.length !== 1) {
    return { state: 'failed', hash, error: 'Confirmed transaction did not return the paid amount.' };
  }
  return { state: 'sent', hash, payer, amount, block: refunded.blockNumber.toString() };
}

export function publicRefund(refund) {
  if (refund?.state !== 'prepared') return refund;
  return { state: 'sending', hash: refund.hash };
}
