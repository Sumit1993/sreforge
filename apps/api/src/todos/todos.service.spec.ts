import { TodosService } from './todos.service';

const mockTodo = {
  id: 1,
  todo: 'Test todo',
  completed: false,
  userId: 42,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

function createMockRepo() {
  return {
    findAll: jest.fn().mockResolvedValue([mockTodo]),
    findById: jest.fn().mockResolvedValue(mockTodo),
    create: jest.fn().mockResolvedValue(mockTodo),
    update: jest.fn().mockResolvedValue({ ...mockTodo, completed: true }),
    delete: jest.fn().mockResolvedValue(mockTodo),
  };
}

function createMockCacheProvider() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue(true),
  };
}

describe('TodosService', () => {
  let service: TodosService;
  let mockRepo: ReturnType<typeof createMockRepo>;
  let mockCache: ReturnType<typeof createMockCacheProvider>;

  beforeEach(() => {
    mockRepo = createMockRepo();
    mockCache = createMockCacheProvider();
    service = new TodosService(mockRepo as any, mockCache as any);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('getTodos', () => {
    it('fetches todos from repository when cache is empty', async () => {
      const result = await service.getTodos();
      expect(mockRepo.findAll).toHaveBeenCalled();
      expect(result).toEqual({
        todos: [mockTodo],
        total: 1,
        skip: 0,
        limit: 1,
      });
    });

    it('returns from Redis cache when available', async () => {
      const cached = { todos: [mockTodo], total: 1, skip: 0, limit: 1 };
      mockCache.get.mockResolvedValue(cached);

      const result = await service.getTodos();
      expect(mockRepo.findAll).not.toHaveBeenCalled();
      expect(result).toEqual(cached);
    });

    it('populates both caches after DB fetch', async () => {
      await service.getTodos();
      expect(mockCache.set).toHaveBeenCalledWith(
        'todos:all',
        expect.objectContaining({ todos: [mockTodo] }),
        60000,
      );
    });

    it('returns from in-memory cache on second call', async () => {
      await service.getTodos();
      mockRepo.findAll.mockClear();
      mockCache.get.mockClear();

      const result = await service.getTodos();
      expect(mockRepo.findAll).not.toHaveBeenCalled();
      expect(mockCache.get).not.toHaveBeenCalled();
      expect(result.todos).toEqual([mockTodo]);
    });

    it('throws when repository fails after retries', async () => {
      mockRepo.findAll.mockRejectedValue(new Error('DB down'));
      await expect(service.getTodos()).rejects.toThrow('DB down');
      expect(mockRepo.findAll).toHaveBeenCalledTimes(3);
    }, 10000);
  });

  describe('addTodo', () => {
    it('creates a todo and invalidates cache', async () => {
      const result = await service.addTodo('New todo', 42);
      expect(mockRepo.create).toHaveBeenCalledWith({ todo: 'New todo', userId: 42 });
      expect(mockCache.delete).toHaveBeenCalledWith('todos:all');
      expect(result).toEqual(mockTodo);
    });
  });

  describe('toggleTodoStatus', () => {
    it('updates todo and invalidates cache', async () => {
      const result = await service.toggleTodoStatus(1, true);
      expect(mockRepo.update).toHaveBeenCalledWith(1, { completed: true });
      expect(mockCache.delete).toHaveBeenCalledWith('todos:all');
      expect(result.completed).toBe(true);
    });
  });

  describe('deleteTodo', () => {
    it('deletes todo and invalidates cache', async () => {
      const result = await service.deleteTodo(1);
      expect(mockRepo.delete).toHaveBeenCalledWith(1);
      expect(mockCache.delete).toHaveBeenCalledWith('todos:all');
      expect(result).toEqual(mockTodo);
    });
  });

  describe('retry behavior (BUG #5)', () => {
    it('retries on failure before succeeding', async () => {
      mockRepo.findAll
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce([mockTodo]);

      const result = await service.getTodos();
      expect(mockRepo.findAll).toHaveBeenCalledTimes(2);
      expect(result.todos).toEqual([mockTodo]);
    }, 10000);
  });
});
