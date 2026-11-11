/**
 * Client components ('use client') may only read NEXT_PUBLIC_* environment variables.
 * Anything else would either be undefined in the browser or, worse, get inlined into the
 * client bundle. Complements `import 'server-only'` and scripts/check-client-secrets.mjs.
 */
const ALLOWED = /^(NEXT_PUBLIC_[A-Z0-9_]+|NODE_ENV)$/;

function isProcessEnv(node) {
  return (
    node?.type === 'MemberExpression' &&
    node.object.type === 'Identifier' &&
    node.object.name === 'process' &&
    !node.computed &&
    node.property.type === 'Identifier' &&
    node.property.name === 'env'
  );
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow non-public env vars in client components' },
    schema: [],
    messages: {
      serverEnv:
        'process.env.{{name}} is not public. Client components may only read NEXT_PUBLIC_* variables.',
      wholeEnv: 'Do not read process.env as a whole in a client component.',
    },
  },
  create(context) {
    const isClient = context.sourceCode.ast.body.some(
      (n) => n.type === 'ExpressionStatement' && n.directive === 'use client',
    );
    if (!isClient) return {};

    return {
      MemberExpression(node) {
        if (isProcessEnv(node.object)) {
          const name = node.computed
            ? node.property.type === 'Literal'
              ? String(node.property.value)
              : null
            : node.property.name;
          if (name === null || !ALLOWED.test(name)) {
            context.report({ node, messageId: 'serverEnv', data: { name: name ?? '[computed]' } });
          }
          return;
        }
        if (isProcessEnv(node) && node.parent?.type !== 'MemberExpression') {
          context.report({ node, messageId: 'wholeEnv' });
        }
      },
    };
  },
};

const plugin = { rules: { 'no-server-env-in-client': rule } };

export default plugin;
