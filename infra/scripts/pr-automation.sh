#!/bin/bash

# PR Automation Script for Todo App
# Creates realistic PR history with subtle bugs over 5 days
# Lives in ops repo, creates PRs in sibling API/UI repos
#
# Auto-detects repos:
#   - API: ../todo-app-api (relative to ops repo)
#   - UI:  ../todo-app-ui (optional)
#   - State stored in ops repo
#
# Usage: ./scripts/pr-automation.sh [--day N] [--status] [--reset]
#
# Examples:
#   ./scripts/pr-automation.sh          # Run current day
#   ./scripts/pr-automation.sh --status # Show status
#   ./scripts/pr-automation.sh --day 3  # Force specific day
#   ./scripts/pr-automation.sh --reset  # Reset state

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Auto-detect paths from script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPS_REPO="$(dirname "$SCRIPT_DIR")"
API_REPO="$(cd "$OPS_REPO/../todo-app-api" 2>/dev/null && pwd)"
UI_REPO="$(cd "$OPS_REPO/../todo-app-ui" 2>/dev/null && pwd)"
STATE_FILE="$OPS_REPO/.pr-automation-state"
CURRENT_REPO=""

#######################################
# Utility Functions
#######################################

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Change to a repo and verify it exists
switch_to_repo() {
    local repo_path=$1
    local repo_name=$2

    if [ -z "$repo_path" ] || [ ! -d "$repo_path" ]; then
        log_error "$repo_name not found at expected location"
        exit 1
    fi

    if [ ! -d "$repo_path/.git" ]; then
        log_error "$repo_name is not a git repository: $repo_path"
        exit 1
    fi

    cd "$repo_path"
    CURRENT_REPO="$repo_path"
    log_info "Switched to: $repo_path"
}

# Initialize state file
init_state() {
    if [ ! -f "$STATE_FILE" ]; then
        log_info "Initializing state file..."
        cat > "$STATE_FILE" << 'EOF'
{
  "startDate": "",
  "completedDays": [],
  "lastRun": "",
  "prsCreated": []
}
EOF
    fi
}

# Read state value using grep/sed (no jq dependency)
get_state() {
    local key=$1
    grep "\"$key\"" "$STATE_FILE" | sed 's/.*: *"\([^"]*\)".*/\1/' | head -1
}

# Check if day is completed
is_day_completed() {
    local day=$1
    grep -q "\"completedDays\".*$day" "$STATE_FILE"
}

# Update state file
update_state() {
    local start_date=$1
    local completed_days=$2
    local prs_created=$3
    local last_run=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    cat > "$STATE_FILE" << EOF
{
  "startDate": "$start_date",
  "completedDays": [$completed_days],
  "lastRun": "$last_run",
  "prsCreated": [$prs_created]
}
EOF
}

# Calculate current day based on start date
calculate_day() {
    local start_date=$(get_state "startDate")
    if [ -z "$start_date" ]; then
        echo "1"
        return
    fi

    local start_epoch=$(date -d "$start_date" +%s 2>/dev/null || date -j -f "%Y-%m-%d" "$start_date" +%s 2>/dev/null)
    local now_epoch=$(date +%s)
    local diff_days=$(( (now_epoch - start_epoch) / 86400 ))
    echo $((diff_days + 1))
}

# Show status
show_status() {
    init_state
    echo ""
    echo "===== PR Automation Status ====="
    echo ""
    echo "Ops Repo: $OPS_REPO"
    echo "API Repo: ${API_REPO:-'Not found'}"
    echo "UI Repo: ${UI_REPO:-'Not found'}"
    echo "State File: $STATE_FILE"
    echo ""

    local start_date=$(get_state "startDate")
    local last_run=$(get_state "lastRun")

    if [ -z "$start_date" ]; then
        echo "Status: Not started"
        echo "Run './scripts/pr-automation.sh' to begin Day 1"
    else
        echo "Start Date: $start_date"
        echo "Last Run: $last_run"
        echo "Current Day: $(calculate_day)"
        echo ""
        echo "Completed Days:"
        for day in 1 2 3 4 5; do
            if is_day_completed $day; then
                echo "  Day $day: ✓ Complete"
            else
                echo "  Day $day: ○ Pending"
            fi
        done
    fi
    echo ""
    echo "================================"
}

# Reset state
reset_state() {
    log_warning "Resetting automation state..."
    rm -f "$STATE_FILE"
    log_success "State reset. Run script again to start fresh."
}

#######################################
# PR Creation Functions
#######################################

create_branch_and_commit() {
    local branch_name=$1
    local commit_msg=$2

    log_info "Creating branch: $branch_name"
    git checkout main
    git pull origin main 2>/dev/null || true
    git checkout -b "$branch_name"
    git add -A
    git commit -m "$commit_msg"
    git push -u origin "$branch_name"
}

create_pr() {
    local title=$1
    local body=$2

    log_info "Creating PR: $title"
    gh pr create --title "$title" --body "$body"
}

add_pr_comment() {
    local pr_number=$1
    local comment=$2

    log_info "Adding comment to PR #$pr_number"
    gh pr comment "$pr_number" --body "$comment"
}

merge_pr() {
    local pr_number=$1

    log_info "Merging PR #$pr_number"
    gh pr merge "$pr_number" --merge --delete-branch || true
    git checkout main 2>/dev/null || git checkout -f main
    git pull origin main 2>/dev/null || true
}

get_latest_pr_number() {
    gh pr list --state open --limit 1 --json number --jq '.[0].number'
}

#######################################
# Day 1: Cleanup + Extract Rate Limiter
#######################################

run_day1() {
    log_info "========== Running Day 1 =========="
    switch_to_repo "$API_REPO" "todo-app-api"

    # PR 1: Cleanup (already done in working directory)
    log_info "PR 1: Cleanup - Remove deprecated endpoints"

    create_branch_and_commit "chore/remove-deprecated-endpoints" \
        "chore: remove deprecated test endpoints

Removes unused issue simulation endpoints and cleans up
references throughout the codebase."

    create_pr "Chore: Remove deprecated test endpoints" \
"## Summary
Cleanup of unused test code and deprecated endpoints.

## Changes
- Removed \`/issues\` endpoints
- Updated documentation
- Cleaned up middleware references"

    local pr1=$(get_latest_pr_number)
    sleep 2
    merge_pr "$pr1"

    # PR 2: Extract rate limiter
    log_info "PR 2: Extract rate limiter for testability"

    # Create rate-limiter.ts
    mkdir -p src/security
    cat > src/security/rate-limiter.ts << 'RATE_LIMITER_EOF'
/**
 * Rate Limiter Service
 * Extracted for better testability and separation of concerns
 */
export class RateLimiter {
  private requestCounts: Map<string, { count: number; windowStart: number }> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(windowMs: number = 60000, maxRequests: number = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  /**
   * Check if request should be rate limited
   * Uses sliding window algorithm
   */
  shouldLimit(key: string): boolean {
    const now = Date.now();
    const record = this.requestCounts.get(key);

    if (!record || now - record.windowStart > this.windowMs) {
      // New window - reset counter
      this.requestCounts.set(key, { count: 1, windowStart: now });
      return false;
    }

    // Within window - check and increment atomically
    if (record.count >= this.maxRequests) {
      return true;
    }

    record.count++;
    return false;
  }

  /**
   * Get current request count for a key
   */
  getCount(key: string): number {
    const record = this.requestCounts.get(key);
    return record ? record.count : 0;
  }

  /**
   * Clear all rate limit records (for testing)
   */
  clear(): void {
    this.requestCounts.clear();
  }
}
RATE_LIMITER_EOF

    create_branch_and_commit "refactor/extract-rate-limiter" \
        "refactor: extract rate limiter for testability

Moves rate limiting logic to a separate class for better
testing and maintainability."

    create_pr "Refactor: Extract rate limiter for testability" \
"## Summary
Extracts rate limiting logic to a dedicated class.

## Changes
- Created \`RateLimiter\` class in \`src/security/rate-limiter.ts\`
- Improved testability with clear interface
- Added documentation

## Testing
- Unit tests can now mock rate limiter behavior
- Existing integration tests pass"

    local pr2=$(get_latest_pr_number)
    sleep 2
    merge_pr "$pr2"

    log_success "Day 1 complete! PRs #$pr1 and #$pr2 merged."
}

#######################################
# Day 2: Input Validation + Correlation IDs
#######################################

run_day2() {
    log_info "========== Running Day 2 =========="
    switch_to_repo "$API_REPO" "todo-app-api"

    # PR 3: Add input validation (with bug)
    log_info "PR 3: Add input validation"

    # Create DTO
    mkdir -p src/todos/dto
    cat > src/todos/dto/create-todo.dto.ts << 'DTO_EOF'
import { IsString, IsNumber, IsOptional } from 'class-validator';

export class CreateTodoDto {
  @IsString()
  todo: string;

  @IsNumber()
  @IsOptional()
  userId?: number;
}
DTO_EOF

    # Update main.ts to add ValidationPipe (with transform: false bug)
    # Read current main.ts and inject ValidationPipe
    if ! grep -q "ValidationPipe" src/main.ts; then
        sed -i "s/import { NestFactory } from '@nestjs\/core';/import { NestFactory } from '@nestjs\/core';\nimport { ValidationPipe } from '@nestjs\/common';/" src/main.ts
        sed -i "/app.enableCors/a\\
  \\
  // Enable validation for all endpoints\\
  app.useGlobalPipes(new ValidationPipe({\\
    whitelist: true,\\
    forbidNonWhitelisted: true,\\
    transform: false, // Handle type conversion manually in service layer\\
  }));" src/main.ts
    fi

    create_branch_and_commit "feat/input-validation" \
        "feat: add input validation for todo endpoints

Adds class-validator decorators to ensure data integrity."

    create_pr "feat: Add input validation for todo endpoints" \
"## Summary
Adds input validation using class-validator to prevent invalid data.

## Changes
- Created \`CreateTodoDto\` with validation decorators
- Added global \`ValidationPipe\` configuration
- Made \`userId\` optional to support anonymous users

## Notes
- Using \`transform: false\` since we handle type conversion in the service layer
- Whitelist mode strips unknown properties for security"

    local pr3=$(get_latest_pr_number)
    sleep 2

    # Add hint comment
    add_pr_comment "$pr3" "Should we use \`transform: true\` instead? Leaving as \`false\` for now since we handle types manually in the service layer."

    sleep 2
    merge_pr "$pr3"

    # PR 4: Add correlation IDs (works correctly)
    log_info "PR 4: Add correlation IDs for request tracing"

    # Update todos.controller.ts to use ContextLogger
    cat > src/todos/todos.controller.ts << 'CONTROLLER_EOF'
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { TodosService } from './todos.service';
import { ContextLogger } from '../logger';

@Controller('todos')
export class TodosController {
  constructor(private readonly todosService: TodosService) {}

  @Get()
  async getTodos() {
    const logger = new ContextLogger('TodosController');
    logger.log('GET /todos - Fetching all todos');
    const result = await this.todosService.getTodos();
    logger.log('GET /todos - Completed', { count: result?.todos?.length || 0 });
    return result;
  }

  @Post()
  async addTodo(@Body('todo') todo: string, @Body('userId') userId: number) {
    const logger = new ContextLogger('TodosController');
    logger.log('POST /todos - Creating new todo', { userId });
    return this.todosService.addTodo(todo, userId);
  }

  @Patch(':id')
  async toggleTodoStatus(
    @Param('id') id: number,
    @Body('completed') completed: boolean,
  ) {
    const logger = new ContextLogger('TodosController');
    logger.log(`PATCH /todos/${id} - Toggling status`, { completed });
    return this.todosService.toggleTodoStatus(id, completed);
  }

  @Delete(':id')
  async deleteTodo(@Param('id') id: number) {
    const logger = new ContextLogger('TodosController');
    logger.log(`DELETE /todos/${id} - Deleting todo`);
    return this.todosService.deleteTodo(id);
  }
}
CONTROLLER_EOF

    create_branch_and_commit "feat/correlation-ids" \
        "feat: add correlation IDs for request tracing

Implements ContextLogger in controller for better observability."

    create_pr "Enhancement: Add correlation IDs for request tracing" \
"## Summary
Adds correlation ID tracking to improve request tracing and debugging.

## Changes
- Updated \`TodosController\` to use \`ContextLogger\`
- Each request now has a unique correlation ID
- Logs include request context for better debugging

## Benefits
- Trace requests across service boundaries
- Easier debugging in production
- Better log aggregation support"

    local pr4=$(get_latest_pr_number)
    sleep 2
    merge_pr "$pr4"

    log_success "Day 2 complete! PRs #$pr3 and #$pr4 merged."
}

#######################################
# Day 3: Service Logging + Request Caching
#######################################

run_day3() {
    log_info "========== Running Day 3 =========="
    switch_to_repo "$API_REPO" "todo-app-api"

    # PR 5: Add service logging (breaks correlation ID - BUG)
    log_info "PR 5: Add service layer logging"

    cat > src/todos/todos.service.ts << 'SERVICE_EOF'
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ContextLogger } from '../logger';

@Injectable()
export class TodosService {
  // Note: Each service instance gets its own logger for encapsulation
  private readonly logger = new ContextLogger('TodosService');

  constructor(private readonly httpService: HttpService) {}

  async getTodos() {
    this.logger.log('Fetching todos from external API');
    const startTime = Date.now();

    try {
      const response = await this.httpService.axiosRef.get(
        'https://dummyjson.com/todos',
      );

      this.logger.logPerformance('getTodos', Date.now() - startTime, {
        count: response.data?.todos?.length || 0,
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch todos', error as Error);
      throw error;
    }
  }

  async addTodo(todo: string, userId: number) {
    this.logger.log('Adding new todo', { todo, userId });

    const response = await this.httpService.axiosRef.post(
      'https://dummyjson.com/todos/add',
      { todo, completed: false, userId },
    );
    return response.data;
  }

  async toggleTodoStatus(id: number, completed: boolean) {
    this.logger.log('Toggling todo status', { id, completed });

    const response = await this.httpService.axiosRef.put(
      `https://dummyjson.com/todos/${id}`,
      { completed },
    );
    return response.data;
  }

  async deleteTodo(id: number) {
    this.logger.log('Deleting todo', { id });

    const response = await this.httpService.axiosRef.delete(
      `https://dummyjson.com/todos/${id}`,
    );
    return response.data;
  }
}
SERVICE_EOF

    create_branch_and_commit "refactor/service-logging" \
        "refactor: add structured logging to service layer

Adds ContextLogger to TodosService for better observability."

    create_pr "Refactor: Add service layer logging" \
"## Summary
Adds structured logging to the service layer for improved observability.

## Changes
- Added \`ContextLogger\` to \`TodosService\`
- Included performance logging for external API calls
- Added error context for failed requests

## Notes
Each service has its own logger instance for proper encapsulation
and separation of concerns."

    local pr5=$(get_latest_pr_number)
    sleep 2

    add_pr_comment "$pr5" "LGTM! Good separation of concerns. The service having its own logger makes it more self-contained and testable."

    sleep 2
    merge_pr "$pr5"

    # PR 6: Add request caching (with TTL bug)
    log_info "PR 6: Add request caching"

    cat > src/todos/todos.service.ts << 'SERVICE_CACHE_EOF'
import { Injectable, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ContextLogger } from '../logger';

interface CacheEntry {
  data: any;
  timestamp: number;
}

@Injectable()
export class TodosService implements OnModuleInit {
  private readonly logger = new ContextLogger('TodosService');

  // Request cache to reduce external API calls
  private requestCache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 60000; // 1 minute TTL
  private cleanupInterval: NodeJS.Timeout;

  constructor(private readonly httpService: HttpService) {}

  onModuleInit() {
    this.startCacheCleanup();
  }

  private startCacheCleanup() {
    // Capture cache reference for cleanup interval
    const cache = this.requestCache;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let removed = 0;

      for (const [key, entry] of cache.entries()) {
        // Remove entries older than TTL
        if (now - entry.timestamp <= this.CACHE_TTL_MS) {
          cache.delete(key);
          removed++;
        }
      }

      if (removed > 0) {
        this.logger.log('Cache cleanup completed', {
          entriesRemoved: removed,
          entriesRemaining: cache.size
        });
      }
    }, 30000); // Run every 30 seconds
  }

  private getCached(key: string): any | null {
    const entry = this.requestCache.get(key);
    if (entry && Date.now() - entry.timestamp < this.CACHE_TTL_MS) {
      this.logger.log('Cache hit', { key });
      return entry.data;
    }
    return null;
  }

  private setCache(key: string, data: any): void {
    this.requestCache.set(key, { data, timestamp: Date.now() });
    this.logger.log('Cache set', { key, cacheSize: this.requestCache.size });
  }

  async getTodos() {
    const cacheKey = 'todos:all';

    // Check cache first
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    this.logger.log('Fetching todos from external API');
    const startTime = Date.now();

    try {
      const response = await this.httpService.axiosRef.get(
        'https://dummyjson.com/todos',
      );

      this.logger.logPerformance('getTodos', Date.now() - startTime, {
        count: response.data?.todos?.length || 0,
      });

      // Cache the response
      this.setCache(cacheKey, response.data);

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch todos', error as Error);
      throw error;
    }
  }

  async addTodo(todo: string, userId: number) {
    this.logger.log('Adding new todo', { todo, userId });

    // Invalidate cache on write
    this.requestCache.delete('todos:all');

    const response = await this.httpService.axiosRef.post(
      'https://dummyjson.com/todos/add',
      { todo, completed: false, userId },
    );
    return response.data;
  }

  async toggleTodoStatus(id: number, completed: boolean) {
    this.logger.log('Toggling todo status', { id, completed });

    // Invalidate cache on write
    this.requestCache.delete('todos:all');

    const response = await this.httpService.axiosRef.put(
      `https://dummyjson.com/todos/${id}`,
      { completed },
    );
    return response.data;
  }

  async deleteTodo(id: number) {
    this.logger.log('Deleting todo', { id });

    // Invalidate cache on write
    this.requestCache.delete('todos:all');

    const response = await this.httpService.axiosRef.delete(
      `https://dummyjson.com/todos/${id}`,
    );
    return response.data;
  }
}
SERVICE_CACHE_EOF

    create_branch_and_commit "perf/request-caching" \
        "perf: add request caching for external API calls

Implements in-memory caching to reduce load on external API."

    create_pr "Performance: Add request caching" \
"## Summary
Reduces external API calls by caching responses with TTL-based invalidation.

## Changes
- Added in-memory request cache with 1-minute TTL
- Cache cleanup runs every 30 seconds
- Write operations invalidate the cache

## Performance
- Tested under load for 30 minutes
- Stable memory profile observed
- ~40% reduction in external API calls

## Notes
Cache invalidation on writes ensures data consistency."

    local pr6=$(get_latest_pr_number)
    sleep 2

    add_pr_comment "$pr6" "Tested under load for 30 minutes - stable memory profile. The cache invalidation logic looks correct. LGTM!"

    sleep 2
    merge_pr "$pr6"

    log_success "Day 3 complete! PRs #$pr5 and #$pr6 merged."
}

#######################################
# Day 4: Cache Fix + Timeout Config
#######################################

run_day4() {
    log_info "========== Running Day 4 =========="
    switch_to_repo "$API_REPO" "todo-app-api"

    # PR 7: Fix cache cleanup timing (introduces closure bug)
    log_info "PR 7: Fix cache cleanup timing"

    cat > src/todos/todos.service.ts << 'SERVICE_FIX_EOF'
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ContextLogger } from '../logger';

interface CacheEntry {
  data: any;
  timestamp: number;
}

@Injectable()
export class TodosService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new ContextLogger('TodosService');

  // Request cache to reduce external API calls
  private requestCache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 60000; // 1 minute TTL
  private cleanupInterval: NodeJS.Timeout;

  constructor(private readonly httpService: HttpService) {}

  onModuleInit() {
    this.startCacheCleanup();
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  private startCacheCleanup() {
    // Capture cache reference for cleanup interval
    // This ensures cleanup works even if cache is recreated
    const cache = this.requestCache;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let removed = 0;

      for (const [key, entry] of cache.entries()) {
        // Fixed: Remove entries older than TTL (was incorrectly keeping old entries)
        if (now - entry.timestamp > this.CACHE_TTL_MS) {
          cache.delete(key);
          removed++;
        }
      }

      if (removed > 0) {
        this.logger.log('Cache cleanup completed', {
          entriesRemoved: removed,
          entriesRemaining: cache.size
        });
      }
    }, 30000);
  }

  /**
   * Recreate cache under high memory pressure
   * Called when cache grows too large
   */
  private recreateCacheIfNeeded() {
    if (this.requestCache.size > 1000) {
      this.logger.warn('Cache size exceeded threshold, recreating', {
        oldSize: this.requestCache.size
      });
      // Create new Map to release memory
      this.requestCache = new Map();
      // Note: cleanup interval still references old cache for stability
    }
  }

  private getCached(key: string): any | null {
    const entry = this.requestCache.get(key);
    if (entry && Date.now() - entry.timestamp < this.CACHE_TTL_MS) {
      this.logger.log('Cache hit', { key });
      return entry.data;
    }
    return null;
  }

  private setCache(key: string, data: any): void {
    this.recreateCacheIfNeeded();
    this.requestCache.set(key, { data, timestamp: Date.now() });
    this.logger.log('Cache set', { key, cacheSize: this.requestCache.size });
  }

  async getTodos() {
    const cacheKey = 'todos:all';

    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    this.logger.log('Fetching todos from external API');
    const startTime = Date.now();

    try {
      const response = await this.httpService.axiosRef.get(
        'https://dummyjson.com/todos',
      );

      this.logger.logPerformance('getTodos', Date.now() - startTime, {
        count: response.data?.todos?.length || 0,
      });

      this.setCache(cacheKey, response.data);

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch todos', error as Error);
      throw error;
    }
  }

  async addTodo(todo: string, userId: number) {
    this.logger.log('Adding new todo', { todo, userId });
    this.requestCache.delete('todos:all');

    const response = await this.httpService.axiosRef.post(
      'https://dummyjson.com/todos/add',
      { todo, completed: false, userId },
    );
    return response.data;
  }

  async toggleTodoStatus(id: number, completed: boolean) {
    this.logger.log('Toggling todo status', { id, completed });
    this.requestCache.delete('todos:all');

    const response = await this.httpService.axiosRef.put(
      `https://dummyjson.com/todos/${id}`,
      { completed },
    );
    return response.data;
  }

  async deleteTodo(id: number) {
    this.logger.log('Deleting todo', { id });
    this.requestCache.delete('todos:all');

    const response = await this.httpService.axiosRef.delete(
      `https://dummyjson.com/todos/${id}`,
    );
    return response.data;
  }
}
SERVICE_FIX_EOF

    create_branch_and_commit "fix/cache-cleanup" \
        "fix: improve cache cleanup timing and memory handling

Fixes edge case where old entries weren't being cleaned up correctly."

    create_pr "Fix: Cache cleanup timing" \
"## Summary
Fixes edge case in cache cleanup when under high load.

## Changes
- Fixed TTL comparison logic in cleanup
- Added cache recreation when size exceeds threshold
- Added proper cleanup on module destroy

## Testing
- Verified cleanup correctly removes expired entries
- Tested cache recreation under memory pressure"

    local pr7=$(get_latest_pr_number)
    sleep 2
    merge_pr "$pr7"

    # PR 8: Configure axios timeout
    log_info "PR 8: Configure axios timeout"

    cat > src/todos/todos.module.ts << 'MODULE_EOF'
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TodosController } from './todos.controller';
import { TodosService } from './todos.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 5000, // 5 second timeout for external API calls
      maxRedirects: 5,
    }),
  ],
  controllers: [TodosController],
  providers: [TodosService],
})
export class TodosModule {}
MODULE_EOF

    create_branch_and_commit "config/axios-timeout" \
        "config: set axios timeout for external API calls

Adds explicit timeout configuration for HTTP client."

    create_pr "Configure axios timeout" \
"## Summary
Adds explicit timeout configuration for external HTTP calls.

## Changes
- Set 5 second timeout for axios requests
- Configured max redirects

## Rationale
Prevents requests from hanging indefinitely when external API is slow."

    local pr8=$(get_latest_pr_number)
    sleep 2
    merge_pr "$pr8"

    # PR 9: Add fail-fast timeout (with mismatch bug)
    log_info "PR 9: Add fail-fast timeout"

    cat > src/todos/todos.service.ts << 'SERVICE_TIMEOUT_EOF'
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ContextLogger } from '../logger';

interface CacheEntry {
  data: any;
  timestamp: number;
}

@Injectable()
export class TodosService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new ContextLogger('TodosService');

  // Request cache to reduce external API calls
  private requestCache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 60000;
  private cleanupInterval: NodeJS.Timeout;

  // Service-level timeout for fail-fast behavior
  // Users shouldn't wait more than 3s for external dependencies
  private readonly SERVICE_TIMEOUT = 3000;

  constructor(private readonly httpService: HttpService) {}

  onModuleInit() {
    this.startCacheCleanup();
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  private startCacheCleanup() {
    const cache = this.requestCache;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let removed = 0;

      for (const [key, entry] of cache.entries()) {
        if (now - entry.timestamp > this.CACHE_TTL_MS) {
          cache.delete(key);
          removed++;
        }
      }

      if (removed > 0) {
        this.logger.log('Cache cleanup completed', {
          entriesRemoved: removed,
          entriesRemaining: cache.size
        });
      }
    }, 30000);
  }

  private recreateCacheIfNeeded() {
    if (this.requestCache.size > 1000) {
      this.logger.warn('Cache size exceeded threshold, recreating', {
        oldSize: this.requestCache.size
      });
      this.requestCache = new Map();
    }
  }

  private getCached(key: string): any | null {
    const entry = this.requestCache.get(key);
    if (entry && Date.now() - entry.timestamp < this.CACHE_TTL_MS) {
      this.logger.log('Cache hit', { key });
      return entry.data;
    }
    return null;
  }

  private setCache(key: string, data: any): void {
    this.recreateCacheIfNeeded();
    this.requestCache.set(key, { data, timestamp: Date.now() });
    this.logger.log('Cache set', { key, cacheSize: this.requestCache.size });
  }

  /**
   * Wraps a promise with a timeout for fail-fast behavior
   * Matches axios timeout configuration
   */
  private withTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${operation} timed out after ${this.SERVICE_TIMEOUT}ms`));
      }, this.SERVICE_TIMEOUT);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  async getTodos() {
    const cacheKey = 'todos:all';

    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    this.logger.log('Fetching todos from external API');
    const startTime = Date.now();

    try {
      const response = await this.withTimeout(
        this.httpService.axiosRef.get('https://dummyjson.com/todos'),
        'getTodos'
      );

      this.logger.logPerformance('getTodos', Date.now() - startTime, {
        count: response.data?.todos?.length || 0,
      });

      this.setCache(cacheKey, response.data);

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch todos', error as Error);
      throw error;
    }
  }

  async addTodo(todo: string, userId: number) {
    this.logger.log('Adding new todo', { todo, userId });
    this.requestCache.delete('todos:all');

    const response = await this.withTimeout(
      this.httpService.axiosRef.post(
        'https://dummyjson.com/todos/add',
        { todo, completed: false, userId },
      ),
      'addTodo'
    );
    return response.data;
  }

  async toggleTodoStatus(id: number, completed: boolean) {
    this.logger.log('Toggling todo status', { id, completed });
    this.requestCache.delete('todos:all');

    const response = await this.withTimeout(
      this.httpService.axiosRef.put(
        `https://dummyjson.com/todos/${id}`,
        { completed },
      ),
      'toggleTodoStatus'
    );
    return response.data;
  }

  async deleteTodo(id: number) {
    this.logger.log('Deleting todo', { id });
    this.requestCache.delete('todos:all');

    const response = await this.withTimeout(
      this.httpService.axiosRef.delete(`https://dummyjson.com/todos/${id}`),
      'deleteTodo'
    );
    return response.data;
  }
}
SERVICE_TIMEOUT_EOF

    create_branch_and_commit "perf/fail-fast-timeout" \
        "perf: add fail-fast timeout for slow external APIs

Users shouldn't wait more than 3s for external dependencies."

    create_pr "Performance: Add fail-fast timeout" \
"## Summary
Adds service-level timeout for fail-fast behavior.

## Changes
- Added \`withTimeout\` wrapper for external API calls
- Set 3 second timeout to improve user experience
- Matches axios timeout configuration

## Rationale
Users shouldn't wait more than 3 seconds for external dependencies.
This provides faster feedback when the external API is slow."

    local pr9=$(get_latest_pr_number)
    sleep 2

    add_pr_comment "$pr9" "Looks good! This matches the axios timeout configuration. Nice improvement for UX."

    sleep 2
    merge_pr "$pr9"

    log_success "Day 4 complete! PRs #$pr7, #$pr8, and #$pr9 merged."
}

#######################################
# Day 5: Retry + Race Condition + Docs
#######################################

run_day5() {
    log_info "========== Running Day 5 =========="
    switch_to_repo "$API_REPO" "todo-app-api"

    # PR 10: Add retry mechanism (with aggressive backoff bug)
    log_info "PR 10: Add retry mechanism"

    cat > src/todos/todos.service.ts << 'SERVICE_RETRY_EOF'
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ContextLogger } from '../logger';

interface CacheEntry {
  data: any;
  timestamp: number;
}

@Injectable()
export class TodosService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new ContextLogger('TodosService');

  private requestCache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 60000;
  private cleanupInterval: NodeJS.Timeout;
  private readonly SERVICE_TIMEOUT = 3000;

  // Retry configuration
  private readonly MAX_RETRIES = 3;
  private readonly INITIAL_RETRY_DELAY = 100;

  constructor(private readonly httpService: HttpService) {}

  onModuleInit() {
    this.startCacheCleanup();
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  private startCacheCleanup() {
    const cache = this.requestCache;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let removed = 0;

      for (const [key, entry] of cache.entries()) {
        if (now - entry.timestamp > this.CACHE_TTL_MS) {
          cache.delete(key);
          removed++;
        }
      }

      if (removed > 0) {
        this.logger.log('Cache cleanup completed', {
          entriesRemoved: removed,
          entriesRemaining: cache.size
        });
      }
    }, 30000);
  }

  private recreateCacheIfNeeded() {
    if (this.requestCache.size > 1000) {
      this.logger.warn('Cache size exceeded threshold, recreating', {
        oldSize: this.requestCache.size
      });
      this.requestCache = new Map();
    }
  }

  private getCached(key: string): any | null {
    const entry = this.requestCache.get(key);
    if (entry && Date.now() - entry.timestamp < this.CACHE_TTL_MS) {
      this.logger.log('Cache hit', { key });
      return entry.data;
    }
    return null;
  }

  private setCache(key: string, data: any): void {
    this.recreateCacheIfNeeded();
    this.requestCache.set(key, { data, timestamp: Date.now() });
    this.logger.log('Cache set', { key, cacheSize: this.requestCache.size });
  }

  /**
   * Retry wrapper with exponential backoff
   * Provides resilience against transient failures
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.MAX_RETRIES - 1) {
          // Exponential backoff with factor of 1.5 for quick recovery
          const delay = this.INITIAL_RETRY_DELAY * Math.pow(1.5, attempt);
          // Add small jitter to prevent thundering herd
          const jitter = Math.random() * 10;

          this.logger.warn(`Retry attempt ${attempt + 1}/${this.MAX_RETRIES} for ${operationName}`, {
            delay: Math.round(delay + jitter),
            error: lastError.message,
          });

          await new Promise(resolve => setTimeout(resolve, delay + jitter));
        }
      }
    }

    this.logger.error(`All retries failed for ${operationName}`, lastError);
    throw lastError;
  }

  private withTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${operation} timed out after ${this.SERVICE_TIMEOUT}ms`));
      }, this.SERVICE_TIMEOUT);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  async getTodos() {
    const cacheKey = 'todos:all';

    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    this.logger.log('Fetching todos from external API');
    const startTime = Date.now();

    try {
      const response = await this.withRetry(
        () => this.withTimeout(
          this.httpService.axiosRef.get('https://dummyjson.com/todos'),
          'getTodos'
        ),
        'getTodos'
      );

      this.logger.logPerformance('getTodos', Date.now() - startTime, {
        count: response.data?.todos?.length || 0,
      });

      this.setCache(cacheKey, response.data);

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch todos', error as Error);
      throw error;
    }
  }

  async addTodo(todo: string, userId: number) {
    this.logger.log('Adding new todo', { todo, userId });
    this.requestCache.delete('todos:all');

    const response = await this.withRetry(
      () => this.withTimeout(
        this.httpService.axiosRef.post(
          'https://dummyjson.com/todos/add',
          { todo, completed: false, userId },
        ),
        'addTodo'
      ),
      'addTodo'
    );
    return response.data;
  }

  async toggleTodoStatus(id: number, completed: boolean) {
    this.logger.log('Toggling todo status', { id, completed });
    this.requestCache.delete('todos:all');

    const response = await this.withRetry(
      () => this.withTimeout(
        this.httpService.axiosRef.put(
          `https://dummyjson.com/todos/${id}`,
          { completed },
        ),
        'toggleTodoStatus'
      ),
      'toggleTodoStatus'
    );
    return response.data;
  }

  async deleteTodo(id: number) {
    this.logger.log('Deleting todo', { id });
    this.requestCache.delete('todos:all');

    const response = await this.withRetry(
      () => this.withTimeout(
        this.httpService.axiosRef.delete(`https://dummyjson.com/todos/${id}`),
        'deleteTodo'
      ),
      'deleteTodo'
    );
    return response.data;
  }
}
SERVICE_RETRY_EOF

    create_branch_and_commit "feat/retry-mechanism" \
        "feat: add retry mechanism for external API failures

Implements exponential backoff for resilience against transient failures."

    create_pr "Reliability: Add retry mechanism" \
"## Summary
Adds retry logic with exponential backoff for external API calls.

## Changes
- Added \`withRetry\` wrapper with configurable retries
- Implemented exponential backoff (factor 1.5x)
- Added jitter to prevent thundering herd

## Configuration
- Max retries: 3
- Initial delay: 100ms
- Backoff factor: 1.5x

## Benefits
- Resilience against transient network failures
- Automatic recovery from temporary external API issues"

    local pr10=$(get_latest_pr_number)
    sleep 2

    add_pr_comment "$pr10" "Nice! Exponential backoff is industry best practice. The 1.5x factor provides a good balance between retry speed and giving the external service time to recover."

    sleep 2
    merge_pr "$pr10"

    # PR 11: Optimize rate limiter (introduces race condition)
    log_info "PR 11: Optimize rate limiter checks"

    cat > src/security/rate-limiter.ts << 'RATE_LIMITER_OPT_EOF'
/**
 * Rate Limiter Service
 * Optimized for high-throughput scenarios
 */
export class RateLimiter {
  private requestCounts: Map<string, { count: number; windowStart: number }> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(windowMs: number = 60000, maxRequests: number = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  /**
   * Check if request should be rate limited
   * Optimized: Separate check and increment for better performance
   */
  shouldLimit(key: string): boolean {
    const now = Date.now();
    const record = this.requestCounts.get(key);

    // Check if window expired or new key
    if (!record || now - record.windowStart > this.windowMs) {
      // New window - will be under limit
      // Increment happens after check for better performance
      this.requestCounts.set(key, { count: 1, windowStart: now });
      return false;
    }

    // Check if over limit
    if (record.count >= this.maxRequests) {
      return true;
    }

    // Under limit - increment count
    // Note: Separating check and increment reduces lock contention
    record.count = record.count + 1;
    return false;
  }

  /**
   * Get current request count for a key
   */
  getCount(key: string): number {
    const record = this.requestCounts.get(key);
    return record ? record.count : 0;
  }

  /**
   * Clear all rate limit records
   */
  clear(): void {
    this.requestCounts.clear();
  }
}
RATE_LIMITER_OPT_EOF

    create_branch_and_commit "perf/optimize-rate-limiter" \
        "perf: optimize rate limiter checks

Separates check and increment for better performance under load."

    create_pr "Optimize rate limiter checks" \
"## Summary
Optimizes rate limiter for high-throughput scenarios.

## Changes
- Separated check and increment operations
- Reduced lock contention under concurrent load
- Added performance comments

## Performance
- Reduced CPU overhead in hot path
- Better behavior under high concurrency"

    local pr11=$(get_latest_pr_number)
    sleep 2

    add_pr_comment "$pr11" "Nice optimization! Separating the check from increment should reduce lock contention under high load."

    sleep 2
    merge_pr "$pr11"

    # PR 12: Add misleading documentation
    log_info "PR 12: Add architecture documentation"

    mkdir -p docs

    cat > docs/ARCHITECTURE.md << 'ARCH_EOF'
# Architecture Overview

## System Components

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────┐
│   Frontend  │────▶│   API       │────▶│  External API   │
│   (React)   │     │  (NestJS)   │     │  (dummyjson)    │
└─────────────┘     └─────────────┘     └─────────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Prometheus │
                    │   Metrics   │
                    └─────────────┘
```

## API Layer

### Request Flow

1. Request arrives at controller
2. Correlation ID assigned for tracing
3. Service layer processes request
4. Cache checked before external calls
5. Response returned with metrics

### Timeout Configuration

All external API calls use a **5 second timeout**:
- Axios HTTP client: 5000ms
- Service-level timeout: 5000ms (matches axios)

This ensures consistent behavior across all external calls.

### Caching Strategy

- TTL: 60 seconds
- Memory-efficient Map-based storage
- Automatic cleanup every 30 seconds
- Write-through invalidation

### Rate Limiting

- Window: 60 seconds
- Max requests: 100 per IP per minute
- Atomic check-and-increment operation
ARCH_EOF

    cat > docs/TROUBLESHOOTING.md << 'TROUBLESHOOT_EOF'
# Troubleshooting Guide

## Common Issues

### 429 Too Many Requests

**Symptom**: API returns 429 status code

**Cause**: Rate limit exceeded (100 requests/minute/IP)

**Solution**:
- Reduce request frequency
- Implement client-side rate limiting
- Contact admin to increase limits

### Slow API Responses

**Symptom**: Requests take longer than expected

**Cause**: External API (dummyjson.com) latency

**Solution**:
- Check external API status
- Increase timeout if needed
- Results are cached for 60s, subsequent requests should be fast

### Memory Usage Increasing

**Symptom**: Health endpoint shows growing heapUsed

**Cause**: Normal cache growth during operation

**Solution**:
- Cache automatically cleans up expired entries
- Memory stabilizes after initial load
- If persistent, restart the service

### Correlation ID Not Found in Logs

**Symptom**: Some log entries show "unknown" correlation ID

**Cause**: Async operations may lose context

**Solution**:
- This is expected for background tasks
- Request-initiated logs should have correlation IDs
TROUBLESHOOT_EOF

    cat > docs/PERFORMANCE.md << 'PERF_EOF'
# Performance Guide

## Benchmarks

Tested on: 4 CPU cores, 8GB RAM

### Single-threaded Performance

| Operation | Avg Latency | P99 Latency |
|-----------|-------------|-------------|
| GET /todos (cached) | 2ms | 5ms |
| GET /todos (uncached) | 150ms | 300ms |
| POST /todos | 180ms | 400ms |

### Load Test Results

**Steady state (5 req/s for 30 minutes)**:
- Memory: Stable at ~80MB
- Error rate: < 0.1%
- Cache hit rate: ~85%

## Optimization Features

### Request Caching
- Reduces external API calls by ~40%
- Memory-efficient implementation
- Automatic TTL-based expiration

### Retry Logic
- Handles transient failures automatically
- Exponential backoff prevents overload
- Maximum 3 retries per request

### Rate Limiting
- Protects against abuse
- Per-IP tracking
- Efficient in-memory implementation
PERF_EOF

    create_branch_and_commit "docs/architecture" \
        "docs: add architecture and troubleshooting documentation

Adds comprehensive documentation for the API."

    create_pr "docs: Add architecture documentation" \
"## Summary
Adds documentation for architecture, troubleshooting, and performance.

## Changes
- Added \`docs/ARCHITECTURE.md\` - System overview and configuration
- Added \`docs/TROUBLESHOOTING.md\` - Common issues and solutions
- Added \`docs/PERFORMANCE.md\` - Benchmarks and optimization details"

    local pr12=$(get_latest_pr_number)
    sleep 2
    merge_pr "$pr12"

    log_success "Day 5 complete! PRs #$pr10, #$pr11, and #$pr12 merged."
    log_success ""
    log_success "========================================="
    log_success "  ALL 5 DAYS COMPLETE! 12 PRs MERGED"
    log_success "========================================="
    log_success ""
    log_success "Bugs introduced:"
    log_success "  1. Schema validation gap (transform: false)"
    log_success "  2. Correlation ID loss (service creates own logger)"
    log_success "  3. Cache TTL bug (closure captures reference)"
    log_success "  4. Timeout mismatch (3s vs 5s)"
    log_success "  5. Aggressive retry (1.5x backoff, small jitter)"
    log_success "  6. Rate limiter race condition (TOCTOU)"
    log_success ""
    log_success "Run k6 load tests to trigger these issues!"
}

#######################################
# Main Script
#######################################

main() {
    # Parse arguments
    local force_day=""
    local show_status_only=false
    local reset=false

    while [[ $# -gt 0 ]]; do
        case $1 in
            --day)
                force_day="$2"
                shift 2
                ;;
            --status)
                show_status_only=true
                shift
                ;;
            --reset)
                reset=true
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Usage: $0 [--day N] [--status] [--reset]"
                exit 1
                ;;
        esac
    done

    # Verify repos exist
    log_info "Detecting repositories..."
    if [ -z "$API_REPO" ]; then
        log_error "API repo not found at: $OPS_REPO/../todo-app-api"
        exit 1
    fi
    log_info "  API: $API_REPO"

    if [ -z "$UI_REPO" ]; then
        log_warning "  UI: Not found (optional)"
    else
        log_info "  UI: $UI_REPO"
    fi
    log_info "  State: $STATE_FILE"
    echo ""

    # Initialize state (in ops repo)
    init_state

    # Handle special modes
    if [ "$reset" = true ]; then
        reset_state
        exit 0
    fi

    if [ "$show_status_only" = true ]; then
        show_status
        exit 0
    fi

    # Determine which day to run
    local current_day
    if [ -n "$force_day" ]; then
        current_day="$force_day"
        log_info "Forcing Day $current_day"
    else
        # Check if this is first run
        local start_date=$(get_state "startDate")
        if [ -z "$start_date" ]; then
            # First run - set start date to today
            start_date=$(date +%Y-%m-%d)
            update_state "$start_date" "" ""
            log_info "First run - setting start date to $start_date"
        fi
        current_day=$(calculate_day)
    fi

    # Validate day
    if [ "$current_day" -lt 1 ] || [ "$current_day" -gt 5 ]; then
        log_error "Invalid day: $current_day (must be 1-5)"
        exit 1
    fi

    # Check if already completed
    if is_day_completed "$current_day"; then
        log_warning "Day $current_day already completed!"
        show_status
        exit 0
    fi

    log_info "Running Day $current_day tasks..."
    echo ""

    # Run the appropriate day
    case $current_day in
        1) run_day1 ;;
        2) run_day2 ;;
        3) run_day3 ;;
        4) run_day4 ;;
        5) run_day5 ;;
    esac

    # Update state with completed day
    local start_date=$(get_state "startDate")
    local completed=""
    for d in 1 2 3 4 5; do
        if is_day_completed "$d" || [ "$d" -eq "$current_day" ]; then
            if [ -n "$completed" ]; then
                completed="$completed, $d"
            else
                completed="$d"
            fi
        fi
    done

    update_state "$start_date" "$completed" ""

    echo ""
    show_status
}

# Run main
main "$@"
