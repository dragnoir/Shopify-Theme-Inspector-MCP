# Shopify Theme Inspector MCP - Development Tasks

## Phase 1: Project Setup & Basic MCP Server ✅

- [x] Initialize Node.js/TypeScript project with MCP SDK
- [x] Set up project structure (src, tests, config)
- [x] Create basic MCP server with health check tool
- [x] Configure build and development scripts
- [x] Test basic MCP server connection

## Phase 2: Shopify Authentication Module ✅

- [x] Research Shopify OAuth flow for theme access
- [x] Implement OAuth authentication handler
- [x] Create session/token management
- [x] Add store configuration resource
- [x] Test authentication flow

## Phase 3: Profiler Core - Basic Profiling ✅

- [x] Implement store URL fetching with profiling enabled
- [x] Parse profiling data from response headers/body
- [x] Create basic profiling result interface
- [x] Implement `profile_page` tool (MVP)
- [ ] Test profiling on a sample store

## Phase 4: Flame Graph Data Processing

- [ ] Parse flame graph JSON data structure
- [ ] Create data models for profiling nodes
- [ ] Implement hierarchical data transformation
- [ ] Add aggregation for performance metrics
- [ ] Create `get_profile_summary` tool

## Phase 5: Performance Analysis Tools

- [ ] Implement `find_slow_templates` tool
- [ ] Create `analyze_liquid_file` tool
- [ ] Add `get_bottlenecks` tool
- [ ] Implement threshold-based alerts
- [ ] Add performance recommendations

## Phase 6: Advanced Features

- [ ] Implement page comparison tool
- [ ] Add historical profiling data storage
- [ ] Create batch profiling for multiple pages
- [ ] Add export functionality (JSON/CSV)
- [ ] Implement caching for repeated profiles

## Phase 7: Documentation & Polish

- [ ] Write comprehensive README
- [ ] Add tool usage examples
- [ ] Create configuration guide
- [ ] Add troubleshooting section
- [ ] Publish to npm (optional)
