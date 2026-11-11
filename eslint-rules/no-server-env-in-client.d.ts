import type { Rule } from 'eslint';

declare const plugin: { rules: { 'no-server-env-in-client': Rule.RuleModule } };
export default plugin;
