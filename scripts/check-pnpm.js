if (!process.env.npm_execpath || !process.env.npm_execpath.includes('pnpm')) {
  console.error('This project requires pnpm. Install it with: corepack enable pnpm');
  process.exit(1);
}
