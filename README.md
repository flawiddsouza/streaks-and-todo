# Streaks & Todo

A simple habit / streak tracking and todo management application.

## Tech Stack

**Backend:**
- [Bun](https://bun.sh/) - JavaScript runtime and package manager
- [Elysia](https://elysiajs.com/) - Fast and type-safe web framework
- [Drizzle ORM](https://orm.drizzle.team/) - TypeScript ORM
- PostgreSQL - Database

**Frontend:**
- React 18 with TypeScript
- [React Router](https://reactrouter.com/) - Client-side routing
- [React Virtuoso](https://virtuoso.dev/) - Virtualized table for performance
- [Day.js](https://day.js.org/) - Date manipulation
- [Farm](https://www.farmfe.org/) - Build tool (Vite-compatible)

## Development

### To start the development servers for api & ui

```bash
bun dev:all
```

API will be running at http://localhost:9008<br>
UI will be running at http://localhost:9000

### DB schema update

```bash
bun db:update
```

### Format code

```bash
bun format
```

## Production

```bash
docker compose up -d
```

### Migration
```bash
docker compose exec backend bun run db:update
```
