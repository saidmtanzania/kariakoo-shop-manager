/**
 * Architecture rules (docs/architecture/system-architecture.md section 4.1).
 * Run from the repository root: pnpm test:architecture
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular imports make module boundaries meaningless.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'web-not-into-backend',
      severity: 'error',
      comment:
        'The web app talks to the API over HTTP only; server code never ships to browsers.',
      from: { path: '^apps/web/' },
      to: { path: '^backend/' },
    },
    {
      name: 'backend-not-into-web',
      severity: 'error',
      from: { path: '^backend/' },
      to: { path: '^apps/web/' },
    },
    {
      name: 'shared-stays-leaf',
      severity: 'error',
      comment:
        'packages/shared holds safe contracts only and must not depend on either app.',
      from: { path: '^packages/shared/' },
      to: { path: '^(backend|apps)/' },
    },
    {
      name: 'module-internals-are-private',
      severity: 'error',
      comment:
        'A business module may use another module only through its exported services, ' +
        'never its controllers, repositories, domain internals or DTOs.',
      from: { path: '^backend/src/modules/([^/]+)/' },
      to: {
        path: '^backend/src/modules/[^/]+/(controllers|repositories|domain|dto)/',
        pathNot: '^backend/src/modules/$1/',
      },
    },
    {
      name: 'prisma-client-behind-data-access',
      severity: 'error',
      comment:
        'Only the database module and module repositories may import the generated Prisma ' +
        'client, so tenant scoping can be enforced in one layer.',
      from: {
        path: '^backend/src/',
        pathNot: [
          '^backend/src/database/',
          '^backend/src/modules/[^/]+/repositories/',
          '^backend/src/generated/',
        ],
      },
      to: { path: '^backend/src/generated/prisma/' },
    },
    {
      name: 'common-is-not-business-logic',
      severity: 'error',
      comment:
        'common/ is shared infrastructure; it must not depend on business modules.',
      from: { path: '^backend/src/common/' },
      to: { path: '^backend/src/modules/' },
    },
  ],
  options: {
    doNotFollow: { path: ['node_modules', '^backend/src/generated/'] },
    exclude: { path: ['\\.next/', '/dist/'] },
    tsPreCompilationDeps: true,
    // Resolves the web app's '@/...' alias.
    tsConfig: { fileName: 'tests/architecture/tsconfig.depcruise.json' },
  },
};
