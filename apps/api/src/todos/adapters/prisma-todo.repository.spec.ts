import { PrismaTodoRepository } from './prisma-todo.repository';

const mockTodo = {
  id: 1,
  todo: 'Test todo',
  completed: false,
  userId: 42,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

function createMockPrisma() {
  return {
    todo: {
      findMany: jest.fn().mockResolvedValue([mockTodo]),
      findUnique: jest.fn().mockResolvedValue(mockTodo),
      create: jest.fn().mockResolvedValue(mockTodo),
      update: jest.fn().mockResolvedValue({ ...mockTodo, completed: true }),
      delete: jest.fn().mockResolvedValue(mockTodo),
    },
  } as any;
}

describe('PrismaTodoRepository', () => {
  let repo: PrismaTodoRepository;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    repo = new PrismaTodoRepository(prisma);
  });

  describe('findAll', () => {
    it('returns all todos ordered by id asc', async () => {
      const result = await repo.findAll();
      expect(prisma.todo.findMany).toHaveBeenCalledWith({
        orderBy: { id: 'asc' },
      });
      expect(result).toEqual([mockTodo]);
    });
  });

  describe('findById', () => {
    it('returns a todo by id', async () => {
      const result = await repo.findById(1);
      expect(prisma.todo.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual(mockTodo);
    });

    it('coerces string id to number', async () => {
      await repo.findById('5' as any);
      expect(prisma.todo.findUnique).toHaveBeenCalledWith({ where: { id: 5 } });
    });

    it('returns null when not found', async () => {
      prisma.todo.findUnique.mockResolvedValue(null);
      const result = await repo.findById(999);
      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('creates a todo with completed=false', async () => {
      await repo.create({ todo: 'New todo', userId: 10 });
      expect(prisma.todo.create).toHaveBeenCalledWith({
        data: {
          todo: 'New todo',
          completed: false,
          userId: 10,
        },
      });
    });
  });

  describe('update', () => {
    it('updates completed status', async () => {
      const result = await repo.update(1, { completed: true });
      expect(prisma.todo.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { completed: true },
      });
      expect(result.completed).toBe(true);
    });
  });

  describe('delete', () => {
    it('deletes and returns the deleted todo', async () => {
      const result = await repo.delete(1);
      expect(prisma.todo.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual(mockTodo);
    });
  });
});
