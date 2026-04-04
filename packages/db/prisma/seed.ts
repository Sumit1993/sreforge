import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://todo:todopass@127.0.0.1:5432/tododb';
const pool = new pg.Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const seedTodos = [
  { todo: 'Do something nice for someone I care about', completed: true, userId: 1 },
  { todo: 'Memorize the fifty states and their capitals', completed: false, userId: 1 },
  { todo: 'Watch a classic movie', completed: false, userId: 1 },
  { todo: 'Contribute code or a monetary donation to an open-source software project', completed: false, userId: 1 },
  { todo: 'Resolve a problem I\'ve been procrastinating on', completed: false, userId: 1 },
  { todo: 'Read a book', completed: true, userId: 1 },
  { todo: 'Learn a new programming language', completed: false, userId: 2 },
  { todo: 'Write a blog post about TypeScript', completed: false, userId: 2 },
  { todo: 'Set up a CI/CD pipeline', completed: true, userId: 2 },
  { todo: 'Review pull requests from teammates', completed: true, userId: 2 },
  { todo: 'Refactor the authentication module', completed: false, userId: 2 },
  { todo: 'Update project dependencies', completed: false, userId: 2 },
  { todo: 'Organize my workspace', completed: true, userId: 3 },
  { todo: 'Plan a weekend trip', completed: false, userId: 3 },
  { todo: 'Cook a new recipe', completed: false, userId: 3 },
  { todo: 'Exercise for 30 minutes', completed: true, userId: 3 },
  { todo: 'Clean out email inbox', completed: false, userId: 3 },
  { todo: 'Call a friend I haven\'t spoken to in a while', completed: false, userId: 3 },
  { todo: 'Deploy the application to production', completed: false, userId: 4 },
  { todo: 'Write unit tests for the API', completed: true, userId: 4 },
  { todo: 'Fix the caching bug in the todo service', completed: false, userId: 4 },
  { todo: 'Set up Prometheus monitoring', completed: true, userId: 4 },
  { todo: 'Configure Grafana dashboards', completed: false, userId: 4 },
  { todo: 'Document the API endpoints', completed: false, userId: 4 },
  { todo: 'Learn Kubernetes basics', completed: false, userId: 1 },
  { todo: 'Set up Docker Compose for local development', completed: true, userId: 2 },
  { todo: 'Implement rate limiting on the API', completed: false, userId: 3 },
  { todo: 'Add health check endpoint', completed: true, userId: 4 },
  { todo: 'Investigate memory leak in production', completed: false, userId: 1 },
  { todo: 'Create a load testing script', completed: false, userId: 2 },
];

async function main() {
  console.log('Seeding database...');

  await prisma.todo.deleteMany();

  for (const todo of seedTodos) {
    await prisma.todo.create({ data: todo });
  }

  console.log(`Seeded ${seedTodos.length} todos.`);
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
