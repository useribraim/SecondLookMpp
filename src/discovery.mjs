import { EXAMPLE, MPPX } from './pages.mjs';

const idPattern = '[A-Za-z0-9_-]{22}';
const tokenPattern = '[A-Za-z0-9_-]{43}';

const routes = [
  ['GET', '/', 'landing', 'Open the service homepage', 'text/html'],
  ['GET', '/health', 'health', 'Check service health and source configuration', 'application/json'],
  ['GET', '/favicon.svg', 'favicon', 'Fetch the service icon', 'image/svg+xml'],
  ['GET', '/share.png', 'share', 'Fetch the service preview image', 'image/png'],
  ...['/SKILL.md', '/skill.md', '/agents.md', '/AGENTS.md'].map((path, i) =>
    ['GET', path, 'agents', 'Read the agent instructions', 'text/markdown', `agentInstructions${i + 1}`]),
  ['GET', '/llms.txt', 'llms', 'Discover the paid search workflow', 'text/plain'],
  ['GET', '/openapi.json', 'openapi', 'Read this API description', 'application/json'],
  ['POST', '/v1/searches/quote', 'quote', 'Check price and source availability for free', 'application/json'],
  ['POST', '/v1/searches', 'create', 'Buy one car search', 'application/json'],
  ['GET', '/v1/searches/{searchId}', 'status', 'Read the search status and report', 'application/json'],
  ['GET', '/v1/searches/{searchId}/events', 'events', 'Read incremental search events', 'application/json'],
  ['GET', '/searches/{searchId}', 'report', 'Open the HTML search report', 'text/html'],
  ['GET', '/searches/{searchId}/live.jpg', 'live', 'Read the latest live browser frame', 'image/jpeg'],
  ['GET', '/searches/{searchId}/live.frames', 'liveFrames', 'Stream view-only browser frames', 'application/octet-stream'],
].map(([method, path, name, summary, mediaType, operationId = name]) => {
  const pattern = path.replaceAll('.', '\\.').replace('{searchId}', `(${idPattern})`);
  return { method, path, name, summary, mediaType, operationId, match: new RegExp(`^${pattern}$`) };
});

export function resolveRoute(pathname) {
  for (const route of routes) {
    const match = route.match.exec(pathname);
    if (match) return { ...route, id: match[1] };
  }
}

export function describe(origin, price, chainId, card) {
  return `# Car listing search

> Searches DoneDeal and Facebook Marketplace for used cars in Ireland, compares asking prices where there are enough comparable ads, and returns ranked finds with reasons and checks to make before a viewing.

1. Quote for free. POST your criteria to ${origin}/v1/searches/quote and check \`canPay\`.
2. Buy one search for ${price} test pathUSD using MPP on Tempo Moderato (${chainId}). ${card ? `Or pay ${Number(card.price).toFixed(2)} ${card.currency.toUpperCase()} by card through a Stripe Shared Payment Token. ` : ''}POST the same criteria to ${origin}/v1/searches. Answer the 402 Payment challenge with an MPP client. The 202 contains \`searchId\` and \`accessToken\`.
3. Give the buyer the \`progressPage\` link from the 202. It carries the access token and opens the live progress page directly.
4. Poll the status endpoint for free using the Bearer token. It expires after 24 hours. A failed required source triggers a refund attempt: on testnet for Tempo, or through Stripe for a card.

Quote:

\`\`\`sh
curl -sS -H 'Content-Type: application/json' -d '${JSON.stringify(EXAMPLE)}' \\
  ${origin}/v1/searches/quote
\`\`\`

Pay with a funded testnet account:

\`\`\`sh
${MPPX} ${origin}/v1/searches --account car-search --network testnet \\
  -J '${JSON.stringify(EXAMPLE)}'
\`\`\`

Poll with the values from the 202:

\`\`\`sh
curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \\
  "${origin}/v1/searches/$SEARCH_ID"
\`\`\`

- [Agent instructions](${origin}/agents.md)
- [OpenAPI](${origin}/openapi.json)
`;
}

const string = { type: 'string' };
const count = { type: 'integer', minimum: 0 };
const object = { type: 'object' };
const dateTime = { type: 'string', format: 'date-time' };
const state = { type: 'string', enum: ['queued', 'running', 'done', 'failed'] };
const searchId = { type: 'string', pattern: `^${idPattern}$` };
const searchToken = { type: 'string', pattern: `^${tokenPattern}$` };
const source = { type: 'string', enum: ['donedeal', 'facebook'] };
const sources = { type: 'array', items: source };
const sourceStatus = { type: 'string', enum: ['available', 'not_configured', 'rate_limited'] };
const integer = (minimum, maximum) => ({ type: ['integer', 'null'], minimum, maximum });
const exampleId = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, 22);
const exampleToken = 'A'.repeat(43);
const exampleReport = { shortlist: [], confident: [], uncertain: [], cheapForAReason: [] };
const criteria = {
  type: 'object', required: ['vehicles', 'priceMaxEur'], additionalProperties: false,
  properties: {
    vehicles: { type: 'array', minItems: 1, maxItems: 4, items: {
      type: 'object', required: ['make'], properties: {
        make: { type: 'string', minLength: 1, maxLength: 40 },
        model: { type: 'string', minLength: 1, maxLength: 40 },
      },
    } },
    yearFrom: integer(1950, new Date().getUTCFullYear()),
    yearTo: integer(1950, new Date().getUTCFullYear()),
    priceMinEur: integer(0, 200_000),
    priceMaxEur: { type: 'integer', minimum: 500, maximum: 200_000 },
    mileageMaxKm: integer(1_000, 1_000_000),
    seatsMin: integer(1, 20),
    engineLitres: { type: 'number', minimum: 0.6, maximum: 8, description: 'Engine size in litres, for example 3.0. Ads that state a different size are rejected.' },
    fuelTypes: { type: 'array', minItems: 1, items: { type: 'string', description: 'Petrol, Diesel, Electric, Petrol Hybrid, Diesel Hybrid, or Petrol Plug-in Hybrid (case-insensitive).' } },
    county: { type: 'string', description: 'Irish county name, for example Dublin.' },
    sources: { ...sources, type: ['array', 'null'], minItems: 1, default: ['donedeal', 'facebook'] },
  },
};
const jsonResponse = (description, schema, example) => ({
  description, content: { 'application/json': { schema, ...(example === undefined ? {} : { example }) } },
});
const error = (description) => jsonResponse(description, { type: 'object', required: ['error'], properties: { error: string } });

export function openapi(origin, { price, amount, recipient, currency, chainId, card }) {
  const offer = { method: 'tempo', intent: 'charge', amount, currency, recipient,
    methodDetails: { chainId, supportedModes: ['pull'] } };
  const cardOffer = card && { method: 'stripe', intent: 'charge', amount: String(Math.round(Number(card.price) * 100)), currency: card.currency,
    methodDetails: { networkId: card.networkId, paymentMethodTypes: ['card'] } };
  const requestBody = { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SearchCriteria' }, example: EXAMPLE } } };
  const quote = { type: 'object', required: ['price', 'currency', 'chainId', 'testnet', 'sources', 'requiredSources', 'availableSources', 'canPay'],
    properties: { price: string, currency: string, chainId: count, testnet: { const: true },
      sources: { type: 'object', properties: { donedeal: sourceStatus, facebook: sourceStatus } },
      requiredSources: sources, availableSources: sources, canPay: { type: 'boolean' }, reason: string },
  };
  const paths = {};
  for (const route of routes) {
    const { path, method, name, summary, mediaType, operationId } = route;
    const protectedRoute = path.includes('{searchId}');
    const operation = {
      operationId, summary, security: protectedRoute ? [{ searchAccess: [] }] : [],
      responses: { 200: { description: summary, content: { [mediaType]: { schema: mediaType === 'application/json' ? object : string } } } },
    };
    if (protectedRoute) {
      operation.parameters = [{ name: 'searchId', in: 'path', required: true, schema: searchId }];
      const description = 'Unknown search or missing, invalid, or expired access token';
      operation.responses[404] = mediaType === 'application/json' ? error(description) : { description };
    }
    if (name === 'quote') {
      operation.requestBody = requestBody;
      operation.responses[200] = jsonResponse('Current offer and source availability', quote,
        { price, currency, chainId, testnet: true, sources: { donedeal: 'available', facebook: 'not_configured' },
          requiredSources: ['donedeal'], availableSources: ['donedeal'], canPay: true });
      operation.responses[400] = error('Invalid criteria');
    }
    if (name === 'create') {
      operation.requestBody = requestBody;
      operation['x-payment-info'] = { offers: cardOffer ? [offer, cardOffer] : [offer] };
      operation.responses = {
        202: { ...jsonResponse('Payment verified and search accepted', {
          type: 'object', required: ['searchId', 'accessToken', 'progressPage', 'message'], additionalProperties: false,
          properties: { searchId, accessToken: { ...searchToken, description: 'Private Bearer token valid for 24 hours.' },
            progressPage: { type: 'string', format: 'uri', description: 'Page that shows the progress and the report. The link carries the access token in its fragment, so keep it private.' },
            message: { ...string, description: 'Instruction to give to the buyer.' } },
        }, { searchId: exampleId, accessToken: exampleToken, progressPage: `${origin}/searches/${exampleId}#access=${exampleToken}`,
          message: `To track the progress of this search, open ${origin}/searches/${exampleId} in a browser and enter the access token.` }),
          headers: { 'Payment-Receipt': { description: 'MPP receipt', schema: string } } },
        400: error('Invalid criteria. Payment was not requested.'),
        402: {
          description: 'MPP payment required. Read the challenge and retry with an Authorization: Payment credential.',
          headers: { 'WWW-Authenticate': { description: 'MPP Payment challenge', schema: string } },
          content: { 'application/problem+json': { schema: object } },
        },
        503: { ...jsonResponse('Search unavailable. Payment was not requested.', {
          type: 'object', properties: { error: string, offer: quote },
        }), headers: { 'Retry-After': { description: 'Seconds before retrying', schema: count } } },
      };
    }
    if (name === 'status') {
      operation.responses[200] = jsonResponse('Search progress or final result', {
        type: 'object', required: ['searchId', 'state', 'createdAt', 'updatedAt'],
        properties: { searchId, state, queuePosition: count, progress: string, live: object,
          reportPage: { type: 'string', format: 'uri' }, createdAt: dateTime, updatedAt: dateTime,
          error: string, refund: object, report: {
            type: 'object', properties: { shortlist: { type: 'array', items: string },
              confident: { type: 'array', items: object }, uncertain: { type: 'array', items: object },
              cheapForAReason: { type: 'array', items: object } },
          },
        },
      }, { searchId: exampleId, state: 'done', progress: 'done',
        createdAt: '2026-11-10T12:00:00.000Z', updatedAt: '2026-11-10T12:01:00.000Z', report: exampleReport });
    }
    if (name === 'events') {
      operation.parameters.push({ name: 'after', in: 'query', schema: { ...count, default: 0 }, description: 'Return events with sequence numbers greater than this value.' });
      operation.responses[200] = jsonResponse('Search progress and events since the cursor', {
        type: 'object', required: ['state', 'events'], properties: { state, progress: string, queuePosition: count, live: object,
          events: { type: 'array', items: object } },
      }, { state: 'running', progress: 'starting', events: [] });
    }
    paths[path] = { [method.toLowerCase()]: operation };
  }

  return {
    openapi: '3.1.0',
    info: { title: 'Car listing search', version: '0.2.0', description: 'Paid search and shortlist of Irish used-car listings (testnet MPP).' },
    servers: [{ url: origin }],
    'x-service-info': { docs: { homepage: `${origin}/`, apiReference: `${origin}/openapi.json`, llms: `${origin}/llms.txt` } },
    paths,
    components: {
      schemas: { SearchCriteria: criteria },
      securitySchemes: { searchAccess: { type: 'http', scheme: 'bearer', description: 'Search access token returned by the paid POST.' } },
    },
  };
}
