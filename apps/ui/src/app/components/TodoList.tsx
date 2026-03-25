'use client';
import React, { useState, useEffect } from 'react';
import { Box, Text, Button, Flex, Spinner } from '@chakra-ui/react';
import { Alert, Checkbox } from '@chakra-ui/react';
import { LuPlus } from 'react-icons/lu';
import { useTheme } from 'next-themes';
import TodoForm from './TodoForm';

interface Todo {
  id: number;
  todo: string;
  completed: boolean;
  userId: number;
}

const TodoList: React.FC = () => {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [isSpinningUp, setIsSpinningUp] = useState<boolean>(false);
  const { theme } = useTheme();

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://todo.app.local/api';

  const fetchTodos = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/todos`);
      
      if (response.status === 503 || response.status === 502) {
        // Service might be spinning up (common with free Render tier)
        setIsSpinningUp(true);
        setTimeout(fetchTodos, 10000); // Retry after 10 seconds
        return;
      }
      
      setIsSpinningUp(false);
      if (!response.ok) {
        throw new Error(`API returned status ${response.status}`);
      }
      
      const data = await response.json();
      setTodos(data.todos || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch todos');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTodos();
  }, []);

  const toggleTodoStatus = async (id: number, completed: boolean) => {
    try {
      const response = await fetch(`${apiUrl}/todos/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ completed: !completed }),
      });

      if (!response.ok) {
        throw new Error('Failed to update todo');
      }

      // Update the local state
      setTodos(
        todos.map((todo) =>
          todo.id === id ? { ...todo, completed: !completed } : todo
        )
      );
    } catch (err) {
      console.error('Error toggling todo status:', err);
    }
  };

  const addTodo = async (text: string) => {
    try {
      const response = await fetch(`${apiUrl}/todos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ todo: text, completed: false, userId: 1 }),
      });

      if (!response.ok) {
        throw new Error('Failed to add todo');
      }

      const newTodo = await response.json();
      setTodos([...todos, newTodo]);
      setIsFormOpen(false);
    } catch (err) {
      console.error('Error adding todo:', err);
    }
  };

  const deleteTodo = async (id: number) => {
    try {
      const response = await fetch(`${apiUrl}/todos/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete todo');
      }

      // Remove the todo from the local state
      setTodos(todos.filter((todo) => todo.id !== id));
    } catch (err) {
      console.error('Error deleting todo:', err);
    }
  };

  const textColor = theme === 'light' ? 'gray.800' : 'whiteAlpha.900';
  const completedTextColor = theme === 'light' ? 'gray.500' : 'gray.400';
  const borderColor = theme === 'light' ? 'gray.200' : 'gray.600';

  if (isLoading && !isSpinningUp) {
    return (
      <Flex justify="center" align="center" height="200px">
        <Spinner size="xl" />
      </Flex>
    );
  }

  if (isSpinningUp) {
    return (
      <Alert.Root status="info" borderRadius="md" mb={4}>
        <Alert.Indicator />
        <Box>
          <Alert.Title>Backend Service Starting Up</Alert.Title>
          <Alert.Description>
            The backend service is starting up. This may take up to 30 seconds since we're using a free service that spins down after inactivity.
          </Alert.Description>
          <Flex align="center" mt={2}>
            <Spinner size="sm" mr={2} />
            <Text>Checking again in a few seconds...</Text>
          </Flex>
        </Box>
      </Alert.Root>
    );
  }

  if (error) {
    return (
      <Alert.Root status="error" borderRadius="md" mb={4}>
        <Alert.Indicator />
        <Box>
          <Alert.Title>Error Loading Todos</Alert.Title>
          <Alert.Description>{error}</Alert.Description>
          <Button onClick={fetchTodos} mt={2} size="sm">
            Retry
          </Button>
        </Box>
      </Alert.Root>
    );
  }

  return (
    <Box>
      {todos.length === 0 ? (
        <Text fontSize="lg" mb={4} color={textColor}>
          No todos yet! Add one below.
        </Text>
      ) : (
        <Box mb={4}>
          {todos.map((todo) => (
            <Flex
              key={todo.id}
              p={2}
              mb={2}
              alignItems="center"
              borderWidth="1px"
              borderColor={borderColor}
              borderRadius="md"
            >
              <Checkbox.Root 
                checked={todo.completed}
                onCheckedChange={() => toggleTodoStatus(todo.id, todo.completed)}
                mr={3}
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
              </Checkbox.Root>
              <Text
                flex="1"
                textDecoration={todo.completed ? 'line-through' : 'none'}
                color={todo.completed ? completedTextColor : textColor}
              >
                {todo.todo}
              </Text>
              <Button
                size="sm"
                colorScheme="red"
                onClick={() => deleteTodo(todo.id)}
              >
                Delete
              </Button>
            </Flex>
          ))}
        </Box>
      )}

      {isFormOpen ? (
        <TodoForm
          onSubmit={addTodo}
          onCancel={() => setIsFormOpen(false)}
        />
      ) : (
        <Button
          colorScheme="blue"
          onClick={() => setIsFormOpen(true)}
        >
          <LuPlus style={{ marginRight: '8px' }} /> Add Todo
        </Button>
      )}
    </Box>
  );
};

export default TodoList;
