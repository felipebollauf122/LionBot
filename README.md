This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Copy the environment template first — it is tracked as `env.example`
(**no** leading dot: the `.env*` rule in `.gitignore` swallows any
`.env.example`, so such a file never reaches a clone):

```bash
cp env.example .env.local
```

Four of those variables are what the automations need, and getting them
wrong reads as a broken product rather than as missing configuration:

- `NEXT_PUBLIC_BOT_SERVER_URL` — URL of the bot-server in `server/`. Every
  Server Action reaches `/api/mtproto/enqueue`,
  `/api/mtproto/ensure-bot-access` and `/api/ai/assist` through it. The
  design doc §5.1 calls it `BOT_SERVER_URL`; the code has always read the
  `NEXT_PUBLIC_` name, and that is the one that works.
- `INTERNAL_API_SECRET` — shared secret, **identical** to the one in
  `server/.env`. An unset secret NEVER authorises: the bot-promotion button
  and all three AI assistant buttons answer 503 forever.
  Suba nos DOIS lados ao mesmo tempo: esse segredo protege o endpoint que
  transporta login MTProto, sync de diálogos, Mass DM, clone de canal e
  clone de bot — não só as campanhas. Subir de um lado só derruba todos.
- `GEMINI_API_KEY` / `GEMINI_MODEL` — worker only, in `server/.env`. See
  [`server/README.md`](./server/README.md) and
  [`server/env.example`](./server/env.example).

Then, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
