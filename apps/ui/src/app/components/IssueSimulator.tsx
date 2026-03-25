'use client';
import React, { useState } from 'react';
import { 
  Box, 
  Button, 
  Heading, 
  Text, 
  Spinner,
  Stack,
  SimpleGrid,
  Code,
  Checkbox,
  Badge
} from '@chakra-ui/react';
import { Alert } from '@chakra-ui/react';

interface ErrorResult {
  status: string;
  message: string;
  httpStatus?: number;
  details?: string;
  memoryStats?: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    arraysAllocated?: number;
    arraysCleared?: number;
  };
}

const IssueSimulator: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ErrorResult | null>(null);
  const [isSpinningUp, setIsSpinningUp] = useState(false);
  const [burstMode, setBurstMode] = useState(false);
  const [burstProgress, setBurstProgress] = useState<{current: number, total: number} | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://todo.app.local/api';

  const simulateIssue = async (issueType: string) => {
    if (burstMode) {
      await simulateIssueBurst(issueType);
      return;
    }

    setLoading(true);
    setResult(null);
    
    try {
      const response = await fetch(`${apiUrl}/issues/simulate?type=${issueType}`, {
        // Add cache control headers to prevent caching
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
      
      if (response.status === 503 || response.status === 502) {
        // Service might be spinning up (common with free Render tier)
        setIsSpinningUp(true);
        
        // Wait 5 seconds and try once more
        setTimeout(() => {
          simulateIssue(issueType);
        }, 5000);
        return;
      }
      
      setIsSpinningUp(false);
      
      // Handle different response status codes
      try {
        const data = await response.json();
        setResult({ 
          status: response.ok ? 'success' : 'error', 
          message: data.message || `HTTP ${response.status}: ${response.statusText}`,
          httpStatus: response.status,
          details: data.status ? `Status: ${data.status}` : undefined,
          memoryStats: data.memoryStats
        });
      } catch (parseError) {
        // Handle non-JSON responses
        const text = await response.text().catch(() => 'No response body');
        setResult({ 
          status: 'error', 
          message: `Failed to parse response (HTTP ${response.status})`,
          httpStatus: response.status,
          details: text.length > 100 ? `${text.substring(0, 100)}...` : text
        });
      }
    } catch (error: any) {
      setResult({ 
        status: 'error', 
        message: error.message || 'Failed to simulate issue. The service might be unavailable.',
        details: error.toString()
      });
    } finally {
      setLoading(false);
    }
  };

  const simulateIssueBurst = async (issueType: string) => {
    const burstCount = 20;
    setLoading(true);
    setResult(null);
    setBurstProgress({ current: 0, total: burstCount });
    
    let successCount = 0;
    let errorCount = 0;
    let lastResponse: any = null;
    
    try {
      // Make rapid calls with 200ms delay between each
      for (let i = 0; i < burstCount; i++) {
        setBurstProgress({ current: i + 1, total: burstCount });
        
        try {
          const response = await fetch(`${apiUrl}/issues/simulate?type=${issueType}`, {
            headers: {
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache',
              'Expires': '0'
            }
          });
          
          if (response.ok) {
            successCount++;
          } else {
            errorCount++;
          }
          
          // Store last response for display
          if (i === burstCount - 1) {
            try {
              lastResponse = await response.json();
            } catch {
              lastResponse = { status: 'completed', message: 'Burst completed' };
            }
          }
          
          // Small delay between requests
          if (i < burstCount - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        } catch (error) {
          errorCount++;
        }
      }
      
      setResult({
        status: 'success',
        message: `Burst completed: ${successCount} success, ${errorCount} errors. This should trigger Prometheus alerts!`,
        httpStatus: 200,
        details: `Made ${burstCount} requests in ~${burstCount * 0.2}s to trigger rate-based alerts`,
        memoryStats: lastResponse?.memoryStats
      });
      
    } catch (error: any) {
      setResult({
        status: 'error', 
        message: `Burst failed: ${error.message}`,
        details: `Completed ${successCount + errorCount}/${burstCount} requests`
      });
    } finally {
      setLoading(false);
      setBurstProgress(null);
    }
  };

  const simulateServiceDown = async () => {
    setLoading(true);
    setResult(null);
    
    try {
      const response = await fetch(`${apiUrl}/issues/service-down`, {
        method: 'POST',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Content-Type': 'application/json'
        }
      });
      
      if (response.status === 503 || response.status === 502) {
        // Service might be spinning up
        setIsSpinningUp(true);
        
        // Wait 5 seconds and try once more
        setTimeout(() => {
          simulateServiceDown();
        }, 5000);
        return;
      }
      
      setIsSpinningUp(false);
      
      try {
        const data = await response.json();
        setResult({ 
          status: response.ok ? 'success' : 'error', 
          message: data.message || `HTTP ${response.status}: ${response.statusText}`,
          httpStatus: response.status,
          memoryStats: data.memoryStats
        });
      } catch (parseError) {
        // If response is not valid JSON
        const text = await response.text().catch(() => 'No response body');
        setResult({ 
          status: 'error', 
          message: `Failed to parse response (HTTP ${response.status})`,
          httpStatus: response.status,
          details: text.length > 100 ? `${text.substring(0, 100)}...` : text
        });
      }
    } catch (error: any) {
      setResult({ 
        status: 'error', 
        message: error.message || 'Failed to simulate service down.',
        details: error.toString()
      });
    } finally {
      setLoading(false);
    }
  };

  const clearMemoryLeak = async () => {
    setLoading(true);
    setResult(null);
    
    try {
      const response = await fetch(`${apiUrl}/issues/clear-memory-leak`, {
        method: 'POST',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Content-Type': 'application/json'
        }
      });
      
      if (response.status === 503 || response.status === 502) {
        // Service might be spinning up
        setIsSpinningUp(true);
        
        // Wait 5 seconds and try once more
        setTimeout(() => {
          clearMemoryLeak();
        }, 5000);
        return;
      }
      
      setIsSpinningUp(false);
      
      try {
        const data = await response.json();
        setResult({ 
          status: response.ok ? 'success' : 'error', 
          message: data.message || `HTTP ${response.status}: ${response.statusText}`,
          httpStatus: response.status,
          memoryStats: data.memoryStats
        });
      } catch (parseError) {
        // If response is not valid JSON
        const text = await response.text().catch(() => 'No response body');
        setResult({ 
          status: 'error', 
          message: `Failed to parse response (HTTP ${response.status})`,
          httpStatus: response.status,
          details: text.length > 100 ? `${text.substring(0, 100)}...` : text
        });
      }
    } catch (error: any) {
      setResult({ 
        status: 'error', 
        message: error.message || 'Failed to clear memory leak.',
        details: error.toString()
      });
    } finally {
      setLoading(false);
    }
  };

  // Get alert status based on HTTP status code
  const getAlertStatus = (httpStatus?: number): "error" | "warning" | "info" | "success" => {
    if (!httpStatus) return "error";
    
    if (httpStatus >= 500) return "error";
    if (httpStatus >= 400) return "warning";
    if (httpStatus >= 300) return "info";
    return "success";
  };

  return (
    <Box p={5} shadow="md" borderWidth="1px" borderRadius="md">
      <Heading size="md" mb={4}>Issue Simulator</Heading>
      
      {isSpinningUp && (
        <Alert.Root status="info" mb={4}>
          <Alert.Indicator />
          <Stack direction="row">
            <Spinner size="sm" />
            <Box>
              <Alert.Title>Backend is starting up</Alert.Title>
              <Alert.Description>
                Please wait while the backend service starts up. This may take up to 30 seconds.
              </Alert.Description>
            </Box>
          </Stack>
        </Alert.Root>
      )}

      {burstProgress && (
        <Alert.Root status="info" mb={4}>
          <Alert.Indicator />
          <Stack direction="row" align="center">
            <Spinner size="sm" />
            <Box>
              <Alert.Title>Burst Mode Active</Alert.Title>
              <Alert.Description>
                Making rapid API calls ({burstProgress.current}/{burstProgress.total}) to trigger alerts...
              </Alert.Description>
            </Box>
            <Badge colorPalette="blue">
              {Math.round((burstProgress.current / burstProgress.total) * 100)}%
            </Badge>
          </Stack>
        </Alert.Root>
      )}
      
      {result && (
        <Alert.Root 
          status={getAlertStatus(result.httpStatus)} 
          mb={4}
        >
          <Alert.Indicator />
          <Box>
            <Alert.Title>
              {result.httpStatus 
                ? `HTTP ${result.httpStatus}` 
                : (result.status === 'success' ? 'Success' : 'Error')}
            </Alert.Title>
            <Alert.Description>{result.message}</Alert.Description>
            {result.memoryStats && (
              <Code fontSize="xs" mt={2} p={2} maxWidth="100%" overflow="auto">
                Memory Stats: {result.memoryStats.heapUsed}MB heap, {result.memoryStats.heapTotal}MB total
                {result.memoryStats.arraysAllocated !== undefined && `, Arrays: ${result.memoryStats.arraysAllocated}`}
                {result.memoryStats.arraysCleared !== undefined && `, Cleared: ${result.memoryStats.arraysCleared}`}
              </Code>
            )}
            {result.details && !result.memoryStats && (
              <Code fontSize="xs" mt={2} p={1} maxWidth="100%" overflow="auto">
                {result.details}
              </Code>
            )}
          </Box>
        </Alert.Root>
      )}
      
      <Stack direction="column" gap={3} align="stretch" mb={4}>
        <Stack direction="row" align="center" justify="space-between">
          <Text>Click any button to simulate different issues:</Text>
          <Checkbox.Root
            checked={burstMode}
            onCheckedChange={(e) => setBurstMode(!!e.checked)}
            colorPalette="blue"
          >
            
            <Checkbox.HiddenInput />
            <Checkbox.Control />
            <Checkbox.Label>Burst Mode (20 rapid calls)</Checkbox.Label>
          </Checkbox.Root>
        </Stack>
        
        <SimpleGrid columns={{ base: 1, md: 2 }} gap="5">
          <Button 
            colorPalette="yellow" 
            onClick={() => simulateIssue('slow')}
            loading={loading && !isSpinningUp && !burstProgress}
          >
            Simulate Slow Response {burstMode && '(Burst)'}
          </Button>
          
          <Button 
            colorPalette="red" 
            onClick={() => simulateIssue('error')}
            loading={loading && !isSpinningUp && !burstProgress}
          >
            Simulate Server Error (500) {burstMode && '(Burst)'}
          </Button>
          
          <Button 
            colorPalette="orange" 
            onClick={() => simulateIssue('not-found')}
            loading={loading && !isSpinningUp && !burstProgress}
          >
            Simulate Not Found (404) {burstMode && '(Burst)'}
          </Button>
          
          <Button 
            colorPalette="orange" 
            onClick={() => simulateIssue('bad-request')}
            loading={loading && !isSpinningUp && !burstProgress}
          >
            Simulate Bad Request (400) {burstMode && '(Burst)'}
          </Button>
          
          <Button 
            colorPalette="orange" 
            onClick={() => simulateIssue('unauthorized')}
            loading={loading && !isSpinningUp && !burstProgress}
          >
            Simulate Unauthorized (401) {burstMode && '(Burst)'}
          </Button>
          
          <Button 
            colorPalette="orange" 
            onClick={() => simulateIssue('forbidden')}
            loading={loading && !isSpinningUp && !burstProgress}
          >
            Simulate Forbidden (403) {burstMode && '(Burst)'}
          </Button>

          <Button 
            colorPalette="purple" 
            onClick={() => simulateIssue('memory-leak')}
            loading={loading && !isSpinningUp && !burstProgress}
          >
            Simulate Memory Leak {burstMode && '(Burst)'}
          </Button>
          
          <Button 
            colorPalette="green" 
            onClick={clearMemoryLeak}
            loading={loading && !isSpinningUp && !burstProgress}
            disabled={burstMode}
          >
            Clear Memory Leak
          </Button>
        </SimpleGrid>
        
        <Button 
          colorPalette="red" 
          onClick={simulateServiceDown}
          loading={loading && !isSpinningUp && !burstProgress}
          disabled={burstMode}
        >
          Simulate Service Down
        </Button>
      </Stack>
      
      <Text fontSize="sm" color="gray.500" mt={4}>
        These simulations help test how the application handles various error conditions and memory issues.
        Memory leak simulation allocates 10MB per click - use clear to release memory.
        {' '}
        Burst Mode: Makes 20 rapid API calls to quickly trigger Prometheus rate-based alerts (error rate, latency).
      </Text>
    </Box>
  );
};

export default IssueSimulator; 