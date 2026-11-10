import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, keccak256, toHex } from 'viem';
import { Abis, Transaction } from 'viem/tempo';

// Simulate only the Tempo RPC boundary. Client signing, receipt verification and
// replay protection still run in the SDK. Unknown external requests fail closed.
export function mockTempoRpc(t) {
  const nativeFetch = globalThis.fetch;
  const submissions = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const request = new Request(input, init);
    const { hostname } = new URL(request.url);
    if (hostname === '127.0.0.1') return nativeFetch(request);
    if (hostname !== 'rpc.moderato.tempo.xyz') throw new Error('Unexpected external request');
    const { id, method, params } = await request.json();
    const reply = (result) => Response.json({ jsonrpc: '2.0', id, result });
    switch (method) {
      case 'eth_chainId': return reply(toHex(42431));
      case 'eth_getTransactionCount': return reply('0x0');
      case 'eth_gasPrice':
      case 'eth_maxPriorityFeePerGas': return reply('0x1');
      case 'eth_estimateGas': return reply('0x186a0');
      case 'eth_getBlockByNumber': return reply({ number: '0x1', timestamp: toHex(Math.floor(Date.now() / 1000)), baseFeePerGas: '0x1', transactions: [] });
      case 'eth_call': return reply('0x');
      case 'eth_sendRawTransactionSync': {
        const [serialized] = params;
        const tx = Transaction.deserialize(serialized);
        const transactionHash = keccak256(serialized);
        const [call] = tx.calls;
        const { functionName, args } = decodeFunctionData({ abi: Abis.tip20, data: call.data });
        if (functionName !== 'transferWithMemo') throw new Error('Expected a challenge-bound transfer');
        const [to, amount, memo] = args;
        const eventName = 'TransferWithMemo';
        const event = Abis.tip20.find((item) => item.type === 'event' && item.name === eventName);
        const eventArgs = { from: tx.from, to, amount, memo };
        submissions.push({ from: tx.from.toLowerCase(), to: to.toLowerCase(), amount, currency: call.to });
        return reply({ transactionHash, status: '0x1', from: tx.from, to: call.to, blockNumber: '0x1',
          logs: [{
            address: call.to, logIndex: '0x0', transactionHash,
            topics: encodeEventTopics({ abi: [event], eventName, args: eventArgs }),
            data: encodeAbiParameters(event.inputs.filter((param) => !param.indexed),
              event.inputs.filter((param) => !param.indexed).map((param) => eventArgs[param.name])),
          }],
        });
      }
      default: return Response.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unexpected test RPC: ${method}` } });
    }
  });
  return submissions;
}
